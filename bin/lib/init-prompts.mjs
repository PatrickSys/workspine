import * as readline from 'readline';
import { COST_PROFILES, DEFAULT_GIT_PROTOCOL, RIGOR_PROFILES, resolveCost, resolveRigor } from './models.mjs';
import { buildRuntimeChoices, INIT_VERSION, resolveWizardAdapterTargets } from './init-runtime.mjs';

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
};

export function createInitPromptApi({ input = process.stdin, output = process.stdout } = {}) {
  return {
    async runInitWizard({ cwd, adapters }) {
      output.write(`${ANSI.bold}${ANSI.cyan}GSDD Install Wizard${ANSI.reset}\n`);
      output.write(`${ANSI.dim}Portable skills are always installed. Select the runtimes you want GSDD to feel native in.${ANSI.reset}\n\n`);

      const runtimeChoices = buildRuntimeChoices(adapters);
      const selectedRuntimes = await promptMultiSelect({
        input,
        output,
        title: 'Step 1 of 3 - Select runtimes',
        hint: 'Space toggles, Enter confirms.',
        choices: runtimeChoices,
      });
      const installGovernance = await promptConfirm({
        input,
        output,
        title: 'Step 2 of 3 - Repo-wide AGENTS.md governance',
        prompt: 'Install repo-wide AGENTS.md rules?',
        defaultValue: false,
        details: [
          'Why care: consistent behavioral discipline across sessions and mixed-runtime teams.',
          'Why skip it: it writes to the repo root, and your selected runtimes already discover .agents/skills/ natively.',
        ],
      });
      const config = await promptForConfig(cwd, { input, output });
      return {
        selectedRuntimes,
        adapterTargets: resolveWizardAdapterTargets(selectedRuntimes, installGovernance),
        config,
      };
    },
    promptForConfig(cwd) {
      return promptForConfig(cwd, { input, output });
    },
  };
}

export async function promptForConfig(cwd, { input = process.stdin, output = process.stdout } = {}) {
  output.write(`\n${ANSI.bold}Step 3 of 3 - Configure planning defaults${ANSI.reset}\n`);

  const rigor = await promptSingleSelect({
    input,
    output,
    title: 'Rigor',
    choices: [
      { value: 'quick', label: 'quick', description: 'Faster setup with lighter planning rigor' },
      { value: 'balanced', label: 'balanced', description: 'Recommended default for most projects' },
      { value: 'thorough', label: 'thorough', description: 'Maximum research and plan review rigor' },
    ],
    defaultIndex: 1,
  });
  const cost = await promptSingleSelect({
    input,
    output,
    title: 'Cost',
    choices: [
      { value: 'budget', label: 'budget', description: 'Lower-cost model profile and no parallelization' },
      { value: 'balanced', label: 'balanced', description: 'Recommended cost/quality tradeoff' },
      { value: 'quality', label: 'quality', description: 'Maximum quality with parallel work enabled' },
    ],
    defaultIndex: 1,
  });
  const commitDocs = await promptSingleSelect({
    input,
    output,
    title: 'Planning docs in git',
    choices: [
      { value: true, label: 'yes', description: 'Track .planning/ in git.' },
      { value: false, label: 'no', description: 'Keep .planning/ local only.' },
    ],
    defaultIndex: 0,
  });

  const rigorConfig = resolveRigor(rigor);
  const costConfig = resolveCost(cost);

  return {
    ...rigorConfig,
    ...costConfig,
    commitDocs,
    gitProtocol: { ...DEFAULT_GIT_PROTOCOL },
    initVersion: INIT_VERSION,
  };
}

export function yesNoChoices(prompt, defaultYes) {
  return [
    { value: true, label: 'yes', description: `${prompt} Yes.` },
    { value: false, label: 'no', description: `${prompt} No.` },
  ].sort((a, b) => {
    if (defaultYes) return a.value === true ? -1 : 1;
    return a.value === false ? -1 : 1;
  });
}

