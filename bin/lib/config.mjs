// models.mjs — Model profile management, config CRUD, and validation constants
//
// IMPORTANT: No module-scope process.cwd() — ESM caching means sub-modules
// evaluate once, so CWD must be computed inside function bodies.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CLAUDE_MODEL_PROFILES } from '../adapters/claude.mjs';
import { detectOpenCodeConfiguredModel } from '../adapters/opencode.mjs';
import { parseFlagValue, output } from './cli-utils.mjs';
import { validateCommandShape } from './init-runtime.mjs';
import { assertStateAuthority, resolveStateDir } from './state-dir.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';

export const DEFAULT_GIT_PROTOCOL = {
  branch: 'Follow the existing repo or team branching convention. Use a feature branch for significant changes when no convention exists.',
  commit: 'Group changes logically and follow the existing repo conventions. Do not mention phase, plan, or task IDs unless explicitly requested.',
  pr: 'Follow the existing repo or team review workflow. Do not assume PR creation, timing, or naming unless explicitly requested.',
};

// Rigor controls the current workflow's alignment and quality gates. Model profiles
// remain a separate cost/quality selection axis. `max` is accepted only for stored
// configuration and CLI compatibility; it resolves to the currently implemented
// high gates rather than promising a distinct interaction mode.
export const RIGOR_PROFILES = {
  low:    { researchDepth: 'fast',     workflow: { research: false, discuss: false, planCheck: false, verifier: true } },
  medium: { researchDepth: 'balanced', workflow: { research: true,  discuss: false, planCheck: true,  verifier: true } },
  high:   { researchDepth: 'deep',     workflow: { research: true,  discuss: true,  planCheck: true,  verifier: true } },
};

// Legacy rigor names map silently to the new levels so old configs and callers keep
// working. medium is behaviorally identical to the old balanced default.
export const RIGOR_ALIASES = { quick: 'low', balanced: 'medium', thorough: 'high' };

export const RIGOR_LEVELS = ['low', 'medium', 'high', 'max'];
export const RIGOR_STEPS = ['plan', 'execute', 'verify'];

// This is a description of the receipt fields carried by the portable workflow
// surfaces.  It is emitted by `rigor show` so consumers can validate the
// contract without inventing a parallel receipt format.
export const RIGOR_RECEIPT_FIELDS = [
  'schema_version',
  'phase',
  'task',
  'requested_level',
  'effective_level',
  'interactive',
  'frontier_questions',
  'agent_discretion_exemptions',
  'alignment',
  'plan_check',
  'execution',
  'verification',
  'claim_limit',
  'terminal_result',
  'next_action',
];

export const COST_PROFILES = {
  budget:   { modelProfile: 'budget',   parallelization: false },
  balanced: { modelProfile: 'balanced', parallelization: true  },
  quality:  { modelProfile: 'quality',  parallelization: true  },
};

export function resolveRigor(id) {
  const key = RIGOR_ALIASES[id] ?? id;
  return RIGOR_PROFILES[key === 'max' ? 'high' : key] ?? RIGOR_PROFILES.medium;
}
export function resolveCost(id)  { return COST_PROFILES[id]  ?? COST_PROFILES.balanced;  }

// Per-step rigor: an explicit rigorOverrides[step] wins, else the project rigorProfile,
// else medium. A missing override is not "off" — it just means "follow the main knob".
export function resolveStepRigor(config, step) {
  return resolveRigor(requestedRigorLevel(config, step));
}

export function requestedRigorLevel(config, step) {
  return config?.rigorOverrides?.[step] ?? config?.rigorProfile ?? 'medium';
}

export function effectiveRigorLevel(config, step) {
  const requested = requestedRigorLevel(config, step);
  const normalized = RIGOR_ALIASES[requested] ?? requested;
  return normalized === 'max' ? 'high' : (RIGOR_PROFILES[normalized] ? normalized : 'medium');
}

export const VALID_MODEL_PROFILES = ['quality', 'balanced', 'budget'];
export const PORTABLE_AGENT_IDS = ['plan-checker', 'approach-explorer'];
export const MODEL_RUNTIME_IDS = ['claude', 'opencode', 'codex'];
export const MODEL_ID_PATTERN = /^[a-zA-Z0-9._\/:@-]+$/;

