// manifest.mjs — Generation manifest for template versioning

import { createHash } from 'crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { writeFileAtomic } from './atomic-write.mjs';
import { ADAPTER_SOURCE_FILES } from '../adapters/index.mjs';
import {
  renderAgentsBoundedBlock,
  renderSkillContent,
  upsertBoundedBlock,
} from './rendering.mjs';
import { WORKFLOWS } from './workflows.mjs';

const MANIFEST_FILENAME = 'generation-manifest.json';

// These base profiles are official pre-adapter-ownership manifests reproduced
// from the published 0.28, 0.32, and 0.34 packages. The framework version alone
// is deliberately not used for admission: the historical packages report v1.4. The
// stable manifest fingerprint plus exact generated-file hashes is the bounded
// proof that lets update bridge only an untouched historical install.
const BASE_HISTORICAL_MANIFEST_PROFILES = Object.freeze([
  {
    id: 'gsdd-cli@0.28.0',
    fingerprint: '0bd1aef919fb7bb5bb6dd4b3e5d3b41fda5e1d60d1d9edd19b2c5a00e928a8fd',
    skillPrefix: 'gsdd-',
    files: Object.freeze({
      '.agents/skills/gsdd-audit-milestone/SKILL.md': 'afadeec5be873ebc30614c6b0016780ba0a9d038b6dada5fd7ebfeb1dca8c8ee',
      '.agents/skills/gsdd-complete-milestone/SKILL.md': 'feca3264c464db7b2e5f1b03704f88187da9adbfe762fcc540a3243bf444d468',
      '.agents/skills/gsdd-execute/SKILL.md': '5540142cdeb33bd8ff7c8b7824ff31a193cdbf1beb4954a009a9085eb3219071',
      '.agents/skills/gsdd-map-codebase/SKILL.md': '97b38edd85acdcca5bf35bb4f2fc2a80f514436f7735a586fa058f4e7e82732a',
      '.agents/skills/gsdd-new-milestone/SKILL.md': 'ce9c5e30af21bbbb0d653dcd98ab9d9b67741fd3cbfcef460398b3f34143a133',
      '.agents/skills/gsdd-new-project/SKILL.md': '141e9655ad4cabe0f5052a5845b2356d32d635034d3e0c4fc8cb01eaf9446a29',
      '.agents/skills/gsdd-pause/SKILL.md': '98558908df283f086cc043fb1d0830215dccb3a3d65b704ab38e7f3dcf3cba9b',
      '.agents/skills/gsdd-plan/SKILL.md': 'cbcc36b8fa5bc57bbc585d690dab4ba3ea3c8b2b2aad175909f4357f5612d45a',
      '.agents/skills/gsdd-progress/SKILL.md': '412359aa17c66a92cc1991f1a437c9db4af4550f416b7b4978b837f08975357f',
      '.agents/skills/gsdd-quick/SKILL.md': '6351d0795d06a5349a7a1db23bec378067285d0306c6dd2214b8918c30dea7f7',
      '.agents/skills/gsdd-resume/SKILL.md': '7a3e326a9f426f1166df8d9a48c8ecc0062f85df3e260ff0f821ce14b578e2d1',
      '.agents/skills/gsdd-verify-work/SKILL.md': '10651f8602a1bcd3c354ac75d69a91b42e09e77e34077da3f0040e96439acecf',
      '.agents/skills/gsdd-verify/SKILL.md': '48e6b10c27c44f9a3205ad89753d4a663b76a724e62e48f614ef6f051b2165ee',
      'AGENTS.md': '4fc750abb86f1ad174974c04ff08d16fdf7f20bc9aff2b87679731a13e697364',
    }),
  },
  {
    id: 'gsdd-cli@0.31.1-0.32.0',
    fingerprint: '1a3ab4c0f627be3533e6f80914619396507a2e2eb460b32384071bc030f61b1a',
    skillPrefix: 'gsdd-',
    files: Object.freeze({
      '.agents/skills/gsdd-audit-milestone/SKILL.md': 'e660d154dc350000a53949f09bf791eb25eae7b12a1a3c4e4fb8d9d8892f3b0d',
      '.agents/skills/gsdd-complete-milestone/SKILL.md': 'feca3264c464db7b2e5f1b03704f88187da9adbfe762fcc540a3243bf444d468',
      '.agents/skills/gsdd-execute/SKILL.md': 'f96338410fc9cceccc54118cb9af4f41242de35c5c0cb25111403ef0ac5e1d82',
      '.agents/skills/gsdd-map-codebase/SKILL.md': '97b38edd85acdcca5bf35bb4f2fc2a80f514436f7735a586fa058f4e7e82732a',
      '.agents/skills/gsdd-new-milestone/SKILL.md': 'ce9c5e30af21bbbb0d653dcd98ab9d9b67741fd3cbfcef460398b3f34143a133',
      '.agents/skills/gsdd-new-project/SKILL.md': '141e9655ad4cabe0f5052a5845b2356d32d635034d3e0c4fc8cb01eaf9446a29',
      '.agents/skills/gsdd-pause/SKILL.md': '98558908df283f086cc043fb1d0830215dccb3a3d65b704ab38e7f3dcf3cba9b',
      '.agents/skills/gsdd-plan/SKILL.md': 'd93defb67faa182b76af0f28fe7cb921a83e718186b3c1a8b1ba1cb58bb762f6',
      '.agents/skills/gsdd-progress/SKILL.md': '412359aa17c66a92cc1991f1a437c9db4af4550f416b7b4978b837f08975357f',
      '.agents/skills/gsdd-quick/SKILL.md': '9ff4868effda37ba5baee08251bda4a972b29aa299e59105d2f52fb3ea2a0b15',
      '.agents/skills/gsdd-resume/SKILL.md': '7a3e326a9f426f1166df8d9a48c8ecc0062f85df3e260ff0f821ce14b578e2d1',
      '.agents/skills/gsdd-verify-work/SKILL.md': '10651f8602a1bcd3c354ac75d69a91b42e09e77e34077da3f0040e96439acecf',
      '.agents/skills/gsdd-verify/SKILL.md': '7d526f008f038520482aa9e89bea051e663085bf0b127262b3a889f5801bbdd4',
      'AGENTS.md': '4fc750abb86f1ad174974c04ff08d16fdf7f20bc9aff2b87679731a13e697364',
    }),
  },
  {
    id: 'workspine@0.34.0',
    fingerprint: 'e6cb7869e74fddba83ac71b10a26f9077e36bfb6bccd4fdb68b2d9b0136b727f',
    skillPrefix: 'work-',
    files: Object.freeze({
      '.agents/skills/work-audit-milestone/SKILL.md': '2cdd54b813d92425d315c04fd082b0543a0c98e167d9207fc978f73682114d21',
      '.agents/skills/work-complete-milestone/SKILL.md': 'ffbefdeb97f7d36d1ca9a9bf7168865b0f15f7539133d49e6eb7cbbb464f7cab',
      '.agents/skills/work-execute/SKILL.md': '9c119faaf540a61bfc594de066bd6a0da164345df1a998c68c0f70de8c8635c1',
      '.agents/skills/work-map-codebase/SKILL.md': '0a4f539849106ac4d63a3d79dcb58fdaa408ce10bfbcc12ca536dbe5fbd69fa5',
      '.agents/skills/work-new-milestone/SKILL.md': '2df2eb3943afad7d7c268b0f8273ada4823eed131b3a545e3c7ee5221febeb45',
      '.agents/skills/work-new-project/SKILL.md': 'b65758bb52e9817d8d4e08c6f3b8c8ec816f4e9c0055a6d18c1e34aba9eeb676',
      '.agents/skills/work-pause/SKILL.md': '89fbc035dbb2e45657be7666a4f0008d6fe45fcba65b5758aba8ee89f34dc8f1',
      '.agents/skills/work-plan/SKILL.md': '7f62d832ad7bcbb247431c108808a8d333fbcacac2d4842051a3140edb837402',
      '.agents/skills/work-progress/SKILL.md': 'e65325a04f48248abe012422652482372d13e9da96eb6bdb189f50f2b7801c3e',
      '.agents/skills/work-quick/SKILL.md': 'b4bd0bdb6f0e867124679ca76133781beef618e86a78ae96cc36f620a029b65f',
      '.agents/skills/work-resume/SKILL.md': '884aea0cfdfb4196aa415ad00b9bd3d9ec0f6828f6130c48d8e13411e0540ab6',
      '.agents/skills/work-verify-work/SKILL.md': 'efe8ea79b6e41c8bedce4ab5a6132c2c1e03327f14fa2d7a685fec79c0795da3',
      '.agents/skills/work-verify/SKILL.md': '9311bbd99c169bbbb5b02d61622dc11c2881d5be4b17eb9f6edf6917b7bf340e',
      'AGENTS.md': '09b5920b971e1ac4f2ca1a8d91edfad498a997a255a3f78724d9af52420f1c08',
    }),
  },
]);

