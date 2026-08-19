import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, unlinkSync, writeFileSync, cpSync } from 'fs';
import { dirname, join, isAbsolute, relative, resolve, sep } from 'path';
import {
  buildPlanningCliHelperEntries,
  getDelegateContent,
  renderAgentsBoundedBlock,
  renderAgentsFileContent,
  renderOpenCodeCommandContent,
  renderSkillContent,
  upsertBoundedBlock,
} from './rendering.mjs';
import { buildManifest, fileHash, readManifest, writeManifest } from './manifest.mjs';
import { parseFlagValue, parseToolsFlag, parseAutoFlag } from './cli-utils.mjs';
import { buildDefaultConfig, COST_PROFILES, RIGOR_PROFILES } from './config.mjs';
import { applyTemplateRefresh, explicitTemplateOwnership, installProjectTemplates, planTemplateRefresh, refreshTemplates, validateTemplateOwnership, validateTemplateSources } from './templates.mjs';
import {
  detectPlatforms,
  getAdaptersToUpdate,
  getPostInitRoutingLines,
  normalizeRequestedTools,
  resolveAdapters,
  resolveInteractiveInitSession,
} from './init-runtime.mjs';
import { createInitPromptApi } from './init-prompts.mjs';
import { createAdapterRegistry } from '../adapters/index.mjs';
import { migrateLegacyState } from './state-migration.mjs';
import { resolveStateDir, stateAuthorityGate, MIGRATION_COMMAND } from './state-dir.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';

function contextAtWorkspaceRoot(ctx, workspaceRoot) {
  const state = resolveStateDir(workspaceRoot);
  if (resolve(ctx.cwd) === resolve(workspaceRoot)) {
    return { ...ctx, cwd: workspaceRoot, planningDir: state.dir, stateDirName: state.name };
  }
  const adapterContext = {
    cwd: workspaceRoot,
    workflows: ctx.workflows,
    stateDirName: state.name,
    renderAgentsBoundedBlock,
    renderAgentsFileContent,
    renderOpenCodeCommandContent,
    renderSkillContent,
    upsertBoundedBlock,
    getDelegateContent,
    loadProjectModelConfig: ctx.loadProjectModelConfig,
    getRuntimeModelOverride: ctx.getRuntimeModelOverride,
    resolveRuntimeAgentModel: ctx.resolveRuntimeAgentModel,
  };
  return {
    ...ctx,
    cwd: workspaceRoot,
    planningDir: state.dir,
    stateDirName: state.name,
    adapters: createAdapterRegistry(adapterContext),
  };
}

function validateKindContract(adapter, cwd) {
  if (!adapter.subagentFiles) return;
  if (adapter.kind === 'native_capable') {
    const missing = adapter.subagentFiles
      .map(f => join(cwd, f))
      .filter(p => !existsSync(p));
    if (missing.length > 0) {
      console.warn(
        `[WARN] ${adapter.name} adapter (kind=native_capable) missing expected subagent files:\n` +
        missing.map(p => `  - ${p}`).join('\n')
      );
    }
  } else if (adapter.kind === 'governance_only') {
    const unexpected = adapter.subagentFiles
      .map(f => join(cwd, f))
      .filter(p => existsSync(p));
    if (unexpected.length > 0) {
      console.warn(
        `[WARN] ${adapter.name} adapter (kind=governance_only) unexpectedly generated subagent files:\n` +
        unexpected.map(p => `  - ${p}`).join('\n')
      );
    }
  }
}

