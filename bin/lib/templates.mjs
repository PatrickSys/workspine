// templates.mjs - Project template and role installation/refresh helpers

import { createHash } from 'crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync } from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileHash, readManifest } from './manifest.mjs';
import { writeFileAtomic } from './atomic-write.mjs';
import { localizeStateDirReferences } from './rendering.mjs';

const TEMPLATE_GROUPS = [
  { name: 'delegates', source: ['templates', 'delegates'], target: ['templates', 'delegates'], manifestKey: 'delegates' },
  { name: 'research', source: ['templates', 'research'], target: ['templates', 'research'], manifestKey: 'research' },
  { name: 'codebase', source: ['templates', 'codebase'], target: ['templates', 'codebase'], manifestKey: 'codebase' },
  { name: 'brownfield-change', source: ['templates', 'brownfield-change'], target: ['templates', 'brownfield-change'], manifestKey: 'brownfieldChange' },
  { name: 'templates', source: ['templates'], target: ['templates'], manifestKey: 'root', rootOnly: true },
  { name: 'roles', source: null, target: ['templates', 'roles'], manifestKey: 'roles', roles: true },
];

function contentHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function pathIsInside(root, target) {
  const delta = relative(root, target);
  return delta === '' || (delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta));
}

function localizedTemplateContent(srcPath, { stateDirName = '.work' } = {}) {
  return localizeStateDirReferences(readFileSync(srcPath, 'utf-8'), { stateDirName });
}

function sourceTemplateBytes(srcPath, options) {
  return srcPath.endsWith('.md')
    ? Buffer.from(localizedTemplateContent(srcPath, options))
    : readFileSync(srcPath);
}

function sourceTemplateHash(srcPath, options) {
  return contentHash(sourceTemplateBytes(srcPath, options));
}

function listRoleFiles(agentsDir) {
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir).filter((file) => file.endsWith('.md') && file !== 'README.md' && !file.startsWith('_'));
}

function assertSafeSourceRoot(sourceRoot, trustedRoot, label) {
  const sourceStat = lstatSync(sourceRoot);
  const trustedStat = lstatSync(trustedRoot);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory() || trustedStat.isSymbolicLink() || !trustedStat.isDirectory()) {
    throw new Error(`Refusing template update: framework ${label} source root must be a real directory. Repair the installation and retry.`);
  }
  const realTrustedRoot = realpathSync(trustedRoot);
  const realSourceRoot = realpathSync(sourceRoot);
  if (!pathIsInside(realTrustedRoot, realSourceRoot)) {
    throw new Error(`Refusing template update: framework ${label} source root resolves outside its installation. Repair the installation and retry.`);
  }
  return { realTrustedRoot, realSourceRoot };
}

function sourceFilesForGroup(group, { distilledDir, agentsDir }) {
  const sourceRoot = group.roles ? agentsDir : join(distilledDir, ...group.source);
  if (!sourceRoot || !existsSync(sourceRoot)) return { sourceRoot, files: [] };
  const trustedRoot = group.roles ? agentsDir : distilledDir;
  assertSafeSourceRoot(sourceRoot, trustedRoot, group.name);
  const files = group.roles
    ? listRoleFiles(agentsDir)
    : readdirSync(sourceRoot).filter((file) => file.endsWith('.md'));
  return { sourceRoot, files };
}

function relativeTarget(group, file) {
  return [...group.target, file].join('/');
}

function manifestGroups(manifest) {
  if (!manifest || typeof manifest !== 'object' || !manifest.templates || typeof manifest.templates !== 'object' || !manifest.roles || typeof manifest.roles !== 'object') {
    return null;
  }
  const output = new Map();
  for (const group of TEMPLATE_GROUPS) {
    const hashes = group.roles ? manifest.roles : manifest.templates[group.manifestKey];
    if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) return null;
    for (const [file, hash] of Object.entries(hashes)) {
      if (!/^[^/\\]+\.md$/.test(file) || !/^[a-f0-9]{64}$/.test(hash)) return null;
      const target = relativeTarget(group, file);
      if (output.has(target)) return null;
      output.set(target, hash);
    }
  }
  return output;
}

export function validateTemplateOwnership(planningDir) {
  const manifestPath = join(planningDir, 'generation-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Refusing template update: generation manifest ownership is missing or corrupt. Restore a valid manifest or preserve the templates before retrying.');
  }
  const ownership = manifestGroups(readManifest(planningDir));
  if (!ownership) throw new Error('Refusing template update: generation manifest ownership is missing or corrupt. Restore a valid manifest or preserve the templates before retrying.');
  return ownership;
}