const [GSDD_028_PROFILE, GSDD_032_PROFILE, WORKSPINE_034_PROFILE] = BASE_HISTORICAL_MANIFEST_PROFILES;
const GSDD_029_FILES = Object.freeze({
  ...GSDD_032_PROFILE.files,
  '.agents/skills/gsdd-plan/SKILL.md': '3082c128c458dc0b8d18cfeddbdbe6eee31702d2a90ca06297ae6208bc3f38c4',
});
const WORKSPINE_033_FILES = Object.freeze({
  ...WORKSPINE_034_PROFILE.files,
  '.agents/skills/work-execute/SKILL.md': '08f74f0b79baf20898ece72e70534d78bb943ad14918006c9a39f48ce1b69688',
  '.agents/skills/work-map-codebase/SKILL.md': 'd559db7fc6ecc54a3dcb37e7c218fe2310c9c71bc3275a76094b917d686c59a9',
  '.agents/skills/work-new-milestone/SKILL.md': '70543973f23c4d27c8fc781deefaea2b703654dd4b1dd899b7b375120e0ccafc',
  '.agents/skills/work-plan/SKILL.md': '5329c6e992265f71e865d07acb786b72ba0f8b742b143dfa3cc88a2a3416a2d7',
  '.agents/skills/work-progress/SKILL.md': 'a80c549a8d12ef8e8be01d1a1a5ddfc7c31aec51bfa4ec3d416b664e1e83d773',
  '.agents/skills/work-quick/SKILL.md': '95b68dd2f6191bce428259b7d5ac99c653014de4f56a048c9bb5825bb603672c',
  '.agents/skills/work-resume/SKILL.md': 'a2a7f1106e2552b5aba153d24a784c02df8787fb70237cbb12c92ba97d41410f',
  '.agents/skills/work-verify/SKILL.md': 'b446e3a766948b3feb96aaa7ad835d8ea87d2d23d8d8365498298cae71f79c26',
});