export function createCmdInit(ctx) {
  return async function cmdInit(...initArgs) {
    const workspace = resolveWorkspaceContext(initArgs, { cwd: ctx.cwd });
    if (workspace.invalid) {
      console.error(`ERROR: ${workspace.error}`);
      process.exitCode = 1;
      return;
    }
    const normalizedArgs = workspace.args;
    let initCtx = contextAtWorkspaceRoot(ctx, workspace.workspaceRoot);

    console.log('gsdd init - setting up GSDD workflow\n');

    const isAuto = parseAutoFlag(normalizedArgs);
    const wantsMigration = normalizedArgs.includes('--migrate');
    const toolsFlag = parseFlagValue(normalizedArgs, '--tools');
    const briefFlag = parseFlagValue(normalizedArgs, '--brief');
    let briefSource = null;

    if (toolsFlag.invalid) {
      console.error('ERROR: --tools requires a value. Example: npx -y workspine init --tools claude');
      process.exitCode = 1;
      return;
    }

    if (briefFlag.invalid) {
      console.error('ERROR: --brief requires a file path. Example: npx -y workspine init --brief project-idea.md');
      process.exitCode = 1;
      return;
    }

    if (briefFlag.value) {
      briefSource = isAbsolute(briefFlag.value) ? briefFlag.value : join(initCtx.cwd, briefFlag.value);
      if (!existsSync(briefSource)) {
        console.error(`ERROR: Brief file not found: ${briefFlag.value}`);
        process.exitCode = 1;
        return;
      }
    }

    const parsedTools = parseToolsFlag(normalizedArgs);
    if (isAuto && parsedTools.length === 0) {
      console.error('ERROR: --auto requires --tools <platform>. Example: npx -y workspine init --auto --tools claude');
      process.exitCode = 1;
      return;
    }

    let state = resolveStateDir(initCtx.cwd);
    const promptApi = ctx.initPromptApi || createInitPromptApi();

    if (state.status === 'legacy_migratable') {
      let approved = wantsMigration;
      if (!approved && !isAuto && process.stdin.isTTY) {
        approved = await promptApi.confirmLegacyMigration({ command: MIGRATION_COMMAND });
      }
      if (!approved) {
        console.error(`ERROR: ${stateAuthorityGate(state).message}`);
        process.exitCode = 1;
        return;
      }
      try {
        migrateLegacyState(initCtx.cwd);
      } catch (error) {
        console.error(`ERROR: Legacy state migration failed: ${error.message}`);
        process.exitCode = 1;
        return;
      }
      initCtx = contextAtWorkspaceRoot(initCtx, initCtx.cwd);
      state = resolveStateDir(initCtx.cwd);
      const postMigrationGate = stateAuthorityGate(state);
      if (!postMigrationGate.allowed || state.status !== 'current') {
        console.error(`ERROR: Migration did not establish an active .work/ root${postMigrationGate.message ? `: ${postMigrationGate.message}` : '.'}`);
        process.exitCode = 1;
        return;
      }
    } else {
      const gate = stateAuthorityGate(state);
      if (!gate.allowed) {
        console.error(`ERROR: ${gate.message}`);
        process.exitCode = 1;
        return;
      }
    }

    const interactiveSession = await resolveInteractiveInitSession({
      ctx: initCtx,
      promptApi,
      parsedTools,
      isAuto,
    });
    const { planningDir, stateDirName } = initCtx;

    const existed = existsSync(planningDir);
    // Existing state is consumer data. Validate template ownership and tracking
    // policy before mkdir/config/generated-surface writes can change anything.
    let templatePlan;
    let selectedConfig;
    try {
      validateTemplateSources(initCtx);
      const hasGeneratedTemplateState = existsSync(join(planningDir, 'templates'))
        || existsSync(join(planningDir, 'generation-manifest.json'));
      templatePlan = existed && hasGeneratedTemplateState
        ? planTemplateRefresh({ ...initCtx, planningDir, stateDirName })
        : null;
      selectedConfig = readSelectedConfig({
        planningDir,
        isAuto,
        preselectedConfig: interactiveSession.config,
      });
      preflightCommitDocsOwnership(initCtx.cwd, stateDirName, selectedConfig);
    } catch (error) {
      console.error(`ERROR: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    mkdirSync(join(planningDir, 'phases'), { recursive: true });
    mkdirSync(join(planningDir, 'research'), { recursive: true });
    console.log(existed
      ? `  - ${stateDirName}/ already exists (ensured subdirectories)`
      : `  - created ${stateDirName}/ directory structure`);

    installProjectTemplates(initCtx);
    if (templatePlan) applyTemplateRefresh(templatePlan);
    await ensureConfig({
      cwd: initCtx.cwd,
      planningDir,
      isAuto,
      promptApi,
      preselectedConfig: interactiveSession.config,
      stateDirName,
    });
    if (!selectedConfig.commitDocs) {
      ensureGitignoreEntry(initCtx.cwd, `${stateDirName}/`, `  - ensured ${stateDirName}/ is gitignored`);
    }
    ensureGitignoreEntry(initCtx.cwd, `${stateDirName}/.local/`, `  - ensured ${stateDirName}/.local/ is gitignored`);

    if (briefSource) {
      cpSync(briefSource, join(planningDir, 'PROJECT_BRIEF.md'));
      console.log(`  - copied project brief to ${stateDirName}/PROJECT_BRIEF.md`);
    }

    generateOpenStandardSkills(initCtx.cwd, initCtx.workflows, { stateDirName });
    console.log('  - generated open-standard skills (.agents/skills/gsdd-*)');

    const runtimeGeneration = generatePlanningCliHelpers(initCtx);
    console.log(`  - generated local workflow helpers (${stateDirName}/bin/gsdd*)`);

    for (const adapter of resolveAdapters(initCtx.adapters, interactiveSession.adapterTargets)) {
      adapter.generate();
      validateKindContract(adapter, initCtx.cwd);
      console.log(`  - ${adapter.summary('generated')}`);
    }

    const manifest = buildManifest({
      planningDir,
      frameworkVersion: ctx.frameworkVersion,
      runtimeHelperPaths: runtimeGeneration.runtimeHelperPaths,
      templateOwnership: templatePlan?.ownership ?? explicitTemplateOwnership(initCtx),
    });
    writeManifest(planningDir, manifest);
    console.log('  - wrote generation manifest');
    applyObsoleteRuntimeHelperCleanup(planningDir, runtimeGeneration.obsoleteRuntimeHelpers);

    console.log('\n\x1B[1m\x1B[32m✓ GSDD initialized.\x1B[0m');
    printInitSummary(interactiveSession.config ?? buildDefaultConfig({ autoAdvance: isAuto }));
    console.log('Next: choose the starting lane that fits your repo and current scope:\n');
    printPostInitRouting(interactiveSession.selectedRuntimes);
    console.log('\nSetup complete — this session will now exit.');
  };
}

export function createCmdUpdate(ctx) {
  return function cmdUpdate(...updateArgs) {
    const gate = stateAuthorityGate(resolveStateDir(ctx.cwd));
    if (!gate.allowed) {
      console.error(`ERROR: ${gate.message}`);
      process.exitCode = 1;
      return;
    }
    const isDry = updateArgs.includes('--dry');
    const doTemplates = updateArgs.includes('--templates');
    const { planningDir, stateDirName } = ctx;

    console.log(`gsdd update - regenerating adapter files${isDry ? ' (dry run)' : ''}\n`);

    const parsedTools = parseToolsFlag(updateArgs);
    const requested = normalizeRequestedTools(parsedTools);
    const platforms = parsedTools.length > 0 ? requested.adapterTargets : detectPlatforms(ctx.adapters);

    let updated = false;
    let runtimeGeneration = null;

    let templateOwnership = null;
    try {
      if (doTemplates) {
        templateOwnership = refreshTemplates({ ...ctx, isDry });
      } else if (existsSync(planningDir)) {
        // Updating helpers/adapters may write a new manifest: require valid
        // prior template ownership before any unrelated generated surface.
        validateTemplateOwnership(planningDir);
      }
    } catch (error) {
      console.error(`ERROR: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    if (doTemplates) {
      updated = true;
    }

    if (platforms.length > 0 || existsSync(planningDir) || hasGeneratedOpenStandardSkills(ctx.cwd)) {
      if (isDry) {
        console.log('  - would update open-standard skills (.agents/skills/gsdd-*)');
      } else {
        generateOpenStandardSkills(ctx.cwd, ctx.workflows, { stateDirName });
        console.log('  - updated open-standard skills (.agents/skills/gsdd-*)');
      }
      updated = true;
    }

    if (existsSync(planningDir)) {
      if (isDry) {
        console.log(`  - would update local workflow helpers (${stateDirName}/bin/gsdd*)`);
      } else {
        runtimeGeneration = generatePlanningCliHelpers(ctx);
        console.log(`  - updated local workflow helpers (${stateDirName}/bin/gsdd*)`);
      }
      updated = true;
    }

    for (const adapter of getAdaptersToUpdate(ctx.adapters, platforms)) {
      if (isDry) {
        console.log(`  - would update ${adapter.name} adapter`);
      } else {
        adapter.generate();
        validateKindContract(adapter, ctx.cwd);
        console.log(`  - ${adapter.summary('updated')}`);
      }
      updated = true;
    }

    if (!updated) {
      console.log('  - no adapters found to update (run `npx -y workspine init` first; bare `gsdd init` is equivalent only when globally installed)');
    } else if (isDry) {
      console.log('\nDry run complete. No files were written.\n');
    } else {
      if (runtimeGeneration) {
        const manifest = buildUpdateManifest({
          planningDir,
          frameworkVersion: ctx.frameworkVersion,
          updateTemplates: doTemplates,
          runtimeHelperPaths: runtimeGeneration.runtimeHelperPaths,
          templateOwnership,
        });
        if (manifest) {
          writeManifest(planningDir, manifest);
          console.log('  - updated generation manifest');
          applyObsoleteRuntimeHelperCleanup(planningDir, runtimeGeneration.obsoleteRuntimeHelpers);
        }
      }
      console.log('\nAdapters updated.\n');
    }
  };
}

function hasGeneratedOpenStandardSkills(cwd) {
  const skillsDir = join(cwd, '.agents', 'skills');
  if (!existsSync(skillsDir)) return false;

  try {
    return readdirSync(skillsDir, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() &&
      entry.name.startsWith('gsdd-') &&
      existsSync(join(skillsDir, entry.name, 'SKILL.md'))
    );
  } catch {
    return false;
  }
}

function generateOpenStandardSkills(cwd, workflows, { stateDirName = '.work' } = {}) {
  for (const workflow of workflows) {
    const dir = join(cwd, '.agents', 'skills', workflow.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), renderSkillContent(workflow, { stateDirName }));
  }
}

function generatePlanningCliHelpers({ packageName, packageVersion, planningDir, stateDirName = '.work' }) {
  const entries = buildPlanningCliHelperEntries({
    packageName,
    packageVersion,
    stateDirName,
  });
  const runtimeContext = managedRuntimeContext(planningDir);
  const obsoleteRuntimeHelpers = planObsoleteRuntimeHelperCleanup(planningDir, entries, runtimeContext);
  const preflight = preflightGeneratedRuntimeHelperTargets(planningDir, entries, runtimeContext);

  for (const { entry, absolutePath } of preflight.targets) {
    const currentContext = managedRuntimeContext(planningDir);
    assertSameManagedRuntimeRoots(preflight.runtimeContext, currentContext);
    // Best effort only: portable Node cannot close a hostile replacement race after this check.
    assertSafeGeneratedRuntimeHelperTarget(currentContext, absolutePath, entry.relativePath, false);
    writeFileSync(absolutePath, entry.content);
    if (!absolutePath.endsWith('.cmd')) {
      chmodSync(absolutePath, 0o755);
    }
  }

  return {
    runtimeHelperPaths: entries.map((entry) => entry.relativePath),
    obsoleteRuntimeHelpers,
  };
}

function pathIsStrictlyInside(root, target) {
  const pathWithinRoot = relative(root, target);
  return pathWithinRoot !== ''
    && pathWithinRoot !== '..'
    && !pathWithinRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathWithinRoot);
}