export async function promptConfirm({ input, output, title, prompt, defaultValue, details = [] }) {
  if (typeof input.resume === 'function') input.resume();
  output.write(`\n${ANSI.bold}${title}${ANSI.reset}\n`);
  for (const detail of details) {
    output.write(`  ${ANSI.dim}${detail}${ANSI.reset}\n`);
  }
  const rl = readline.createInterface({ input, output });
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';
  try {
    const answer = await new Promise((resolve) => rl.question(`  ${prompt} ${suffix}: `, resolve));
    const normalized = answer.trim().toLowerCase();
    if (!normalized) return defaultValue;
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

export async function promptSingleSelect({ input, output, title, choices, defaultIndex = 0 }) {
  const selected = await promptChoiceList({
    input,
    output,
    title,
    choices: choices.map((choice, index) => ({
      ...choice,
      selected: index === defaultIndex,
      detected: false,
    })),
    multi: false,
  });
  return selected[0];
}

export async function promptMultiSelect({ input, output, title, hint, choices }) {
  return promptChoiceList({ input, output, title, hint, choices, multi: true });
}

export async function promptChoiceList({ input, output, title, hint = 'Use arrows to move. Enter confirms.', choices, multi }) {
  if (typeof input.resume === 'function') input.resume();
  readline.emitKeypressEvents(input);
  const previousRawMode = typeof input.isRaw === 'boolean' ? input.isRaw : false;
  if (typeof input.setRawMode === 'function') input.setRawMode(true);

  let cursor = Math.max(0, choices.findIndex((choice) => choice.selected));
  let renderedLines = 0;

  const selectCursor = () => {
    if (multi) return;
    for (const choice of choices) choice.selected = false;
    choices[cursor].selected = true;
  };

  const measureLines = (text) => {
    const columns = Math.max(20, Number(output.columns) || 80);
    const visible = stripAnsi(text);
    return visible.split('\n').reduce((total, line) => {
      const width = Math.max(1, line.length);
      return total + Math.ceil(width / columns);
    }, 0);
  };

  const render = () => {
    if (renderedLines > 0) {
      readline.moveCursor(output, 0, -renderedLines);
    }
    readline.cursorTo(output, 0);
    readline.clearScreenDown(output);
    const lines = [`${ANSI.bold}${title}${ANSI.reset}`];
    if (hint) lines.push(`${ANSI.dim}${hint}${ANSI.reset}`);
    lines.push('');
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const pointer = i === cursor ? `${ANSI.green}>${ANSI.reset}` : ' ';
      const mark = choice.selected ? `${ANSI.green}[x]${ANSI.reset}` : '[ ]';
      const detected = choice.detected ? ` ${ANSI.dim}(detected)${ANSI.reset}` : '';
      lines.push(`${pointer} ${mark} ${choice.label}${detected}`);
      lines.push(`    ${ANSI.dim}${choice.description}${ANSI.reset}`);
    }

    renderedLines = 0;
    for (const line of lines) {
      output.write(`${line}\n`);
      renderedLines += measureLines(line);
    }
  };

  render();

  const values = await new Promise((resolve, reject) => {
    const cleanup = () => {
      input.off('keypress', onKeypress);
      if (typeof input.setRawMode === 'function') input.setRawMode(previousRawMode);
    };

    const onKeypress = (_, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Prompt cancelled by user'));
        return;
      }
      if (key.name === 'up') {
        cursor = cursor === 0 ? choices.length - 1 : cursor - 1;
        selectCursor();
        render();
        return;
      }
      if (key.name === 'down') {
        cursor = cursor === choices.length - 1 ? 0 : cursor + 1;
        selectCursor();
        render();
        return;
      }
      if (key.name === 'space') {
        if (multi) {
          choices[cursor].selected = !choices[cursor].selected;
        } else {
          for (const choice of choices) choice.selected = false;
          choices[cursor].selected = true;
        }
        render();
        return;
      }
      if (key.name === 'return') {
        selectCursor();
        cleanup();
        resolve(choices.filter((choice) => choice.selected).map((choice) => choice.value ?? choice.id));
      }
    };

    input.on('keypress', onKeypress);
  });

  output.write('\n');
  return values;
}

export function stripAnsi(text) {
  return String(text).replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}