// Published versions can share generated bytes while their manifests differ
// because templates or runtime helpers changed. Keep every reproduced stable
// manifest fingerprint explicit; never infer support from a version string.
const HISTORICAL_MANIFEST_PROFILES = Object.freeze([
  GSDD_028_PROFILE,
  { id: 'gsdd-cli@0.29.0-0.29.1', fingerprint: '247549208f8df96044d8de34c4830aa1c1c50d87fc52c6f9394de0f228e8b546', skillPrefix: 'gsdd-', files: GSDD_029_FILES },
  { id: 'gsdd-cli@0.29.2', fingerprint: '7941b27fb733d499d527c5b465e369722aeab5e9772304ac68131a4302bac07c', skillPrefix: 'gsdd-', files: GSDD_029_FILES },
  { id: 'gsdd-cli@0.30.0', fingerprint: 'e320969b3a05fae128e7b7bee16767d73f3c3500aa320e18b57cb121ef2aad18', skillPrefix: 'gsdd-', files: GSDD_029_FILES },
  { id: 'gsdd-cli@0.31.0', fingerprint: '0535f83ab6b225e9e65e42993be4901d83303afe6a087faa21110530ca543eb6', skillPrefix: 'gsdd-', files: GSDD_032_PROFILE.files },
  GSDD_032_PROFILE,
  { id: 'workspine@0.33.0', fingerprint: '939579529e2751d5d1097e45be8389e654a5f93928be375020d841d86e988ee0', skillPrefix: 'work-', files: WORKSPINE_033_FILES },
  WORKSPINE_034_PROFILE,
]);

/**
 * SHA-256 hex digest of file contents.
 */
export function fileHash(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Recursive { relativePath: sha256 } map for a directory.
 * Normalizes backslashes to forward slashes for cross-platform consistency.
 */
export function hashDirectory(dir, baseDir = dir) {
  const result = {};
  if (!existsSync(dir)) return result;

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      Object.assign(result, hashDirectory(fullPath, baseDir));
    } else {
      const rel = relative(baseDir, fullPath).replace(/\\/g, '/');
      result[rel] = fileHash(fullPath);
    }
  }

  return result;
}

function hashRelativeFiles(baseDir, relativePaths) {
  const normalizedPaths = [...new Set(relativePaths.map((file) => String(file).replace(/\\/g, '/')))].sort();
  return Object.fromEntries(normalizedPaths.map((file) => [file, fileHash(join(baseDir, file))]));
}

/**
 * Build a full manifest snapshot from installed project files.
 */