function managedRuntimeContext(planningDir) {
  const planningRoot = resolve(planningDir);
  const runtimeRoot = resolve(planningDir, 'bin');
  const realPlanningRoot = realpathSync(planningRoot);
  const planningRootIdentity = directoryIdentity(lstatSync(realPlanningRoot));

  let runtimeStat;
  try {
    runtimeStat = lstatSync(runtimeRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { runtimeRoot, realPlanningRoot, realRuntimeRoot: null, planningRootIdentity, runtimeRootIdentity: null };
    }
    throw error;
  }

  if (runtimeStat.isSymbolicLink() || !runtimeStat.isDirectory()) {
    throw new Error('Refusing to write generated runtime helpers: bin/ must be a real directory inside the planning root.');
  }

  const realRuntimeRoot = realpathSync(runtimeRoot);
  if (!pathIsStrictlyInside(realPlanningRoot, realRuntimeRoot)) {
    throw new Error('Refusing to write generated runtime helpers: bin/ resolves outside the planning root.');
  }

  return {
    runtimeRoot,
    realPlanningRoot,
    realRuntimeRoot,
    planningRootIdentity,
    runtimeRootIdentity: directoryIdentity(runtimeStat),
  };
}

function directoryIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino };
}

function sameDirectoryIdentity(left, right) {
  if (!left || !right) return left === right;
  return left.dev === right.dev && left.ino === right.ino;
}

