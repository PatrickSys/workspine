// cli-utils.mjs — Pure CLI utility functions (no external deps)

export function parseFlagValue(flagArgs, flagName) {
  const idx = flagArgs.indexOf(flagName);
  if (idx === -1) return { present: false, value: null, invalid: false };

  const value = flagArgs[idx + 1];
  if (!value || value.startsWith('--')) {
    return { present: true, value: null, invalid: true };
  }

  return { present: true, value, invalid: false };
}

export function parseToolsFlag(flagArgs) {
  const { value } = parseFlagValue(flagArgs, '--tools');
  if (!value) return [];
  if (value === 'all') return ['claude', 'opencode', 'codex', 'agents'];
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

export function parseAutoFlag(flagArgs) {
  return flagArgs.includes('--auto');
}

export function output(data) {
  console.log(JSON.stringify(data, null, 2));
}