export function buildManifest({ planningDir, frameworkVersion, runtimeHelperPaths = null, templateOwnership, adapterOwnership = null, adapterInventory = null }) {
  const runtimeHelpersDir = join(planningDir, 'bin');

  // Generation ownership is always source-derived by init/update. A fallback
  // directory snapshot would silently adopt consumer files on any mutation path.
  if (!templateOwnership?.templates || !templateOwnership?.roles) {
    throw new Error('Refusing to build generation manifest without explicit template ownership. Re-run init/update with validated template sources.');
  }

  const runtimeHelpersHashes = Array.isArray(runtimeHelperPaths)
    ? hashRelativeFiles(planningDir, runtimeHelperPaths)
    : hashDirectory(runtimeHelpersDir, planningDir);

  const manifest = {
    frameworkVersion,
    generatedAt: new Date().toISOString(),
    templates: {
      ...templateOwnership.templates,
    },
    roles: templateOwnership.roles,
    runtimeHelpers: runtimeHelpersHashes,
  };
  if (adapterOwnership) {
    manifest.adapterSources = adapterOwnership.adapterSources;
    manifest.adapterFiles = adapterOwnership.adapterFiles;
    if (adapterOwnership.adapterSelection) manifest.adapterSelection = adapterOwnership.adapterSelection;
    if (adapterInventory) manifest.adapterInventory = adapterInventory;
  }
  return manifest;
}

function pathIsInside(root, target) {
  const delta = relative(root, target);
  return delta === '' || (delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta));
}

function sourceRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

// Kept local to avoid making the manifest a second authority for adapter
// discovery. The registry remains the source of the target list; this list is
// only the immutable source inventory recorded in the existing manifest.
function adapterSourceHashes() {
  const root = sourceRoot();
  return Object.fromEntries(ADAPTER_SOURCE_FILES.map((source) => [source, fileHash(join(root, source.replace(/^bin[\\/]/, '')))]));
}

function adapterOwnershipEntries(manifest) {
  const files = manifest?.adapterFiles;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
  const entries = new Map();
  for (const [relativePath, value] of Object.entries(files)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.adapter !== 'string' || value.adapter.length === 0
      || typeof value.source !== 'string' || value.source.length === 0
      || !/^[a-f0-9]{64}$/.test(value.sourceHash)
      || !/^[a-f0-9]{64}$/.test(value.hash)) return null;
    entries.set(relativePath.replace(/\\/g, '/'), value);
  }
  return entries;
}

function adapterSourcePath(source) {
  if (typeof source !== 'string' || !ADAPTER_SOURCE_FILES.includes(source) && source !== 'bin/lib/init-flow.mjs') {
    throw new Error(`Refusing adapter update: ${source || 'an owned source'} is not a known Workspine adapter source.`);
  }
  const absolute = join(sourceRoot(), source.replace(/^bin[\\/]/, ''));
  if (!existsSync(absolute)) throw new Error(`Refusing adapter update: source ${source} is missing from this package.`);
  return absolute;
}

function adapterRecoveryIdentity(targetPath, oldHash, sourceHash) {
  return createHash('sha256').update(`${targetPath}\0${oldHash}\0${sourceHash}\0replace`).digest('hex');
}

function adapterRecoveryPaths(planningDir, stateDirName, targetPath, oldHash, sourceHash) {
  const identity = adapterRecoveryIdentity(targetPath, oldHash, sourceHash);
  const root = resolve(planningDir, '.local', 'template-recovery');
  return {
    root,
    bytes: join(root, `${identity}.original`),
    receipt: join(root, `${identity}.json`),
    relativeBytes: `${stateDirName}/.local/template-recovery/${identity}.original`,
  };
}

function assertSafeAdapterTarget(workspaceRoot, absolutePath, label) {
  const root = resolve(workspaceRoot);
  const target = resolve(absolutePath);
  if (!pathIsInside(root, target)) throw new Error(`Refusing adapter update: ${label} escapes the workspace root. Move it aside and retry.`);

  let current = root;
  const parentParts = relative(root, dirname(target)).split(sep).filter(Boolean);
  for (const part of parentParts) {
    current = join(current, part);
    if (!existsSync(current)) continue;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing adapter update: ${label} parent must be a real directory.`);
    if (!pathIsInside(realpathSync(root), realpathSync(current))) throw new Error(`Refusing adapter update: ${label} parent resolves outside the workspace root.`);
  }

  let stat;
  try {
    // lstat deliberately sees dangling links; existsSync would incorrectly
    // classify them as missing and allow the generator to follow the link.
    stat = lstatSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw new Error(`Refusing adapter update: ${label} could not be inspected safely.`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing adapter update: ${label} must be a regular file.`);
  if (!pathIsInside(realpathSync(root), realpathSync(target))) throw new Error(`Refusing adapter update: ${label} resolves outside the workspace root.`);
}

function canonicalManifestValue(value) {
  if (Array.isArray(value)) return value.map(canonicalManifestValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalManifestValue(value[key])]));
  }
  return value;
}