function sameManagedPlanningRoot(expected, current) {
  return expected.realPlanningRoot === current.realPlanningRoot
    && sameDirectoryIdentity(expected.planningRootIdentity, current.planningRootIdentity);
}

function assertSameManagedRuntimeRoots(expected, current) {
  const runtimeRootChanged = expected.realRuntimeRoot !== current.realRuntimeRoot
    || !sameDirectoryIdentity(expected.runtimeRootIdentity, current.runtimeRootIdentity);
  if (!sameManagedPlanningRoot(expected, current) || runtimeRootChanged) {
    throw new Error('Refusing to write generated runtime helpers: planning or runtime root changed during generation.');
  }
}

function refuseGeneratedRuntimeHelperWrite(relativePath, reason) {
  const displayPath = String(relativePath).replace(/[\r\n]+/g, '?');
  throw new Error(`Refusing to write generated runtime helper ${displayPath}: ${reason}.`);
}

function ensureManagedRuntimeRoot(planningDir, runtimeContext) {
  if (runtimeContext.realRuntimeRoot) return runtimeContext;

  try {
    mkdirSync(runtimeContext.runtimeRoot);
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw new Error('Refusing to write generated runtime helpers: bin/ could not be created safely.');
    }
  }

  const createdContext = managedRuntimeContext(planningDir);
  if (!createdContext.realRuntimeRoot) {
    throw new Error('Refusing to write generated runtime helpers: bin/ could not be created safely.');
  }
  return createdContext;
}

