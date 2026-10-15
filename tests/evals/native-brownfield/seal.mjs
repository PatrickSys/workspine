import fs from 'node:fs';
import path from 'node:path';
import { canonicalStringify, EvalError, mkdirp, readJson, sha256, writeExclusiveJson } from './util.mjs';
import { classifyPlanSelection } from './journey.mjs';
const PUBLIC = Object.freeze({
  product_green: ['green', null],
  task_red: ['red', 'task_outcome'],
  workspine_red: ['red', 'workspine_contract'],
  provider_invalid: ['invalid', 'provider'],
  protocol_invalid: ['invalid', 'evaluator'],
  evaluator_invalid: ['invalid', 'evaluator'],
  environment_invalid: ['invalid', 'environment'],
});
const RECEIPT_NAMES = Object.freeze({ 0: 'manifest', 10: 'qualification', 100: 'a-plan', 110: 'a-pause',
  120: 'approval', 200: 'b-resume-execute', 300: 'c-verify', 310: 'c-progress', 400: 'oracle',
  410: 'grade', 420: 'regrade', 900: 'terminal-seal' });
const RECEIPT_TYPES = Object.freeze({ 0: 'manifest', 10: 'qualification', 100: 'turn', 110: 'turn', 120: 'approval',
  200: 'turn', 300: 'turn', 310: 'turn', 400: 'oracle', 410: 'grade', 420: 'regrade' });
