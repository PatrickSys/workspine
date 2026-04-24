import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync } from 'fs';
import { dirname, join, isAbsolute } from 'path';
import { buildPlanningCliHelperEntries, renderSkillContent } from './rendering.mjs';
import { buildManifest, readManifest, writeManifest } from './manifest.mjs';
import { parseFlagValue, parseToolsFlag, parseAutoFlag } from './cli-utils.mjs';
import { buildDefaultConfig, COST_PROFILES, RIGOR_PROFILES } from './models.mjs';
import { installProjectTemplates, refreshTemplates } from './templates.mjs';
import {
  detectPlatforms,
  getAdaptersToUpdate,
  getPostInitRoutingLines,
  normalizeRequestedTools,
  resolveAdapters,
  resolveInteractiveInitSession,
} from './init-runtime.mjs';
import { createInitPromptApi } from './init-prompts.mjs';

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
    console.log('gsdd init - setting up GSDD workflow\n');

    const isAuto = parseAutoFlag(initArgs);
    const toolsFlag = parseFlagValue(initArgs, '--tools');
    const briefFlag = parseFlagValue(initArgs, '--brief');
    let briefSource = null;

    if (toolsFlag.invalid) {
      console.error('ERROR: --tools requires a value. Example: npx -y gsdd-cli init --tools claude');
      process.exitCode = 1;
      return;
    }

    if (briefFlag.invalid) {
      console.error('ERROR: --brief requires a file path. Example: npx -y gsdd-cli init --brief project-idea.md');
      process.exitCode = 1;
      return;
    }

    if (briefFlag.value) {
      briefSource = isAbsolute(briefFlag.value) ? briefFlag.value : join(ctx.cwd, briefFlag.value);
      if (!existsSync(briefSource)) {
        console.error(`ERROR: Brief file not found: ${briefFlag.value}`);
        process.exitCode = 1;
        return;
      }
    }

    const parsedTools = parseToolsFlag(initArgs);
    if (isAuto && parsedTools.length === 0) {
      console.error('ERROR: --auto requires --tools <platform>. Example: npx -y gsdd-cli init --auto --tools claude');
      process.exitCode = 1;
      return;
    }

    const promptApi = ctx.initPromptApi || createInitPromptApi();
    const interactiveSession = await resolveInteractiveInitSession({
      ctx,
      promptApi,
      parsedTools,
      isAuto,
    });

    const existed = existsSync(ctx.planningDir);
    mkdirSync(join(ctx.planningDir, 'phases'), { recursive: true });
    mkdirSync(join(ctx.planningDir, 'research'), { recursive: true });
    console.log(existed
      ? '  - .planning/ already exists (ensured subdirectories)'
      : '  - created .planning/ directory structure');

    installProjectTemplates(ctx);
    await ensureConfig({
      cwd: ctx.cwd,
      planningDir: ctx.planningDir,
      isAuto,
      promptApi,
      preselectedConfig: interactiveSession.config,
    });

    if (briefSource) {
      cpSync(briefSource, join(ctx.planningDir, 'PROJECT_BRIEF.md'));
      console.log('  - copied project brief to .planning/PROJECT_BRIEF.md');
    }

    generateOpenStandardSkills(ctx.cwd, ctx.workflows);
    console.log('  - generated open-standard skills (.agents/skills/gsdd-*)');

    generatePlanningCliHelpers(ctx);
    console.log('  - generated local workflow helpers (.planning/bin/gsdd*)');

    for (const adapter of resolveAdapters(ctx.adapters, interactiveSession.adapterTargets)) {
      adapter.generate();
      validateKindContract(adapter, ctx.cwd);
      console.log(`  - ${adapter.summary('generated')}`);
    }

    const manifest = buildManifest({ planningDir: ctx.planningDir, frameworkVersion: ctx.frameworkVersion });
    writeManifest(ctx.planningDir, manifest);
    console.log('  - wrote generation manifest');

    console.log('\n\x1B[1m\x1B[32m✓ GSDD initialized.\x1B[0m');
    printInitSummary(interactiveSession.config ?? buildDefaultConfig({ autoAdvance: isAuto }));
    console.log('Next: choose the starting lane that fits your repo and current scope:\n');
    printPostInitRouting(interactiveSession.selectedRuntimes);
    console.log('\nSetup complete — this session will now exit.');
  };
}