function assertSafeGeneratedRuntimeHelperTarget(runtimeContext, absolutePath, relativePath, createParents) {
  if (!runtimeContext.realRuntimeRoot || !pathIsStrictlyInside(runtimeContext.runtimeRoot, absolutePath)) {
    refuseGeneratedRuntimeHelperWrite(relativePath, 'target must remain inside bin/');
  }

  const parentRelative = relative(runtimeContext.runtimeRoot, dirname(absolutePath));
  const parentParts = parentRelative === '' ? [] : parentRelative.split(sep);
  let currentPath = runtimeContext.runtimeRoot;

  for (const part of parentParts) {
    currentPath = join(currentPath, part);
    let stat;
    try {
      stat = lstatSync(currentPath);
    } catch (error) {
      if (error?.code !== 'ENOENT' || !createParents) {
        refuseGeneratedRuntimeHelperWrite(relativePath, 'parent could not be inspected safely');
      }
      try {
        mkdirSync(currentPath);
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') {
          refuseGeneratedRuntimeHelperWrite(relativePath, 'parent could not be created safely');
        }
      }
      try {
        stat = lstatSync(currentPath);
      } catch {
        refuseGeneratedRuntimeHelperWrite(relativePath, 'parent could not be inspected safely');
      }
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      refuseGeneratedRuntimeHelperWrite(relativePath, 'parent must be a real directory inside bin/');
    }

    let realParent;
    try {
      realParent = realpathSync(currentPath);
    } catch {
      refuseGeneratedRuntimeHelperWrite(relativePath, 'parent could not be resolved safely');
    }
    if (realParent !== runtimeContext.realRuntimeRoot
      && !pathIsStrictlyInside(runtimeContext.realRuntimeRoot, realParent)) {
      refuseGeneratedRuntimeHelperWrite(relativePath, 'parent resolves outside bin/');
    }
  }

  let targetStat;
  try {
    targetStat = lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    refuseGeneratedRuntimeHelperWrite(relativePath, 'target could not be inspected safely');
  }

  if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
    refuseGeneratedRuntimeHelperWrite(relativePath, 'target must be a regular file inside bin/');
  }

  let realTarget;
  try {
    realTarget = realpathSync(absolutePath);
  } catch {
    refuseGeneratedRuntimeHelperWrite(relativePath, 'target could not be resolved safely');
  }
  if (!pathIsStrictlyInside(runtimeContext.realRuntimeRoot, realTarget)) {
    refuseGeneratedRuntimeHelperWrite(relativePath, 'target resolves outside bin/');
  }
}