function historicalManifestFingerprint(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || typeof manifest.generatedAt !== 'string') return null;
  const { generatedAt, ...withoutTimestamp } = manifest;
  void generatedAt;
  return createHash('sha256').update(JSON.stringify(canonicalManifestValue(withoutTimestamp))).digest('hex');
}

function historicalProfileForManifest(manifest) {
  const fingerprint = historicalManifestFingerprint(manifest);
  return HISTORICAL_MANIFEST_PROFILES.find((profile) => profile.fingerprint === fingerprint) ?? null;
}

function expectedCurrentSkillHash(workflow, stateDirName) {
  return createHash('sha256')
    .update(renderSkillContent(workflow, { stateDirName }))
    .digest('hex');
}

/**
 * Project ownership for an untouched pre-adapter-ownership manifest.
 *
 * The projection is intentionally read-only. It admits only the characterized
 * official manifests above, verifies every known historical
 * generated byte for a recognized v0.28-v0.34 profile, and returns current explicit targets plus desired replacement
 * hashes for the normal preflight. It also recognizes the exact current bytes
 * left by an interrupted bridge so retry can finish the manifest transition.
 * It never scans or adopts arbitrary legacy directories and it is not persisted
 * if preflight fails.
 */
export function bridgeHistoricalAdapterOwnership({ cwd, manifest, stateDirName = '.work' }) {
  const profile = historicalProfileForManifest(manifest);
  if (!profile) return null;

  const workspaceRoot = resolve(cwd);
  const source = 'bin/lib/init-flow.mjs';
  const sourceHash = fileHash(adapterSourcePath(source));
  const files = {};
  const replacementHashes = {};
  const legacyRemovals = [];

  const verifyHistoricalFile = (relativePath, expectedHash, migratedHash = null, migratedRelativePath = relativePath) => {
    const normalized = relativePath.replace(/\\/g, '/');
    const absolutePath = resolve(workspaceRoot, normalized);
    assertSafeAdapterTarget(workspaceRoot, absolutePath, normalized);
    if (!existsSync(absolutePath)) {
      const migratedNormalized = String(migratedRelativePath).replace(/\\/g, '/');
      if (migratedHash && migratedNormalized !== normalized) {
        const migratedAbsolutePath = resolve(workspaceRoot, migratedNormalized);
        assertSafeAdapterTarget(workspaceRoot, migratedAbsolutePath, migratedNormalized);
        if (existsSync(migratedAbsolutePath)) {
          if (fileHash(migratedAbsolutePath) === migratedHash) return 'migrated';
          throw new Error(`Refusing adapter update: ${migratedNormalized} collides with an unproven consumer file; move it aside, then retry.`);
        }
      }
      throw new Error(`Refusing adapter update: historical generated target ${normalized} is missing; restore the exact ${profile.id} generated bytes, then retry. Init cannot safely adopt unproven historical files.`);
    }
    const actualHash = fileHash(absolutePath);
    if (actualHash === expectedHash) return 'historical';
    if (migratedHash && actualHash === migratedHash) return 'migrated';
    throw new Error(`Refusing adapter update: historical generated target ${normalized} was modified; preserve the changed copy and restore the exact ${profile.id} generated bytes before retrying. Init cannot safely adopt modified historical files.`);
  };

  const currentSharedFiles = WORKFLOWS.map(({ name }) => `.agents/skills/${name}/SKILL.md`);
  for (const workflow of WORKFLOWS) {
    const slug = workflow.name.slice(workflow.name.indexOf('-') + 1);
    const currentPath = `.agents/skills/${workflow.name}/SKILL.md`;
    const legacyPath = `.agents/skills/${profile.skillPrefix}${slug}/SKILL.md`;
    const legacyHash = profile.files[legacyPath];
    if (!legacyHash) throw new Error(`Refusing adapter update: historical profile ${profile.id} is incomplete for ${legacyPath}.`);

    const desiredHash = expectedCurrentSkillHash(workflow, stateDirName);
    const historicalState = verifyHistoricalFile(legacyPath, legacyHash, desiredHash, currentPath);
    if (currentPath !== legacyPath && existsSync(resolve(workspaceRoot, currentPath))) {
      assertSafeAdapterTarget(workspaceRoot, resolve(workspaceRoot, currentPath), currentPath);
      if (fileHash(resolve(workspaceRoot, currentPath)) !== desiredHash) {
        throw new Error(`Refusing adapter update: ${currentPath} collides with an unproven consumer file; move it aside, then retry.`);
      }
    }
    if (profile.skillPrefix === 'gsdd-' && currentPath !== legacyPath && historicalState === 'historical') {
      legacyRemovals.push({
        relativePath: legacyPath,
        expectedHash: legacyHash,
        migratedRelativePath: currentPath,
        migratedHash: desiredHash,
      });
    }

    // The historical hash is retained only for this in-memory preflight. The
    // normal update writer records the hash of the current generated bytes.
    files[currentPath] = {
      adapter: 'shared-skills',
      source,
      sourceHash,
      hash: legacyHash,
    };
    replacementHashes[currentPath] = desiredHash;
  }

  const agentsHash = profile.files['AGENTS.md'];
  if (!agentsHash) throw new Error(`Refusing adapter update: historical profile ${profile.id} is incomplete for AGENTS.md.`);
  const agentsPath = resolve(workspaceRoot, 'AGENTS.md');
  assertSafeAdapterTarget(workspaceRoot, agentsPath, 'AGENTS.md');
  if (!existsSync(agentsPath)) throw new Error(`Refusing adapter update: historical generated target AGENTS.md is missing; restore the exact ${profile.id} generated bytes, then retry. Init cannot safely adopt unproven historical files.`);
  const desiredAgents = upsertBoundedBlock(readFileSync(agentsPath, 'utf-8'), renderAgentsBoundedBlock({ stateDirName }));
  const desiredAgentsHash = createHash('sha256').update(desiredAgents).digest('hex');
  verifyHistoricalFile('AGENTS.md', agentsHash, desiredAgentsHash);
  files['AGENTS.md'] = {
    adapter: 'agents',
    source: 'bin/adapters/agents.mjs',
    sourceHash: fileHash(adapterSourcePath('bin/adapters/agents.mjs')),
    hash: agentsHash,
  };
  replacementHashes['AGENTS.md'] = desiredAgentsHash;

  return {
    profileId: profile.id,
    manifest: {
      ...manifest,
      adapterSources: adapterSourceHashes(),
      adapterFiles: files,
      adapterSelection: ['agents'],
      adapterInventory: {
        'shared-skills': { source, files: currentSharedFiles },
        agents: { source: 'bin/adapters/agents.mjs', files: ['AGENTS.md'] },
      },
    },
    replacementHashes,
    pruningPlan: profile.skillPrefix === 'gsdd-'
      ? { workspaceRoot, profileId: profile.id, removals: legacyRemovals }
      : null,
  };
}