function templateContext(planningDir) {
  const root = resolve(planningDir);
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Refusing template update: planning root must be a real directory. Run init in a safe workspace and retry.');
  return { root, realRoot: realpathSync(root) };
}

function assertSafeTarget(context, absolutePath, label, { allowMissing = true } = {}) {
  if (!pathIsInside(context.root, absolutePath)) throw new Error(`Refusing template update: ${label} escapes the planning root. Move it aside and retry.`);
  let current = context.root;
  const parts = relative(context.root, dirname(absolutePath)).split(sep).filter(Boolean);
  for (const part of parts) {
    current = join(current, part);
    if (!existsSync(current)) {
      if (allowMissing) continue;
      throw new Error(`Refusing template update: ${label} parent is missing. Restore the managed directory and retry.`);
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing template update: ${label} parent must be a real directory. Move it aside and retry.`);
    if (!pathIsInside(context.realRoot, realpathSync(current))) throw new Error(`Refusing template update: ${label} parent resolves outside the planning root. Move it aside and retry.`);
  }
  if (!existsSync(absolutePath)) return null;
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing template update: ${label} must be a regular file. Move it aside and retry.`);
  if (!pathIsInside(context.realRoot, realpathSync(absolutePath))) throw new Error(`Refusing template update: ${label} resolves outside the planning root. Move it aside and retry.`);
  return stat;
}

function assertSafeSource(sourcePath, label) {
  const stat = lstatSync(sourcePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing template update: framework ${label} must be a regular file. Repair the installation and retry.`);
  const realSource = realpathSync(sourcePath);
  if (!realSource) throw new Error(`Refusing template update: framework ${label} could not be resolved safely. Repair the installation and retry.`);
}

function recoveryIdentity(targetPath, oldHash, newHash, action) {
  return contentHash(`${targetPath}\0${oldHash}\0${newHash}\0${action}`);
}

function recoveryPaths(planningDir, stateDirName, identity) {
  const relativeRoot = `${stateDirName}/.local/template-recovery`;
  return {
    root: resolve(planningDir, '.local', 'template-recovery'),
    bytes: resolve(planningDir, '.local', 'template-recovery', `${identity}.original`),
    receipt: resolve(planningDir, '.local', 'template-recovery', `${identity}.json`),
    relativeBytes: `${relativeRoot}/${identity}.original`,
  };
}

function ensureDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function writeRecovery(change) {
  const { recovery, originalBytes, targetPath, oldHash, newHash, action } = change;
  ensureDirectory(recovery.root);
  if (existsSync(recovery.bytes)) {
    if (!readFileSync(recovery.bytes).equals(originalBytes)) throw new Error(`Refusing template update: conflicting recovery bytes for ${targetPath}. Preserve the existing recovery and retry.`);
  } else {
    writeFileAtomic(recovery.bytes, originalBytes);
  }
  const receipt = {
    targetPath,
    action,
    oldHash,
    newHash,
    recoveryPath: recovery.relativeBytes,
  };
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2));
  if (existsSync(recovery.receipt)) {
    if (!readFileSync(recovery.receipt).equals(receiptBytes)) throw new Error(`Refusing template update: conflicting recovery receipt for ${targetPath}. Preserve the existing receipt and retry.`);
  } else {
    writeFileAtomic(recovery.receipt, receiptBytes);
  }
  if (!readFileSync(recovery.bytes).equals(originalBytes) || !readFileSync(recovery.receipt).equals(receiptBytes)) {
    throw new Error(`Refusing template update: recovery verification failed for ${targetPath}. No template was replaced.`);
  }
}

function expectedRecoveryReceipt(change) {
  return Buffer.from(JSON.stringify({
    targetPath: change.targetPath,
    action: change.action,
    oldHash: change.oldHash,
    newHash: change.newHash,
    recoveryPath: change.recovery.relativeBytes,
  }, null, 2));
}

function preflightRecovery(change) {
  const { recovery, originalBytes, targetPath } = change;
  const receiptBytes = expectedRecoveryReceipt(change);
  for (const [path, expected, label] of [
    [recovery.bytes, originalBytes, 'bytes'],
    [recovery.receipt, receiptBytes, 'receipt'],
  ]) {
    if (!existsSync(path)) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || !readFileSync(path).equals(expected)) {
      throw new Error(`Refusing template update: conflicting recovery ${label} for ${targetPath}. Preserve the existing recovery and retry.`);
    }
  }
}

function ownershipFromEntries(entries) {
  const templates = { delegates: {}, research: {}, codebase: {}, brownfieldChange: {}, root: {} };
  const roles = {};
  for (const entry of entries) {
    const group = entry.group ?? TEMPLATE_GROUPS.find((candidate) => candidate.manifestKey === entry.manifestKey && Boolean(candidate.roles) === Boolean(entry.roles));
    if (!group) continue;
    (group.roles ? roles : templates[group.manifestKey])[entry.file] = entry.newHash;
  }
  return { templates, roles };
}

/**
 * Read and validate every template write/removal before callers mutate a workspace.
 * The returned ownership projection is an explicit source allowlist, not a directory scan.
 */
export function planTemplateRefresh({ planningDir, distilledDir, agentsDir, stateDirName = '.work' }) {
  const context = templateContext(planningDir);
  const existingOwnership = validateTemplateOwnership(planningDir);

  const sourceEntries = [];
  for (const group of TEMPLATE_GROUPS) {
    const { sourceRoot, files } = sourceFilesForGroup(group, { distilledDir, agentsDir });
    for (const file of files) {
      const sourcePath = join(sourceRoot, file);
      assertSafeSource(sourcePath, `${group.name}/${file}`);
      const targetPath = relativeTarget(group, file);
      const absolutePath = resolve(planningDir, targetPath);
      assertSafeTarget(context, absolutePath, targetPath);
      sourceEntries.push({ group, file, sourcePath, targetPath, absolutePath, bytes: sourceTemplateBytes(sourcePath, { stateDirName }), newHash: sourceTemplateHash(sourcePath, { stateDirName }) });
    }
  }

  const knownSourceTargets = new Set(sourceEntries.map((entry) => entry.targetPath));
  const changes = [];
  for (const entry of sourceEntries) {
    const oldHash = existingOwnership?.get(entry.targetPath);
    if (existsSync(entry.absolutePath) && !oldHash) {
      throw new Error(`Refusing template update: ${entry.targetPath} is not manifest-owned. Move or rename the consumer file, then retry.`);
    }
    if (!existsSync(entry.absolutePath)) {
      changes.push({ ...entry, action: 'replace', oldHash: null, originalBytes: null });
      continue;
    }
    const currentHash = fileHash(entry.absolutePath);
    if (currentHash === entry.newHash) continue;
    changes.push({ ...entry, action: 'replace', oldHash: currentHash, originalBytes: currentHash === oldHash ? null : readFileSync(entry.absolutePath), managedHash: oldHash });
  }

  for (const [targetPath, expectedHash] of existingOwnership ?? []) {
    if (knownSourceTargets.has(targetPath)) continue;
    const absolutePath = resolve(planningDir, targetPath);
    assertSafeTarget(context, absolutePath, targetPath);
    if (!existsSync(absolutePath)) continue;
    const currentHash = fileHash(absolutePath);
    changes.push({ targetPath, absolutePath, action: 'remove', oldHash: currentHash, newHash: null, originalBytes: currentHash === expectedHash ? null : readFileSync(absolutePath), managedHash: expectedHash });
  }

  for (const change of changes) {
    if (!change.originalBytes) continue;
    change.recovery = recoveryPaths(planningDir, stateDirName, recoveryIdentity(change.targetPath, change.oldHash, change.newHash, change.action));
    assertSafeTarget(context, change.recovery.bytes, `recovery destination for ${change.targetPath}`);
    assertSafeTarget(context, change.recovery.receipt, `recovery receipt for ${change.targetPath}`);
    preflightRecovery(change);
  }

  return { changes, ownership: ownershipFromEntries(sourceEntries), context };
}

export function applyTemplateRefresh(plan, { isDry = false } = {}) {
  for (const change of plan.changes) {
    const displayTarget = change.targetPath.replace(/^templates\//, '');
    if (isDry) {
      console.log(`  - would ${change.action === 'remove' ? 'remove managed' : 'refresh'} ${displayTarget}`);
      continue;
    }
    assertSafeTarget(plan.context, change.absolutePath, change.targetPath);
    if (change.originalBytes) {
      console.log(`  - WARN: ${displayTarget} was modified locally; preserving a recovery copy before ${change.action}`);
      writeRecovery(change);
    }
    if (change.action === 'remove') {
      if (existsSync(change.absolutePath)) unlinkSync(change.absolutePath);
      console.log(`  - removed managed ${displayTarget}`);
      continue;
    }
    ensureDirectory(dirname(change.absolutePath));
    writeFileAtomic(change.absolutePath, change.bytes);
    console.log(`  - refreshed ${displayTarget}`);
  }
  return plan.ownership;
}

export function refreshTemplates(options) {
  if (!existsSync(options.planningDir)) {
    // `update --templates --dry` may inspect a fresh directory; it must not
    // bootstrap a state root merely to describe a prospective refresh.
    return { templates: { delegates: {}, research: {}, codebase: {}, brownfieldChange: {}, root: {} }, roles: {} };
  }
  const plan = planTemplateRefresh(options);
  return applyTemplateRefresh(plan, options);
}

export function validateTemplateSources({ distilledDir, agentsDir }) {
  for (const group of TEMPLATE_GROUPS) {
    const { sourceRoot, files } = sourceFilesForGroup(group, { distilledDir, agentsDir });
    for (const file of files) assertSafeSource(join(sourceRoot, file), `${group.name}/${file}`);
  }
}

/** Fresh install remains intentionally simple; only source-listed files become owned. */
export function installProjectTemplates({ planningDir, distilledDir, agentsDir, stateDirName = '.work' }) {
  validateTemplateSources({ distilledDir, agentsDir });
  const localTemplatesDir = join(planningDir, 'templates');
  const globalTemplatesDir = join(distilledDir, 'templates');
  const stateName = basename(planningDir);
  if (!existsSync(localTemplatesDir) && existsSync(globalTemplatesDir)) {
    copyTemplateTree(globalTemplatesDir, localTemplatesDir, { stateDirName });
    console.log(`  - copied templates to ${stateName}/templates/`);
  } else if (existsSync(localTemplatesDir)) {
    console.log(`  - ${stateName}/templates/ already exists`);
  } else {
    console.log('  - WARN: missing distilled/templates/; cannot copy templates');
  }
  const localRolesDir = join(localTemplatesDir, 'roles');
  if (!existsSync(localRolesDir) && existsSync(agentsDir)) {
    mkdirSync(localRolesDir, { recursive: true });
    for (const file of listRoleFiles(agentsDir)) copyTemplateFile(join(agentsDir, file), join(localRolesDir, file), { stateDirName });
    console.log(`  - copied role contracts to ${stateName}/templates/roles/`);
  } else if (existsSync(localRolesDir)) {
    console.log(`  - ${stateName}/templates/roles/ already exists`);
  }
}

export function explicitTemplateOwnership({ planningDir, distilledDir, agentsDir, stateDirName = '.work' }) {
  const entries = [];
  for (const group of TEMPLATE_GROUPS) {
    const { sourceRoot, files } = sourceFilesForGroup(group, { distilledDir, agentsDir });
    for (const file of files) {
      const target = resolve(planningDir, relativeTarget(group, file));
      if (!existsSync(target)) continue;
      entries.push({ manifestKey: group.manifestKey, roles: group.roles, file, newHash: fileHash(target) });
    }
  }
  return ownershipFromEntries(entries);
}

function copyTemplateFile(srcPath, destPath, options) {
  ensureDirectory(dirname(destPath));
  writeFileAtomic(destPath, sourceTemplateBytes(srcPath, options));
}

function copyTemplateTree(srcDir, destDir, options) {
  validateTemplateTree(srcDir);
  copyValidatedTemplateTree(srcDir, destDir, options);
}

function validateTemplateTree(srcDir) {
  const sourceStat = lstatSync(srcDir);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new Error('Refusing template install: framework template tree must be a real directory. Repair the installation and retry.');
  }
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const stat = lstatSync(srcPath);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`Refusing template install: framework template ${entry} must be a regular file or real directory. Repair the installation and retry.`);
    }
    if (stat.isDirectory()) validateTemplateTree(srcPath);
  }
}

function copyValidatedTemplateTree(srcDir, destDir, options) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    if (lstatSync(srcPath).isDirectory()) copyValidatedTemplateTree(srcPath, destPath, options);
    else copyTemplateFile(srcPath, destPath, options);
  }
}