function preflightGeneratedRuntimeHelperTargets(planningDir, entries, runtimeContext) {
  const currentContext = managedRuntimeContext(planningDir);
  if (!sameManagedPlanningRoot(runtimeContext, currentContext)) {
    throw new Error('Refusing to write generated runtime helpers: planning root changed before preflight.');
  }
  const readyContext = ensureManagedRuntimeRoot(planningDir, currentContext);
  if (!sameManagedPlanningRoot(runtimeContext, readyContext)) {
    throw new Error('Refusing to write generated runtime helpers: planning root changed during preflight.');
  }

  const targets = entries.map((entry) => {
    const absolutePath = resolve(planningDir, entry.relativePath);
    const targetContext = managedRuntimeContext(planningDir);
    assertSameManagedRuntimeRoots(readyContext, targetContext);
    assertSafeGeneratedRuntimeHelperTarget(targetContext, absolutePath, entry.relativePath, true);
    return { entry, absolutePath };
  });
  return { runtimeContext: readyContext, targets };
}

function fileIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function warnPreservedRuntimeHelper(relativePath, reason) {
  const displayPath = String(relativePath).replace(/[\r\n]+/g, '?');
  console.log(`  - WARN: obsolete runtime helper ${displayPath} ${reason}; preserving it`);
}

function planObsoleteRuntimeHelperCleanup(planningDir, entries, runtimeContext) {
  const existingHashes = readManifest(planningDir)?.runtimeHelpers;
  if (!existingHashes || typeof existingHashes !== 'object' || Array.isArray(existingHashes)) return [];

  const currentPaths = new Set(entries.map((entry) => entry.relativePath));
  const candidates = [];

  for (const [relativePath, expectedHash] of Object.entries(existingHashes)) {
    if (currentPaths.has(relativePath)) continue;

    const absolutePath = resolve(planningDir, relativePath);
    if (!pathIsStrictlyInside(runtimeContext.runtimeRoot, absolutePath)) {
      warnPreservedRuntimeHelper(relativePath, 'resolves outside the managed runtime root');
      continue;
    }

    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      warnPreservedRuntimeHelper(relativePath, 'could not be inspected safely');
      continue;
    }

    if (stat.isSymbolicLink() || !stat.isFile()) {
      warnPreservedRuntimeHelper(relativePath, 'is not a regular file');
      continue;
    }

    let realTarget;
    try {
      const realRuntimeRoot = runtimeContext.realRuntimeRoot ?? realpathSync(runtimeContext.runtimeRoot);
      realTarget = realpathSync(absolutePath);
      if (!pathIsStrictlyInside(realRuntimeRoot, realTarget)) {
        warnPreservedRuntimeHelper(relativePath, 'resolves outside the managed runtime root');
        continue;
      }
    } catch {
      warnPreservedRuntimeHelper(relativePath, 'could not be resolved safely');
      continue;
    }

    let currentHash;
    try {
      currentHash = fileHash(absolutePath);
    } catch {
      warnPreservedRuntimeHelper(relativePath, 'could not be hashed safely');
      continue;
    }
    if (currentHash !== expectedHash) {
      warnPreservedRuntimeHelper(relativePath, 'was modified locally');
      continue;
    }

    candidates.push({
      relativePath,
      absolutePath,
      expectedHash,
      realTarget,
      identity: fileIdentity(stat),
    });
  }

  return candidates;
}