function assertHistoricalPruneRemovalReady(plan, removal) {
  const workspaceRoot = resolve(plan.workspaceRoot);
  const historicalPath = resolve(workspaceRoot, removal.relativePath);
  const migratedPath = resolve(workspaceRoot, removal.migratedRelativePath);
  assertSafeAdapterTarget(workspaceRoot, historicalPath, removal.relativePath);
  assertSafeAdapterTarget(workspaceRoot, migratedPath, removal.migratedRelativePath);

  if (!existsSync(migratedPath) || fileHash(migratedPath) !== removal.migratedHash) {
    throw new Error(`Refusing adapter update: cannot prune ${removal.relativePath} because ${removal.migratedRelativePath} is not the exact current Workspine-generated replacement.`);
  }
  if (!existsSync(historicalPath)) return false;
  if (fileHash(historicalPath) !== removal.expectedHash) {
    throw new Error(`Refusing adapter update: stale historical target ${removal.relativePath} changed before pruning; preserve it and retry after restoring the exact ${plan.profileId} generated bytes.`);
  }
  return true;
}

/** Remove only exact hash-proven pre-rename skill files after all replacements exist. */
export function applyHistoricalAdapterPruning(plan, { isDry = false } = {}) {
  if (!plan || !Array.isArray(plan.removals) || plan.removals.length === 0 || isDry) return 0;

  // Revalidate every deletion immediately before the first unlink. A partial
  // interrupted prune is retry-safe because the bridge also accepts a missing
  // legacy file only when its exact current replacement is already present.
  for (const removal of plan.removals) assertHistoricalPruneRemovalReady(plan, removal);

  let removed = 0;
  for (const removal of plan.removals) {
    if (!assertHistoricalPruneRemovalReady(plan, removal)) continue;
    const absolutePath = resolve(plan.workspaceRoot, removal.relativePath);
    unlinkSync(absolutePath);
    removed += 1;
  }
  return removed;
}

/**
 * Read-only preflight for all local generated adapter/shared-skill targets.
 * No directory, recovery, manifest, or target bytes are written here.
 */