export function normalizeModelProfile(value) {
  return VALID_MODEL_PROFILES.includes(value) ? value : 'balanced';
}

export function buildDefaultConfig({ autoAdvance = false } = {}) {
  const rigor = resolveRigor('medium');
  const cost = resolveCost('balanced');
  const config = {
    rigorProfile: 'medium',
    ...rigor,
    ...cost,
    commitDocs: true,
    gitProtocol: { ...DEFAULT_GIT_PROTOCOL },
    initVersion: 'v1.1',
  };
  if (autoAdvance) config.autoAdvance = true;
  return config;
}

export function isProjectInitialized(cwd = process.cwd()) {
  return existsSync(join(resolveStateDir(cwd).dir, 'config.json'));
}

function configPathLabel(cwd = process.cwd()) {
  return `${resolveStateDir(cwd).name}/config.json`;
}

export function loadProjectModelConfig(cwd = process.cwd()) {
  const configPath = join(resolveStateDir(cwd).dir, 'config.json');
  if (!existsSync(configPath)) return buildDefaultConfig();

  try {
    return {
      ...buildDefaultConfig(),
      ...JSON.parse(readFileSync(configPath, 'utf-8')),
    };
  } catch (e) {
    console.error(`WARNING: ${configPathLabel(cwd)} is malformed (${e.message}). Using defaults.`);
    return buildDefaultConfig();
  }
}

function loadConfigForMutation(cwd = process.cwd()) {
  const state = resolveStateDir(cwd);
  const configPath = join(state.dir, 'config.json');
  const pathLabel = `${state.name}/config.json`;
  let raw;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (e) {
    return { ok: false, pathLabel, error: `could not read config file (${e.message})` };
  }
  try {
    return { ok: true, pathLabel, config: { ...buildDefaultConfig(), ...JSON.parse(raw) } };
  } catch (e) {
    return { ok: false, pathLabel, error: `malformed JSON (${e.message})` };
  }
}

export function ensureProjectConfig(cwd = process.cwd()) {
  mkdirSync(resolveStateDir(cwd).dir, { recursive: true });
  const config = loadProjectModelConfig(cwd);
  writeProjectConfig(config, cwd);
  return config;
}