function applyObsoleteRuntimeHelperCleanup(planningDir, candidates) {
  if (candidates.length === 0) return;

  let runtimeContext;
  try {
    runtimeContext = managedRuntimeContext(planningDir);
  } catch {
    for (const candidate of candidates) {
      warnPreservedRuntimeHelper(candidate.relativePath, 'runtime root changed before removal');
    }
    return;
  }

  for (const candidate of candidates) {
    try {
      const stat = lstatSync(candidate.absolutePath);
      const realTarget = realpathSync(candidate.absolutePath);
      const realRuntimeRoot = runtimeContext.realRuntimeRoot ?? realpathSync(runtimeContext.runtimeRoot);
      const unchanged = !stat.isSymbolicLink()
        && stat.isFile()
        && pathIsStrictlyInside(realRuntimeRoot, realTarget)
        && realTarget === candidate.realTarget
        && sameFileIdentity(fileIdentity(stat), candidate.identity)
        && fileHash(candidate.absolutePath) === candidate.expectedHash;
      if (!unchanged) {
        warnPreservedRuntimeHelper(candidate.relativePath, 'changed before removal');
        continue;
      }
      unlinkSync(candidate.absolutePath);
      console.log(`  - removed obsolete runtime helper ${candidate.relativePath}`);
    } catch {
      warnPreservedRuntimeHelper(candidate.relativePath, 'changed or could not be removed safely');
    }
  }
}

function buildUpdateManifest({ planningDir, frameworkVersion, updateTemplates, runtimeHelperPaths, templateOwnership = null }) {
  const existingManifest = readManifest(planningDir);
  const preservedOwnership = !updateTemplates && existingManifest
    ? { templates: existingManifest.templates, roles: existingManifest.roles }
    : null;
  const nextManifest = buildManifest({
    planningDir,
    frameworkVersion,
    runtimeHelperPaths,
    templateOwnership: templateOwnership ?? preservedOwnership,
  });

  if (existingManifest && !updateTemplates) {
    nextManifest.templates = existingManifest.templates ?? nextManifest.templates;
    nextManifest.roles = existingManifest.roles ?? nextManifest.roles;
  }

  if (existingManifest && manifestsEqualIgnoringTimestamp(existingManifest, nextManifest)) {
    return null;
  }

  return nextManifest;
}

function manifestsEqualIgnoringTimestamp(left, right) {
  return JSON.stringify(stripManifestTimestamp(left)) === JSON.stringify(stripManifestTimestamp(right));
}

function stripManifestTimestamp(manifest) {
  if (!manifest || typeof manifest !== 'object') return manifest;
  const { generatedAt, ...rest } = manifest;
  return rest;
}