const PREFIX = Object.keys(RECEIPT_TYPES).map(Number).sort((a, b) => a - b);
const IDENTITY_FAILURES = new Set(['selected_plan_identity_missing', 'selected_plan_identity_mismatch', 'plan_preapproved_outside_harness']);
const BROWNFIELD_PLAN = '.work/brownfield-change/CHANGE.md';
export function projectOutcome(outcome, options = {}) {
  if (!(outcome in PUBLIC)) throw new EvalError('evaluator_invalid', `unsupported outcome: ${outcome}`);
  if (outcome === 'workspine_red' && !/^[0-9a-f]{64}$/i.test(options.genericReproductionSha256 || '')) {
    throw new EvalError('evaluator_invalid', 'workspine_red requires a generic reproduction SHA-256');
  }
  const [disposition, failure_domain] = PUBLIC[outcome];
  return { disposition, failure_domain };
}
function receiptHash(receipt) {
  const { receipt_sha256: ignoredReceipt, ...body } = receipt;
  if (receipt.record_type === 'terminal_seal') delete body.seal_sha256;
  else if ('seal_sha256' in body) return null;
  return sha256(canonicalStringify(body));
}
function receiptName(sequence, name) { if (RECEIPT_NAMES[sequence] !== name) throw new EvalError('evaluator_invalid', `unexpected receipt path for sequence ${sequence}`); return `${String(sequence).padStart(3, '0')}-${name}.json`; }
function validateEarlyIdentityFailure(outcome, payload, links, receiptDir) {
  if (outcome !== 'task_red' || ![3, 4, 5].includes(links.length)) return false;
  if (links.some((link, index) => link.sequence !== PREFIX[index])) {
    throw new EvalError('evaluator_invalid', 'early identity result requires an ordered qualified A prefix');
  }
  const receipts = links.map(link => readJson(path.join(receiptDir, link.path)));
  const [manifest, qualification, plan, pause, approval] = receipts;
  if (manifest.record_type !== 'manifest' || qualification.payload?.ok !== true || qualification.payload?.provider_invoked !== false
    || plan.payload?.outcome !== 'completed' || typeof plan.payload?.turn_id !== 'string' || !plan.payload.turn_id
    || typeof plan.payload?.session_id !== 'string' || !plan.payload.session_id
    || (pause && (pause.payload?.outcome !== 'completed' || typeof pause.payload?.turn_id !== 'string' || !pause.payload.turn_id
      || pause.payload?.session_id !== plan.payload.session_id))) {
    throw new EvalError('evaluator_invalid', 'early identity result lacks a completed qualified A session');
  }
  const selection = payload.plan_selection;
  const failure = payload.failure_code;
  if (approval) {
    const observed = approval.payload;
    if (!classifyPlanSelection(selection).ok || canonicalStringify(selection) !== canonicalStringify(plan.payload.lane_selection)
      || canonicalStringify(selection) !== canonicalStringify(pause.payload.lane_selection)) throw new EvalError('evaluator_invalid', 'approval failure selection does not match the presented A-turn observations');
    if (payload.stopped_before_execution !== true || observed?.ok !== false || observed.reason !== failure
      || observed.turn?.outcome !== 'completed' || observed.turn?.session_id !== plan.payload.session_id) {
      throw new EvalError('evaluator_invalid', 'early approval failure lacks a completed matching owner turn');
    }
    if (['selected_plan_identity_missing', 'selected_plan_identity_mismatch'].includes(failure)
      && observed.plan_selection?.ok === false && observed.plan_selection.reason === failure
      && classifyPlanSelection(observed.plan_selection, true).reason === failure) return true;
    if (observed.presented_plan_sha256 !== plan.payload.plan_sha256) throw new EvalError('evaluator_invalid', 'approval failure is not bound to the presented plan receipt');
    if (failure === 'approval_plan_mutated' && /^[0-9a-f]{64}$/i.test(observed.presented_plan_sha256 || '')
      && observed.plan_sha256 !== observed.presented_plan_sha256) return true;
    if (failure === 'approval_not_bound' && observed.plan_sha256 === observed.presented_plan_sha256
      && /^[0-9a-f]{64}$/i.test(observed.plan_sha256 || '') && (observed.plan_approved !== true
        || observed.approved_sha256 !== observed.plan_sha256 || observed.authority !== 'owner'
        || observed.approval_ref !== observed.expected_approval_ref)) return true;
    throw new EvalError('evaluator_invalid', 'early task_red requires matching approval failure evidence');
  }
  if (payload.stopped_before_approval !== true || !IDENTITY_FAILURES.has(failure) || !selection
    || selection.ok !== false || typeof selection.approved !== 'boolean' || selection.reason !== failure
    || selection.expected_path !== BROWNFIELD_PLAN) {
    throw new EvalError('evaluator_invalid', 'early task_red requires an allowlisted identity failure with matching selection evidence');
  }
  if (classifyPlanSelection(selection).reason !== failure) {
    throw new EvalError('evaluator_invalid', 'identity failure evidence contradicts the observed selection');
  }
  if (canonicalStringify(selection) !== canonicalStringify((pause || plan).payload.lane_selection)) throw new EvalError('evaluator_invalid', 'terminal selection does not match the recorded A-turn observation');
  return true;
}
export class ReceiptChain {
  constructor(runRoot, runId, options = {}) {
    if (!runId) throw new EvalError('evaluator_invalid', 'run ID is required');
    this.runRoot = path.resolve(runRoot);
    this.receiptDir = path.join(this.runRoot, 'receipts');
    this.runId = runId;
    this.links = [];
    mkdirp(this.receiptDir);
    if (options.resume) this.#loadExisting();
  }
  #loadExisting() {
    const files = fs.readdirSync(this.receiptDir).filter(name => /^\d{3}-.+\.json$/.test(name) && !name.startsWith('900-')).sort();
    for (const file of files) {
      const receipt = readJson(path.join(this.receiptDir, file));
      const actual = receiptHash(receipt);
      if (receipt.run_id !== this.runId || actual !== receipt.receipt_sha256 || receipt.sequence >= 900
        || receipt.schema_version !== 1 || receipt.record_type !== RECEIPT_TYPES[receipt.sequence]
        || this.links.some(link => link.sequence >= receipt.sequence)) throw new EvalError('evaluator_invalid', 'existing receipt prefix is invalid');
      if (file !== receiptName(receipt.sequence, RECEIPT_NAMES[receipt.sequence])) throw new EvalError('evaluator_invalid', 'existing receipt path is invalid');
      this.links.push({ path: file, sequence: receipt.sequence, sha256: actual });
    }
  }
  append(sequence, name, recordType, payload) {
    if (!Number.isInteger(sequence) || sequence < 0 || sequence >= 900) {
      throw new EvalError('evaluator_invalid', `invalid receipt sequence: ${sequence}`);
    }
    if (this.links.some(link => link.sequence >= sequence)) {
      throw new EvalError('evaluator_invalid', 'receipt sequence must be strictly increasing');
    }
    if (RECEIPT_TYPES[sequence] !== recordType) throw new EvalError('evaluator_invalid', 'unexpected receipt record type');
    const file = receiptName(sequence, name);
    const body = { schema_version: 1, record_type: recordType, run_id: this.runId, sequence, payload };
    const receipt = { ...body, receipt_sha256: sha256(canonicalStringify(body)) };
    writeExclusiveJson(path.join(this.receiptDir, file), receipt);
    const link = { path: file, sequence, sha256: receipt.receipt_sha256 };
    this.links.push(link);
    return link;
  }
  terminal(outcome, payload = {}, options = {}) {
    const publicResult = projectOutcome(outcome, options);
    const earlyIdentityResult = validateEarlyIdentityFailure(outcome, payload, this.links, this.receiptDir);
    if (publicResult.disposition !== 'invalid' && this.links.length !== PREFIX.length && !earlyIdentityResult) throw new EvalError('evaluator_invalid', 'product outcome requires a complete receipt chain');
    const body = { schema_version: 1, record_type: 'terminal_seal', run_id: this.runId, sequence: 900,
      payload: { ...payload, outcome, public: publicResult, links: this.links.map(link => ({ ...link })) } };
    const withReceipt = { ...body, receipt_sha256: sha256(canonicalStringify(body)) };
    const terminal = { ...withReceipt, seal_sha256: sha256(canonicalStringify(withReceipt)) };
    writeExclusiveJson(path.join(this.receiptDir, receiptName(900, 'terminal-seal')), terminal);
    return terminal;
  }
}
export function verifySeal(runRoot) {
  const receiptDir = path.join(path.resolve(runRoot), 'receipts');
  const terminalFile = path.join(receiptDir, receiptName(900, 'terminal-seal'));
  if (!fs.existsSync(terminalFile)) throw new EvalError('evaluator_invalid', 'terminal seal is missing');
  const terminal = readJson(terminalFile);
  if (terminal.schema_version !== 1 || terminal.record_type !== 'terminal_seal' || terminal.sequence !== 900 || !terminal.run_id) throw new EvalError('evaluator_invalid', 'terminal receipt schema mismatch');
  const { seal_sha256: observedSeal, ...sealBody } = terminal;
  if (sha256(canonicalStringify(sealBody)) !== observedSeal) throw new EvalError('evaluator_invalid', 'terminal seal hash mismatch');
  if (receiptHash(terminal) !== terminal.receipt_sha256) throw new EvalError('evaluator_invalid', 'terminal receipt hash mismatch');
  const links = terminal.payload?.links;
  if (!Array.isArray(links)) throw new EvalError('evaluator_invalid', 'terminal links are missing');
  const expectedFiles = new Set([path.basename(terminalFile)]);
  let lastSequence = -1;
  for (const link of links) {
    if (!link || path.basename(link.path) !== link.path || expectedFiles.has(link.path)) throw new EvalError('evaluator_invalid', 'duplicate or unsafe receipt link');
    if (!Number.isInteger(link.sequence) || link.sequence <= lastSequence || link.sequence >= 900) {
      throw new EvalError('evaluator_invalid', 'receipt links are reordered or invalid');
    }
    if (link.path !== receiptName(link.sequence, RECEIPT_NAMES[link.sequence])) throw new EvalError('evaluator_invalid', 'receipt path mismatch');
    const file = path.join(receiptDir, link.path);
    if (!fs.existsSync(file)) throw new EvalError('evaluator_invalid', `missing receipt: ${link.path}`);
    const receipt = readJson(file);
    if (receipt.schema_version !== 1 || receipt.run_id !== terminal.run_id || receipt.sequence !== link.sequence
      || receipt.record_type !== RECEIPT_TYPES[receipt.sequence]) throw new EvalError('evaluator_invalid', 'receipt identity mismatch');
    const actual = receiptHash(receipt);
    if (actual !== receipt.receipt_sha256 || actual !== link.sha256) throw new EvalError('evaluator_invalid', 'receipt hash mismatch');
    lastSequence = link.sequence;
    expectedFiles.add(link.path);
  }
  const normalPrefix = links.length <= PREFIX.length && links.every((link, index) => link.sequence === PREFIX[index]);
  if (!normalPrefix) throw new EvalError('evaluator_invalid', 'receipt links are not a valid prefix');
  const actualFiles = new Set(fs.readdirSync(receiptDir).filter(name => name.endsWith('.json')));
  if (actualFiles.size !== expectedFiles.size || [...actualFiles].some(name => !expectedFiles.has(name))) {
    throw new EvalError('evaluator_invalid', 'unlinked or replayed receipt found');
  }
  const publicResult = projectOutcome(terminal.payload.outcome, {
    genericReproductionSha256: terminal.payload.generic_reproduction_sha256,
  });
  if (canonicalStringify(publicResult) !== canonicalStringify(terminal.payload.public)) {
    throw new EvalError('evaluator_invalid', 'public outcome mapping mismatch');
  }
  const earlyIdentityResult = validateEarlyIdentityFailure(terminal.payload.outcome, terminal.payload, links, receiptDir);
  if (publicResult.disposition !== 'invalid' && links.length !== PREFIX.length && !earlyIdentityResult) throw new EvalError('evaluator_invalid', 'product outcome has an incomplete receipt chain');
  return { terminal, links, public: publicResult };
}