export function writeProjectConfig(config, cwd = process.cwd()) {
  const configPath = join(resolveStateDir(cwd).dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function getPortableAgentProfile(config, agentId) {
  const override = config.agentModelProfiles?.[agentId];
  if (VALID_MODEL_PROFILES.includes(override)) return override;
  return normalizeModelProfile(config.modelProfile);
}

export function getRuntimeModelOverride(config, runtime, agentId) {
  const override = config.runtimeModelOverrides?.[runtime]?.[agentId];
  return typeof override === 'string' && override.trim() ? override.trim() : null;
}

export function resolveRuntimeAgentModel({ cwd = process.cwd(), runtime, agentId, profileMap = null }) {
  const config = loadProjectModelConfig(cwd);
  const runtimeOverride = getRuntimeModelOverride(config, runtime, agentId);
  if (runtimeOverride) return runtimeOverride;

  if (!profileMap) return null;
  const profile = getPortableAgentProfile(config, agentId);
  return profileMap[profile] ?? profileMap.balanced ?? null;
}

export function getRuntimeAgentModelState({ config, runtime, agentId, profileMap = null }) {
  const runtimeOverride = getRuntimeModelOverride(config, runtime, agentId);
  if (runtimeOverride) {
    return {
      mode: 'override',
      model: runtimeOverride,
      source: 'runtimeOverride',
    };
  }

  if (!profileMap) {
    return {
      mode: 'inherit',
      model: null,
      runtimeDetectedModel: null,
    };
  }

  const agentOverride = config.agentModelProfiles?.[agentId];
  const profile = getPortableAgentProfile(config, agentId);
  return {
    mode: 'mapped',
    model: profileMap[profile] ?? profileMap.balanced ?? null,
    source: VALID_MODEL_PROFILES.includes(agentOverride) ? 'agentModelProfile' : 'modelProfile',
  };
}

export function cmdModels(...modelArgs) {
  const grammarError = validateCommandShape('models', modelArgs);
  if (grammarError) {
    console.error(grammarError);
    process.exitCode = 1;
    return;
  }
  const cwd = resolveConfigCommandRoot();
  if (!cwd) return;
  const subcommand = modelArgs[0] || 'show';

  switch (subcommand) {
    case 'show':
      return cmdModelsShow(cwd);
    case 'profile':
      return cmdModelsProfile(modelArgs[1], cwd);
    case 'agent-profile':
      return cmdModelsAgentProfile(modelArgs.slice(1), cwd);
    case 'clear-agent-profile':
      return cmdModelsClearAgentProfile(modelArgs.slice(1), cwd);
    case 'set':
      return cmdModelsSetRuntimeOverride(modelArgs.slice(1), cwd);
    case 'clear':
      return cmdModelsClearRuntimeOverride(modelArgs.slice(1), cwd);
    default:
      console.error('Usage: gsdd models [show|profile|agent-profile|clear-agent-profile|set|clear]');
      process.exitCode = 1;
  }
}

function cmdModelsShow(cwd) {
  const config = loadProjectModelConfig(cwd);
  const ocCheckerOverride = getRuntimeModelOverride(config, 'opencode', 'plan-checker');
  const ocExplorerOverride = getRuntimeModelOverride(config, 'opencode', 'approach-explorer');
  const ocDetected = detectOpenCodeConfiguredModel(cwd);
  const codexCheckerOverride = getRuntimeModelOverride(config, 'codex', 'plan-checker');
  const codexExplorerOverride = getRuntimeModelOverride(config, 'codex', 'approach-explorer');
  output({
    modelProfile: normalizeModelProfile(config.modelProfile),
    agentModelProfiles: config.agentModelProfiles || {},
    runtimeModelOverrides: config.runtimeModelOverrides || {},
    effective: {
      claude: {
        'plan-checker': getRuntimeAgentModelState({
          config,
          runtime: 'claude',
          agentId: 'plan-checker',
          profileMap: CLAUDE_MODEL_PROFILES,
        }),
        'approach-explorer': getRuntimeAgentModelState({
          config,
          runtime: 'claude',
          agentId: 'approach-explorer',
          profileMap: CLAUDE_MODEL_PROFILES,
        }),
      },
      opencode: {
        'plan-checker': {
          mode: ocCheckerOverride ? 'override' : 'inherit',
          model: ocCheckerOverride,
          runtimeDetectedModel: ocDetected,
        },
        'approach-explorer': {
          mode: ocExplorerOverride ? 'override' : 'inherit',
          model: ocExplorerOverride,
          runtimeDetectedModel: ocDetected,
        },
      },
      codex: {
        'plan-checker': {
          mode: codexCheckerOverride ? 'override' : 'inherit',
          model: codexCheckerOverride,
        },
        'approach-explorer': {
          mode: codexExplorerOverride ? 'override' : 'inherit',
          model: codexExplorerOverride,
        },
      },
    },
    detectedRuntimeModels: {
      opencode: ocDetected,
    },
    hints: (!ocCheckerOverride || !ocExplorerOverride) ? {
      opencode: 'OpenCode currently inherits its runtime model unless you set an explicit override. Use gsdd models set --runtime opencode --agent <agent-id> --model <provider/model-id> to inject an explicit agent model.',
    } : undefined,
  });
}

function cmdModelsProfile(profile, cwd) {
  if (!VALID_MODEL_PROFILES.includes(profile)) {
    console.error(`ERROR: Invalid profile "${profile}". Valid profiles: ${VALID_MODEL_PROFILES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (!isProjectInitialized(cwd)) {
    console.error('ERROR: Project not initialized. Run gsdd init first.');
    process.exitCode = 1;
    return;
  }

  const result = loadConfigForMutation(cwd);
  if (!result.ok) {
    console.error(`ERROR: ${result.pathLabel} is malformed (${result.error}). Fix the file manually before running model mutations.`);
    process.exitCode = 1;
    return;
  }

  result.config.modelProfile = profile;
  writeProjectConfig(result.config, cwd);
  console.log(`  - set modelProfile to ${profile}`);
  console.log('  Run gsdd update to regenerate adapter files.');
}

function cmdModelsAgentProfile(args, cwd) {
  const agent = parseFlagValue(args, '--agent').value;
  const profile = parseFlagValue(args, '--profile').value;

  if (!PORTABLE_AGENT_IDS.includes(agent)) {
    console.error(`ERROR: Invalid agent "${agent}". Valid agents: ${PORTABLE_AGENT_IDS.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (!VALID_MODEL_PROFILES.includes(profile)) {
    console.error(`ERROR: Invalid profile "${profile}". Valid profiles: ${VALID_MODEL_PROFILES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (!isProjectInitialized(cwd)) {
    console.error('ERROR: Project not initialized. Run gsdd init first.');
    process.exitCode = 1;
    return;
  }

  const result = loadConfigForMutation(cwd);
  if (!result.ok) {
    console.error(`ERROR: ${result.pathLabel} is malformed (${result.error}). Fix the file manually before running model mutations.`);
    process.exitCode = 1;
    return;
  }

  result.config.agentModelProfiles = result.config.agentModelProfiles || {};
  result.config.agentModelProfiles[agent] = profile;
  writeProjectConfig(result.config, cwd);
  console.log(`  - set ${agent} semantic profile to ${profile}`);
  console.log('  Run gsdd update to regenerate adapter files.');
}

function cmdModelsClearAgentProfile(args, cwd) {
  const agent = parseFlagValue(args, '--agent').value;
  if (!PORTABLE_AGENT_IDS.includes(agent)) {
    console.error(`ERROR: Invalid agent "${agent}". Valid agents: ${PORTABLE_AGENT_IDS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (!isProjectInitialized(cwd)) {
    console.error('ERROR: Project not initialized. Run gsdd init first.');
    process.exitCode = 1;
    return;
  }

  const result = loadConfigForMutation(cwd);
  if (!result.ok) {
    console.error(`ERROR: ${result.pathLabel} is malformed (${result.error}). Fix the file manually before running model mutations.`);
    process.exitCode = 1;
    return;
  }

  if (result.config.agentModelProfiles) {
    delete result.config.agentModelProfiles[agent];
    if (Object.keys(result.config.agentModelProfiles).length === 0) {
      delete result.config.agentModelProfiles;
    }
  }
  writeProjectConfig(result.config, cwd);
  console.log(`  - cleared semantic profile override for ${agent}`);
  console.log('  Run gsdd update to regenerate adapter files.');
}

function cmdModelsSetRuntimeOverride(args, cwd) {
  const runtime = parseFlagValue(args, '--runtime').value;
  const agent = parseFlagValue(args, '--agent').value;
  const model = parseFlagValue(args, '--model').value;

  if (!MODEL_RUNTIME_IDS.includes(runtime)) {
    console.error(`ERROR: Invalid runtime "${runtime}". Valid runtimes: ${MODEL_RUNTIME_IDS.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (!PORTABLE_AGENT_IDS.includes(agent)) {
    console.error(`ERROR: Invalid agent "${agent}". Valid agents: ${PORTABLE_AGENT_IDS.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (!model) {
    console.error('ERROR: --model requires a value.');
    process.exitCode = 1;
    return;
  }
  if (!MODEL_ID_PATTERN.test(model.trim())) {
    console.error('ERROR: Model ID contains invalid characters. Only alphanumeric, dots, hyphens, underscores, forward slashes, colons, and @ are allowed.');
    process.exitCode = 1;
    return;
  }

  if (!isProjectInitialized(cwd)) {
    console.error('ERROR: Project not initialized. Run gsdd init first.');
    process.exitCode = 1;
    return;
  }

  const result = loadConfigForMutation(cwd);
  if (!result.ok) {
    console.error(`ERROR: ${result.pathLabel} is malformed (${result.error}). Fix the file manually before running model mutations.`);
    process.exitCode = 1;
    return;
  }

  result.config.runtimeModelOverrides = result.config.runtimeModelOverrides || {};
  result.config.runtimeModelOverrides[runtime] = result.config.runtimeModelOverrides[runtime] || {};
  result.config.runtimeModelOverrides[runtime][agent] = model.trim();
  writeProjectConfig(result.config, cwd);
  console.log(`  - set ${runtime} runtime override for ${agent}`);
  console.log('  Run gsdd update to regenerate adapter files.');
}

function cmdModelsClearRuntimeOverride(args, cwd) {
  const runtime = parseFlagValue(args, '--runtime').value;
  const agent = parseFlagValue(args, '--agent').value;

  if (!MODEL_RUNTIME_IDS.includes(runtime)) {
    console.error(`ERROR: Invalid runtime "${runtime}". Valid runtimes: ${MODEL_RUNTIME_IDS.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (!PORTABLE_AGENT_IDS.includes(agent)) {
    console.error(`ERROR: Invalid agent "${agent}". Valid agents: ${PORTABLE_AGENT_IDS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (!isProjectInitialized(cwd)) {
    console.error('ERROR: Project not initialized. Run gsdd init first.');
    process.exitCode = 1;
    return;
  }

  const result = loadConfigForMutation(cwd);
  if (!result.ok) {
    console.error(`ERROR: ${result.pathLabel} is malformed (${result.error}). Fix the file manually before running model mutations.`);
    process.exitCode = 1;
    return;
  }

  if (result.config.runtimeModelOverrides?.[runtime]) {
    delete result.config.runtimeModelOverrides[runtime][agent];
    if (Object.keys(result.config.runtimeModelOverrides[runtime]).length === 0) {
      delete result.config.runtimeModelOverrides[runtime];
    }
    if (Object.keys(result.config.runtimeModelOverrides).length === 0) {
      delete result.config.runtimeModelOverrides;
    }
  }
  writeProjectConfig(result.config, cwd);
  console.log(`  - cleared ${runtime} runtime override for ${agent}`);
  console.log('  Run gsdd update to regenerate adapter files.');
}

// --- The rigor knob ---------------------------------------------------------
// gsdd rigor                      -> show the current level + per-step overrides
// gsdd rigor <low|medium|high|max>-> set the project-wide level
// gsdd rigor <plan|execute|verify> <level> -> override a single step

function describeRigorFlags(config) {
  const w = config.workflow ?? {};
  return {
    researchDepth: config.researchDepth,
    research: w.research,
    discuss: w.discuss,
    planCheck: w.planCheck,
    verifier: w.verifier,
  };
}

function activeWorkflow(config, profile) {
  const stored = config.workflow ?? {};
  const fallback = resolveRigor(profile).workflow;
  return {
    research: stored.research ?? fallback.research,
    discuss: stored.discuss ?? fallback.discuss,
    planCheck: stored.planCheck ?? fallback.planCheck,
    verifier: stored.verifier ?? fallback.verifier,
  };
}

function deprecatedRigorNoOps(config) {
  const workflow = config.workflow ?? {};
  return Object.fromEntries(
    ['showCode', 'askBeforeDecide']
      .filter((key) => Object.hasOwn(workflow, key))
      .map((key) => [key, 'ignored deprecated no-op']),
  );
}

function rigorPolicy(requestedLevel, effectiveLevel) {
  const path = {
    low: 'autopilot',
    medium: 'research-plan-check',
    high: 'discussion-plan-check-verifier',
    max: 'frontier-alignment-preview-verification',
  }[requestedLevel] ?? 'research-plan-check';
  return {
    requested_level: requestedLevel,
    effective_level: effectiveLevel,
    path,
    max: requestedLevel === 'max' ? path : null,
    headless_missing_interaction: 'unresolved',
    unknown_is_pass: false,
    preview_limit: 2,
    receipt_fields: [...RIGOR_RECEIPT_FIELDS],
  };
}

function printChangedFlags(before, after) {
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      console.log(`    ${key}: ${before[key]} -> ${after[key]}`);
    }
  }
}

export function cmdRigor(...rigorArgs) {
  const grammarError = validateCommandShape('rigor', rigorArgs);
  if (grammarError) {
    console.error(grammarError);
    process.exitCode = 1;
    return;
  }
  const cwd = resolveConfigCommandRoot();
  if (!cwd) return;
  const [first, second] = rigorArgs;
  if (!first || first === 'show') return cmdRigorShow(cwd);
  const normalizedFirst = RIGOR_ALIASES[first] ?? first;
  const normalizedSecond = RIGOR_ALIASES[second] ?? second;
  if (RIGOR_STEPS.includes(first)) return cmdRigorSetStep(first, normalizedSecond, cwd);
  if (RIGOR_LEVELS.includes(normalizedFirst)) return cmdRigorSetProfile(normalizedFirst, cwd);
  console.error(
    `ERROR: Invalid rigor argument "${first}". Usage: gsdd rigor [show | ${RIGOR_LEVELS.join('|')} | <${RIGOR_STEPS.join('|')}> <level>]`,
  );
  process.exitCode = 1;
}

function cmdRigorShow(cwd) {
  const config = loadProjectModelConfig(cwd);
  const base = config.rigorProfile ?? 'medium';
  const requested = [base, ...Object.values(config.rigorOverrides ?? {})];
  const usesMaxCompatibility = requested.includes('max');
  const effective = {
    plan: effectiveRigorLevel(config, 'plan'),
    execute: effectiveRigorLevel(config, 'execute'),
    verify: effectiveRigorLevel(config, 'verify'),
  };
  const steps = Object.fromEntries(RIGOR_STEPS.map((step) => {
    const requestedLevel = requestedRigorLevel(config, step);
    const effectiveLevel = effective[step];
    return [step, {
      requested_level: requestedLevel,
      effective_level: effectiveLevel,
      policy: rigorPolicy(requestedLevel, effectiveLevel),
    }];
  }));
  output({
    rigorProfile: base,
    rigorOverrides: config.rigorOverrides ?? {},
    // Snake-case fields are the portable receipt vocabulary; the existing
    // fields remain for compatibility with current callers.
    requested_level: base,
    effective_level: effective.plan,
    effective_levels: effective,
    effective,
    steps,
    workflow: activeWorkflow(config, base),
    deprecatedNoOps: deprecatedRigorNoOps(config),
    policy: rigorPolicy(base, effective.plan),
    compatibility: usesMaxCompatibility
      ? { max: 'Accepted for compatibility; it uses the current high rigor gates.' }
      : undefined,
  });
}

function cmdRigorSetProfile(level, cwd) {
  if (!isProjectInitialized(cwd)) {
    console.error('ERROR: Project not initialized. Run gsdd init first.');
    process.exitCode = 1;
    return;
  }
  const result = loadConfigForMutation(cwd);
  if (!result.ok) {
    console.error(`ERROR: ${result.pathLabel} is malformed (${result.error}). Fix the file manually before running rigor mutations.`);
    process.exitCode = 1;
    return;
  }

  const before = describeRigorFlags(result.config);
  const resolved = resolveRigor(level);
  result.config.rigorProfile = level;
  result.config.researchDepth = resolved.researchDepth;
  result.config.workflow = { ...resolved.workflow };
  const after = describeRigorFlags(result.config);
  writeProjectConfig(result.config, cwd);

  console.log(`  - set rigor to ${level}${level === 'max' ? ' (compatibility input; uses high gates)' : ''}`);
  printChangedFlags(before, after);
}

function cmdRigorSetStep(step, level, cwd) {
  if (!RIGOR_LEVELS.includes(level)) {
    console.error(`ERROR: Invalid rigor level "${level}". Valid levels: ${RIGOR_LEVELS.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (!isProjectInitialized(cwd)) {
    console.error('ERROR: Project not initialized. Run gsdd init first.');
    process.exitCode = 1;
    return;
  }
  const result = loadConfigForMutation(cwd);
  if (!result.ok) {
    console.error(`ERROR: ${result.pathLabel} is malformed (${result.error}). Fix the file manually before running rigor mutations.`);
    process.exitCode = 1;
    return;
  }

  result.config.rigorOverrides = result.config.rigorOverrides || {};
  const previous = result.config.rigorOverrides[step] ?? `(follows ${result.config.rigorProfile ?? 'medium'})`;
  result.config.rigorOverrides[step] = level;
  writeProjectConfig(result.config, cwd);
  console.log(`  - set ${step} rigor override: ${previous} -> ${level}`);
}

function resolveConfigCommandRoot() {
  const workspace = resolveWorkspaceContext([], { cwd: process.cwd() });
  if (workspace.invalid) {
    console.error(`ERROR: ${workspace.error}`);
    process.exitCode = 1;
    return null;
  }
  try {
    assertStateAuthority(workspace.state);
    return workspace.workspaceRoot;
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
    return null;
  }
}
