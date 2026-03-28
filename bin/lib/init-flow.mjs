import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'fs';
import { join, isAbsolute } from 'path';
import { renderSkillContent } from './rendering.mjs';
import { buildManifest, writeManifest } from './manifest.mjs';
import { parseFlagValue, parseToolsFlag, parseAutoFlag } from './cli-utils.mjs';
import { buildDefaultConfig } from './models.mjs';
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
    console.log('gsdd init - setting up SDD workflow\n');

    const isAuto = parseAutoFlag(initArgs);
    const toolsFlag = parseFlagValue(initArgs, '--tools');
    const briefFlag = parseFlagValue(initArgs, '--brief');
    let briefSource = null;

    if (toolsFlag.invalid) {
      console.error('ERROR: --tools requires a value. Example: gsdd init --tools claude');
      process.exitCode = 1;
      return;
    }

    if (briefFlag.invalid) {
      console.error('ERROR: --brief requires a file path. Example: gsdd init --brief project-idea.md');
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
      console.error('ERROR: --auto requires --tools <platform>. Example: gsdd init --auto --tools claude');
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

    for (const adapter of resolveAdapters(ctx.adapters, interactiveSession.adapterTargets)) {
      adapter.generate();
      validateKindContract(adapter, ctx.cwd);
      console.log(`  - ${adapter.summary('generated')}`);
    }

    const manifest = buildManifest({ planningDir: ctx.planningDir, frameworkVersion: ctx.frameworkVersion });
    writeManifest(ctx.planningDir, manifest);
    console.log('  - wrote generation manifest');

    console.log('\nSDD initialized.');
    console.log('Next: run the new-project workflow to produce SPEC.md and ROADMAP.md:\n');
    printPostInitRouting(interactiveSession.selectedRuntimes);
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

    if (platforms.length > 0 || existsSync(join(ctx.cwd, '.agents', 'skills'))) {
      if (isDry) {
        console.log('  - would update open-standard skills (.agents/skills/gsdd-*)');
      } else {
        generateOpenStandardSkills(ctx.cwd, ctx.workflows);
        console.log('  - updated open-standard skills (.agents/skills/gsdd-*)');
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
      console.log('  - no adapters found to update (run `gsdd init` first)');
    } else if (isDry) {
      console.log('\nDry run complete. No files were written.\n');
    } else {
      if (doTemplates && existsSync(ctx.planningDir)) {
        const manifest = buildManifest({ planningDir: ctx.planningDir, frameworkVersion: ctx.frameworkVersion });
        writeManifest(ctx.planningDir, manifest);
        console.log('  - updated generation manifest');
      }
      console.log('\nAdapters updated.\n');
    }
  };
}

function generateOpenStandardSkills(cwd, workflows) {
  for (const workflow of workflows) {
    const dir = join(cwd, '.agents', 'skills', workflow.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), renderSkillContent(workflow));
  }
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
    console.log('  - auto mode: writing config.json with defaults');
    writeFileSync(configFile, JSON.stringify(buildDefaultConfig({ autoAdvance: true }), null, 2));
    console.log('  - saved .planning/config.json (auto mode - autoAdvance enabled)\n');
    return;
  }

  if (!process.stdin.isTTY) {
    console.log('  - non-interactive mode detected: writing config.json with defaults');
    writeFileSync(configFile, JSON.stringify(buildDefaultConfig(), null, 2));
    console.log('  - saved .planning/config.json (defaults - re-run gsdd init in a terminal to customize)\n');
    return;
  }

  const config = await promptApi.promptForConfig(cwd);
  writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.log('  - saved .planning/config.json (guided wizard)\n');

  if (!config.commitDocs) ensureGitignoreEntry(cwd);
}

function ensureGitignoreEntry(cwd) {
  const gitignorePath = join(cwd, '.gitignore');
  const ignoreEntry = '\n# GSDD planning docs (local only)\n.planning/\n';

  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, 'utf-8');
    if (!existing.includes('.planning/')) {
      writeFileSync(gitignorePath, existing + ignoreEntry);
      console.log('  - added .planning/ to .gitignore');
    }
    return;
  }

  writeFileSync(gitignorePath, ignoreEntry.trimStart());
  console.log('  - created .gitignore with .planning/ entry');
}

function printPostInitRouting(selectedRuntimes) {
  for (const line of getPostInitRoutingLines(selectedRuntimes)) {
    console.log(line);
  }
  console.log('');
}