export function createCmdUpdate(ctx) {
  return function cmdUpdate(...updateArgs) {
    const isDry = updateArgs.includes('--dry');
    const doTemplates = updateArgs.includes('--templates');

    console.log(`gsdd update - regenerating adapter files${isDry ? ' (dry run)' : ''}\n`);

    const parsedTools = parseToolsFlag(updateArgs);
    const requested = normalizeRequestedTools(parsedTools);
    const platforms = parsedTools.length > 0 ? requested.adapterTargets : detectPlatforms(ctx.adapters);

    let updated = false;

    if (doTemplates) {
      refreshTemplates({ ...ctx, isDry });
      updated = true;
    }

    if (platforms.length > 0 || existsSync(ctx.planningDir) || hasGeneratedOpenStandardSkills(ctx.cwd)) {
      if (isDry) {
        console.log('  - would update open-standard skills (.agents/skills/gsdd-*)');
      } else {
        generateOpenStandardSkills(ctx.cwd, ctx.workflows);
        console.log('  - updated open-standard skills (.agents/skills/gsdd-*)');
      }
      updated = true;
    }

    if (existsSync(ctx.planningDir)) {
      if (isDry) {
        console.log('  - would update local workflow helpers (.planning/bin/gsdd*)');
      } else {
        generatePlanningCliHelpers(ctx);
        console.log('  - updated local workflow helpers (.planning/bin/gsdd*)');
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
      console.log('  - no adapters found to update (run `npx -y gsdd-cli init` first; bare `gsdd init` is equivalent only when globally installed)');
    } else if (isDry) {
      console.log('\nDry run complete. No files were written.\n');
    } else {
      if (existsSync(ctx.planningDir)) {
        const manifest = buildUpdateManifest({
          planningDir: ctx.planningDir,
          frameworkVersion: ctx.frameworkVersion,
          updateTemplates: doTemplates,
        });
        if (manifest) {
          writeManifest(ctx.planningDir, manifest);
          console.log('  - updated generation manifest');
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

function generateOpenStandardSkills(cwd, workflows) {
  for (const workflow of workflows) {
    const dir = join(cwd, '.agents', 'skills', workflow.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), renderSkillContent(workflow));
  }
}

function generatePlanningCliHelpers(ctx) {
  for (const entry of buildPlanningCliHelperEntries({
    packageName: ctx.packageName,
    packageVersion: ctx.packageVersion,
  })) {
    const absolutePath = join(ctx.planningDir, entry.relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, entry.content);
    if (!absolutePath.endsWith('.cmd')) {
      chmodSync(absolutePath, 0o755);
    }
  }
}

function buildUpdateManifest({ planningDir, frameworkVersion, updateTemplates }) {
  const existingManifest = readManifest(planningDir);
  const nextManifest = buildManifest({ planningDir, frameworkVersion });

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

async function ensureConfig({ cwd, planningDir, isAuto, promptApi, preselectedConfig = null }) {
  const configFile = join(planningDir, 'config.json');
  if (existsSync(configFile)) {
    console.log('  - .planning/config.json already exists');
    return;
  }

  if (preselectedConfig) {
    writeFileSync(configFile, JSON.stringify(preselectedConfig, null, 2));
    console.log('  - saved .planning/config.json (guided wizard)\n');
    if (!preselectedConfig.commitDocs) ensureGitignoreEntry(cwd);
    return;
  }

  if (isAuto) {
    const config = buildDefaultConfig({ autoAdvance: true });
    writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log('  - wrote .planning/config.json (auto defaults)\n');
    if (!config.commitDocs) ensureGitignoreEntry(cwd);
    return;
  }

  if (!process.stdin.isTTY) {
    const config = buildDefaultConfig({ autoAdvance: false });
    writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log('  - wrote .planning/config.json (non-interactive defaults)\n');
    if (!config.commitDocs) ensureGitignoreEntry(cwd);
    return;
  }

  const selected = typeof promptApi.promptForConfig === 'function'
    ? await promptApi.promptForConfig(cwd)
    : buildDefaultConfig({ autoAdvance: false });

  if (!selected) {
    throw new Error('Initialization cancelled');
  }

  writeFileSync(configFile, JSON.stringify(selected, null, 2));
  console.log('  - saved .planning/config.json (guided wizard)\n');
  if (!selected.commitDocs) ensureGitignoreEntry(cwd);
}

function ensureGitignoreEntry(cwd) {
  const gitignorePath = join(cwd, '.gitignore');
  const entry = '.planning/';
  const hasGitignore = existsSync(gitignorePath);
  const current = hasGitignore ? readFileSync(gitignorePath, 'utf-8') : '';
  if (!current.split(/\r?\n/).includes(entry)) {
    const next = current.trimEnd() ? `${current.trimEnd()}\n${entry}\n` : `${entry}\n`;
    writeFileSync(gitignorePath, next);
    console.log('  - ensured .planning/ is gitignored');
  }
}

function printInitSummary(config) {
  console.log('Config summary:');
  console.log(`  - researchDepth: ${config.researchDepth}`);
  console.log(`  - parallelization: ${config.parallelization}`);
  console.log(`  - commitDocs: ${config.commitDocs}`);
  console.log(`  - modelProfile: ${config.modelProfile}`);
  if (typeof config.autoAdvance === 'boolean') console.log(`  - autoAdvance: ${config.autoAdvance}`);
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
