// models.mjs — Model profile management, config CRUD, and validation constants
//
// IMPORTANT: No module-scope process.cwd() — ESM caching means sub-modules
// evaluate once, so CWD must be computed inside function bodies.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CLAUDE_MODEL_PROFILES } from '../adapters/claude.mjs';
import { detectOpenCodeConfiguredModel } from '../adapters/opencode.mjs';
import { parseFlagValue, output } from './cli-utils.mjs';

export const DEFAULT_GIT_PROTOCOL = {
  branch: 'Follow the existing repo or team branching convention. Use a feature branch for significant changes when no convention exists.',
  commit: 'Group changes logically and follow the existing repo conventions. Do not mention phase, plan, or task IDs unless explicitly requested.',
  pr: 'Follow the existing repo or team review workflow. Do not assume PR creation, timing, or naming unless explicitly requested.',
};

export const VALID_MODEL_PROFILES = ['quality', 'balanced', 'budget'];
export const PORTABLE_AGENT_IDS = ['plan-checker'];
export const MODEL_RUNTIME_IDS = ['claude', 'opencode', 'codex'];

export function normalizeModelProfile(value) {
  return VALID_MODEL_PROFILES.includes(value) ? value : 'balanced';
}

export function buildDefaultConfig({ autoAdvance = false } = {}) {
  const config = {
    researchDepth: 'balanced',
    parallelization: true,
    commitDocs: true,
    modelProfile: 'balanced',
    workflow: { research: true, planCheck: true, verifier: true },
    gitProtocol: { ...DEFAULT_GIT_PROTOCOL },
    initVersion: 'v1.1',
  };
  if (autoAdvance) config.autoAdvance = true;
  return config;
}

export function loadProjectModelConfig(cwd = process.cwd()) {
  const configPath = join(cwd, '.planning', 'config.json');
  if (!existsSync(configPath)) return buildDefaultConfig();

  try {
    return {
      ...buildDefaultConfig(),
      ...JSON.parse(readFileSync(configPath, 'utf-8')),
    };
  } catch {
    return buildDefaultConfig();
  }
}

export function ensureProjectConfig(cwd = process.cwd()) {
  mkdirSync(join(cwd, '.planning'), { recursive: true });
  const config = loadProjectModelConfig(cwd);
  writeProjectConfig(config, cwd);
  return config;
}

export function writeProjectConfig(config, cwd = process.cwd()) {
  const configPath = join(cwd, '.planning', 'config.json');
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
  const subcommand = modelArgs[0] || 'show';

  switch (subcommand) {
    case 'show':
      return cmdModelsShow();
    case 'profile':
      return cmdModelsProfile(modelArgs[1]);
    case 'agent-profile':
      return cmdModelsAgentProfile(modelArgs.slice(1));
    case 'clear-agent-profile':
      return cmdModelsClearAgentProfile(modelArgs.slice(1));
    case 'set':
      return cmdModelsSetRuntimeOverride(modelArgs.slice(1));
    case 'clear':
      return cmdModelsClearRuntimeOverride(modelArgs.slice(1));
    default:
      console.error('Usage: gsdd models [show|profile|agent-profile|clear-agent-profile|set|clear]');
      process.exitCode = 1;
  }
}

function cmdModelsShow() {
  const cwd = process.cwd();
  const config = loadProjectModelConfig(cwd);
  const ocOverride = getRuntimeModelOverride(config, 'opencode', 'plan-checker');
  const ocDetected = detectOpenCodeConfiguredModel(cwd);
  const codexOverride = getRuntimeModelOverride(config, 'codex', 'plan-checker');
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
      },
      opencode: {
        'plan-checker': {
          mode: ocOverride ? 'override' : 'inherit',
          model: ocOverride,
          runtimeDetectedModel: ocDetected,
        },
      },
      codex: {
        'plan-checker': {
          mode: codexOverride ? 'override' : 'inherit',
          model: codexOverride,
        },
      },
    },
    detectedRuntimeModels: {
      opencode: ocDetected,
    },
    hints: !ocOverride ? {
      opencode: 'OpenCode currently inherits its runtime model unless you set an explicit override. Use gsdd models set --runtime opencode --agent plan-checker --model <provider/model-id> to inject an explicit checker model.',
    } : undefined,
  });
}

function cmdModelsProfile(profile) {
  if (!VALID_MODEL_PROFILES.includes(profile)) {
    console.error(`ERROR: Invalid profile "${profile}". Valid profiles: ${VALID_MODEL_PROFILES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const config = ensureProjectConfig();
  config.modelProfile = profile;
  writeProjectConfig(config);
  console.log(`  - set modelProfile to ${profile}`);
  console.log('  Run gsdd update to regenerate adapter files.');
}

function cmdModelsAgentProfile(args) {
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

  const config = ensureProjectConfig();
  config.agentModelProfiles = config.agentModelProfiles || {};
  config.agentModelProfiles[agent] = profile;
  writeProjectConfig(config);
  console.log(`  - set ${agent} semantic profile to ${profile}`);
  console.log('  Run gsdd update to regenerate adapter files.');
}

function cmdModelsClearAgentProfile(args) {
  const agent = parseFlagValue(args, '--agent').value;
  if (!PORTABLE_AGENT_IDS.includes(agent)) {
    console.error(`ERROR: Invalid agent "${agent}". Valid agents: ${PORTABLE_AGENT_IDS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const config = ensureProjectConfig();
  if (config.agentModelProfiles) {
    delete config.agentModelProfiles[agent];
    if (Object.keys(config.agentModelProfiles).length === 0) {
      delete config.agentModelProfiles;
    }
  }
  writeProjectConfig(config);
  console.log(`  - cleared semantic profile override for ${agent}`);
  console.log('  Run gsdd update to regenerate adapter files.');
}

function cmdModelsSetRuntimeOverride(args) {
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

  const config = ensureProjectConfig();
  config.runtimeModelOverrides = config.runtimeModelOverrides || {};
  config.runtimeModelOverrides[runtime] = config.runtimeModelOverrides[runtime] || {};
  config.runtimeModelOverrides[runtime][agent] = model.trim();
  writeProjectConfig(config);
  console.log(`  - set ${runtime} runtime override for ${agent}`);
  console.log('  Run gsdd update to regenerate adapter files.');
}

function cmdModelsClearRuntimeOverride(args) {
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

  const config = ensureProjectConfig();
  if (config.runtimeModelOverrides?.[runtime]) {
    delete config.runtimeModelOverrides[runtime][agent];
    if (Object.keys(config.runtimeModelOverrides[runtime]).length === 0) {
      delete config.runtimeModelOverrides[runtime];
    }
    if (Object.keys(config.runtimeModelOverrides).length === 0) {
      delete config.runtimeModelOverrides;
    }
  }
  writeProjectConfig(config);
  console.log(`  - cleared ${runtime} runtime override for ${agent}`);
  console.log('  Run gsdd update to regenerate adapter files.');
}