export function planAdapterGeneration({ cwd, planningDir, targets, manifest, stateDirName = '.work', requireManifest = false, requireExistingNativeTargets = false, replacementHashes = null }) {
  const manifestPath = join(planningDir, MANIFEST_FILENAME);
  const hasManifest = existsSync(manifestPath);
  const ownership = adapterOwnershipEntries(manifest);
  if (requireManifest && (!hasManifest || !ownership || !manifest?.adapterSources || typeof manifest.adapterSources !== 'object' || Array.isArray(manifest.adapterSources))) {
    throw new Error('Refusing adapter update: generation manifest ownership is missing or corrupt. Restore a valid generation manifest from backup. If none exists, preserve the existing generated files and initialize a clean workspace; this workspace cannot be adopted safely in place.');
  }
  if (requireManifest && Array.isArray(manifest?.adapterSelection) && manifest?.adapterInventory && typeof manifest.adapterInventory === 'object') {
    const selectedAdapters = new Set(['shared-skills', ...manifest.adapterSelection]);
    for (const adapterName of selectedAdapters) {
      const inventory = manifest.adapterInventory[adapterName];
      if (!inventory || !Array.isArray(inventory.files)) {
        throw new Error(`Refusing adapter update: inventory for selected adapter ${adapterName} is missing or corrupt. Restore the manifest and retry.`);
      }
      for (const relativePath of inventory.files.map((file) => String(file).replace(/\\/g, '/'))) {
        if (!ownership.has(relativePath)) {
          throw new Error(`Refusing adapter update: ownership for selected target ${relativePath} is missing from the generation manifest. Restore the manifest and retry.`);
        }
      }
    }
  }
  const changes = [];
  const workspaceRoot = resolve(cwd);

  for (const target of targets) {
    const relativePath = String(target.relativePath).replace(/\\/g, '/');
    const absolutePath = resolve(workspaceRoot, relativePath);
    assertSafeAdapterTarget(workspaceRoot, absolutePath, relativePath);
    const targetExists = existsSync(absolutePath);
    if (!targetExists) {
      if (requireManifest && !ownership?.has(relativePath)) {
        throw new Error(`Refusing adapter update: ownership for missing target ${relativePath} is absent from the generation manifest. Restore the manifest and retry.`);
      }
      if (requireExistingNativeTargets && target.adapter !== 'shared-skills' && ownership?.has(relativePath)) {
        throw new Error(`Refusing adapter update: owned target ${relativePath} is missing. Restore it or re-run init to establish ownership.`);
      }
      continue;
    }

    const owned = ownership?.get(relativePath);
    if (!owned) {
      // A pre-existing AGENTS.md with the bounded marker is the one
      // compatibility case where init may extend a consumer file before the
      // first local manifest exists. The adapter's bounded upsert preserves
      // everything outside that marker; an unmarked file remains a collision.
      if (!hasManifest && target.adapter === 'agents') {
        const existing = readFileSync(absolutePath, 'utf-8');
        if (existing.includes('<!-- BEGIN GSDD -->') && existing.includes('<!-- END GSDD -->')) continue;
      }
      const reason = hasManifest
        ? 'is not generation-manifest-owned'
        : 'exists without a generation manifest';
      throw new Error(`Refusing adapter update: ${relativePath} ${reason}; move or rename the consumer file, then retry.`);
    }

    const source = target.source || owned.source;
    const sourcePath = adapterSourcePath(source);
    const currentSourceHash = fileHash(sourcePath);
    if (owned.source && owned.source !== source) {
      throw new Error(`Refusing adapter update: ${relativePath} has inconsistent source provenance. Restore the manifest entry and retry.`);
    }
    if (source !== 'bin/lib/init-flow.mjs' && (!manifest?.adapterSources || !Object.hasOwn(manifest.adapterSources, source))) {
      throw new Error(`Refusing adapter update: source provenance for ${source} is missing. Restore the manifest entry and retry.`);
    }
    if (manifest?.adapterSources?.[source] && !/^[a-f0-9]{64}$/.test(manifest.adapterSources[source])) {
      throw new Error(`Refusing adapter update: source provenance for ${source} is corrupt. Restore the manifest entry and retry.`);
    }
    const currentHash = fileHash(absolutePath);
    const expectedHash = replacementHashes?.[relativePath] ?? owned.hash;
    if (currentHash === expectedHash) continue;
    // Recovery records the source bytes that will actually replace the target,
    // never the stale source hash from the previous manifest generation.
    const sourceHash = currentSourceHash;
    const recovery = adapterRecoveryPaths(planningDir, stateDirName, relativePath, currentHash, sourceHash);
    for (const destination of [recovery.bytes, recovery.receipt]) {
      assertSafeAdapterTarget(workspaceRoot, destination, `recovery destination for ${relativePath}`);
      if (existsSync(destination)) {
        const stat = lstatSync(destination);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing adapter update: conflicting recovery for ${relativePath}. Preserve the existing recovery and retry.`);
      }
    }
    const originalBytes = readFileSync(absolutePath);
    const receipt = Buffer.from(JSON.stringify({
      targetPath: relativePath,
      action: 'replace',
      oldHash: currentHash,
      newHash: sourceHash,
      recoveryPath: recovery.relativeBytes,
    }, null, 2));
    if (existsSync(recovery.bytes) && !readFileSync(recovery.bytes).equals(originalBytes)) {
      throw new Error(`Refusing adapter update: conflicting recovery bytes for ${relativePath}. Preserve the existing recovery and retry.`);
    }
    if (existsSync(recovery.receipt) && !readFileSync(recovery.receipt).equals(receipt)) {
      throw new Error(`Refusing adapter update: conflicting recovery receipt for ${relativePath}. Preserve the existing recovery and retry.`);
    }
    changes.push({ relativePath, absolutePath, originalBytes, recovery, receipt });
  }

  return { changes, targets, ownership };
}

/** Persist byte-exact recovery evidence after a successful preflight. */
export function applyAdapterRecovery(plan, { isDry = false } = {}) {
  if (isDry) return;
  for (const change of plan.changes) {
    if (!existsSync(change.recovery.root)) mkdirSync(change.recovery.root, { recursive: true });
    if (!existsSync(change.recovery.bytes)) writeFileAtomic(change.recovery.bytes, change.originalBytes);
    if (!existsSync(change.recovery.receipt)) writeFileAtomic(change.recovery.receipt, change.receipt);
    if (!readFileSync(change.recovery.bytes).equals(change.originalBytes) || !readFileSync(change.recovery.receipt).equals(change.receipt)) {
      throw new Error(`Refusing adapter update: recovery verification failed for ${change.relativePath}. No adapter was replaced.`);
    }
  }
}

/** Build the adapter ownership projection from the registry's explicit targets. */
export function buildAdapterOwnership({ cwd, planningDir, targets, existingManifest = null, selectedPlatforms = [] }) {
  const existing = adapterOwnershipEntries(existingManifest) ?? new Map();
  const selected = new Set(
    Array.isArray(existingManifest?.adapterSelection)
      ? existingManifest.adapterSelection.filter((name) => typeof name === 'string')
      : [...existing].map(([, value]) => value?.adapter).filter((name) => typeof name === 'string'),
  );
  for (const platform of selectedPlatforms) selected.add(platform);
  selected.add('shared-skills');
  // Start from the validated existing ownership map. A scoped update only
  // reconciles its explicit targets; dropping the other entries would make
  // the next scoped update fail closed as an unowned collision.
  const files = Object.fromEntries(existing.entries());
  for (const target of targets) {
    const relativePath = String(target.relativePath).replace(/\\/g, '/');
    const absolutePath = resolve(cwd, relativePath);
    if (!existsSync(absolutePath)) continue;
    const prior = existing.get(relativePath);
    if (!selected.has(target.adapter) && prior) {
      files[relativePath] = prior;
      continue;
    }
    const source = target.source || 'bin/adapters/index.mjs';
    const sourceHash = target.sourceHash || fileHash(join(sourceRoot(), source.replace(/^bin[\\/]/, '')));
    files[relativePath] = {
      adapter: target.adapter,
      source,
      sourceHash,
      hash: fileHash(absolutePath),
    };
  }
  return {
    adapterSources: adapterSourceHashes(),
    adapterFiles: files,
    adapterSelection: [...selected].filter((name) => name !== 'shared-skills').sort(),
  };
}

/**
 * Read existing manifest from planningDir, or return null if missing/corrupt.
 */
export function readManifest(planningDir) {
  const manifestPath = join(planningDir, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return null;

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write generation-manifest.json to planningDir.
 */
export function writeManifest(planningDir, manifest) {
  const manifestPath = join(planningDir, MANIFEST_FILENAME);
  writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Compare installed files vs manifest hashes.
 * Returns { modified: string[], unchanged: string[], missing: string[] }
 * where each string is a relative filename.
 */
export function detectModifications(installedDir, manifestHashes) {
  const modified = [];
  const unchanged = [];
  const missing = [];

  if (!manifestHashes) return { modified, unchanged, missing };

  for (const [file, expectedHash] of Object.entries(manifestHashes)) {
    const fullPath = join(installedDir, file);
    if (!existsSync(fullPath)) {
      missing.push(file);
      continue;
    }
    const currentHash = fileHash(fullPath);
    if (currentHash === expectedHash) {
      unchanged.push(file);
    } else {
      modified.push(file);
    }
  }

  return { modified, unchanged, missing };
}