async function ensureConfig({ cwd, planningDir, stateDirName = '.work', isAuto, promptApi, preselectedConfig = null }) {
  const configFile = join(planningDir, 'config.json');
  const ignoreEntry = `${stateDirName}/`;
  const ignoreMsg = `  - ensured ${stateDirName}/ is gitignored`;
  if (existsSync(configFile)) {
    console.log(`  - ${stateDirName}/config.json already exists`);
    return;
  }

  if (preselectedConfig) {
    writeFileSync(configFile, JSON.stringify(preselectedConfig, null, 2));
    console.log(`  - saved ${stateDirName}/config.json (guided wizard)\n`);
    if (!preselectedConfig.commitDocs) ensureGitignoreEntry(cwd, ignoreEntry, ignoreMsg);
    return;
  }

  if (isAuto) {
    const config = buildDefaultConfig({ autoAdvance: true });
    writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log(`  - wrote ${stateDirName}/config.json (auto defaults)\n`);
    if (!config.commitDocs) ensureGitignoreEntry(cwd, ignoreEntry, ignoreMsg);
    return;
  }

  if (!process.stdin.isTTY) {
    const config = buildDefaultConfig({ autoAdvance: false });
    writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log(`  - wrote ${stateDirName}/config.json (non-interactive defaults)\n`);
    if (!config.commitDocs) ensureGitignoreEntry(cwd, ignoreEntry, ignoreMsg);
    return;
  }

  const selected = typeof promptApi.promptForConfig === 'function'
    ? await promptApi.promptForConfig(cwd)
    : buildDefaultConfig({ autoAdvance: false });

  if (!selected) {
    throw new Error('Initialization cancelled');
  }

  writeFileSync(configFile, JSON.stringify(selected, null, 2));
  console.log(`  - saved ${stateDirName}/config.json (guided wizard)\n`);
  if (!selected.commitDocs) ensureGitignoreEntry(cwd, ignoreEntry, ignoreMsg);
}

function readSelectedConfig({ planningDir, isAuto, preselectedConfig }) {
  const defaults = buildDefaultConfig({ autoAdvance: isAuto });
  const configFile = join(planningDir, 'config.json');
  if (existsSync(configFile)) {
    try {
      const existing = JSON.parse(readFileSync(configFile, 'utf-8'));
      return {
        ...defaults,
        ...existing,
        workflow: { ...defaults.workflow, ...(existing.workflow ?? {}) },
      };
    } catch {
      throw new Error('Refusing init: existing config.json is invalid. Repair it before retrying.');
    }
  }
  return preselectedConfig ?? defaults;
}

function preflightCommitDocsOwnership(cwd, stateDirName, config) {
  if (!config?.commitDocs) return;
  const gitignorePath = join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) return;
  const ignored = readFileSync(gitignorePath, 'utf-8').split(/\r?\n/);
  if (ignored.includes(`${stateDirName}/`)) {
    throw new Error(`Refusing init: ${stateDirName}/ is already ignored but commitDocs is true. Remove that user-owned ignore entry manually, then retry.`);
  }
}

function ensureGitignoreEntry(cwd, entry, message) {
  const gitignorePath = join(cwd, '.gitignore');
  const hasGitignore = existsSync(gitignorePath);
  const current = hasGitignore ? readFileSync(gitignorePath, 'utf-8') : '';
  if (!current.split(/\r?\n/).includes(entry)) {
    const next = current.trimEnd() ? `${current.trimEnd()}\n${entry}\n` : `${entry}\n`;
    writeFileSync(gitignorePath, next);
    console.log(message);
  }
}

function printInitSummary(config) {
  console.log('Config summary:');
  console.log(`  - rigorProfile: ${config.rigorProfile}`);
  console.log(`  - researchDepth: ${config.researchDepth}`);
  console.log(`  - parallelization: ${config.parallelization}`);
  console.log(`  - commitDocs: ${config.commitDocs}`);
  console.log(`  - modelProfile: ${config.modelProfile}`);
  if (typeof config.autoAdvance === 'boolean') console.log(`  - autoAdvance: ${config.autoAdvance} (new-project bootstrap only)`);
  if (config.workflow) {
    console.log(`  - workflow.research: ${config.workflow.research}`);
    console.log(`  - workflow.discuss: ${config.workflow.discuss}`);
    console.log(`  - workflow.planCheck: ${config.workflow.planCheck}`);
    console.log(`  - workflow.verifier: ${config.workflow.verifier}`);
  }
  console.log('');
}

function printPostInitRouting(selectedRuntimes = []) {
  for (const line of getPostInitRoutingLines(selectedRuntimes)) {
    console.log(line);
  }
  console.log('');
}
