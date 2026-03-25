import * as readline from 'readline';
import { DEFAULT_GIT_PROTOCOL, normalizeModelProfile } from './models.mjs';
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

  const researchDepth = await promptSingleSelect({
    input,
    output,
    title: 'Research depth',
    choices: [
      { value: 'balanced', label: 'balanced', description: 'SOTA research per phase (recommended)' },
      { value: 'fast', label: 'fast', description: 'Skip deeper domain research and plan from current context' },
      { value: 'deep', label: 'deep', description: 'Exhaustive research sweeps and parallel researchers' },
    ],
    defaultIndex: 0,
  });
  const parallelization = await promptSingleSelect({
    input,
    output,
    title: 'Parallelization',
    choices: yesNoChoices('Run independent agents in parallel?', true),
    defaultIndex: 0,
  });
  const commitDocs = await promptSingleSelect({
    input,
    output,
    title: 'Planning docs in git',
    choices: yesNoChoices('Track .planning/ in git?', true),
    defaultIndex: 0,
  });
  const modelProfile = await promptSingleSelect({
    input,
    output,
    title: 'Model profile',
    choices: [
      { value: 'balanced', label: 'balanced', description: 'Capable default for most agents (recommended)' },
      { value: 'quality', label: 'quality', description: 'Most capable model for research and roadmap work' },
      { value: 'budget', label: 'budget', description: 'Cheapest and fastest model profile' },
    ],
    defaultIndex: 0,
  });
  const workflowResearch = await promptSingleSelect({
    input,
    output,
    title: 'Workflow research',
    choices: yesNoChoices('Research before planning each phase?', true),
    defaultIndex: 0,
  });
  const workflowDiscuss = await promptSingleSelect({
    input,
    output,
    title: 'Approach discussion',
    choices: yesNoChoices('Explore approaches with the user before planning?', false),
    defaultIndex: 0,
  });
  const workflowPlanCheck = await promptSingleSelect({
    input,
    output,
    title: 'Plan checking',
    choices: yesNoChoices('Run the fresh-context plan checker before execution?', true),
    defaultIndex: 0,
  });
  const workflowVerifier = await promptSingleSelect({
    input,
    output,
    title: 'Phase verification',
    choices: yesNoChoices('Run phase verification after execution?', true),
    defaultIndex: 0,
  });

  const gitProtocol = await promptGitProtocol(cwd, { input, output });

  return {
    researchDepth,
    parallelization,
    commitDocs,
    modelProfile: normalizeModelProfile(modelProfile),
    workflow: {
      research: workflowResearch,
      discuss: workflowDiscuss,
      planCheck: workflowPlanCheck,
      verifier: workflowVerifier,
    },
    gitProtocol,
    initVersion: INIT_VERSION,
  };
}

export async function promptGitProtocol(cwd, { input = process.stdin, output = process.stdout } = {}) {
  if (typeof input.resume === 'function') input.resume();
  output.write(`\n${ANSI.bold}Version control guidance${ANSI.reset}\n`);
  output.write(`${ANSI.dim}This is advisory only. Repo or user conventions still win.${ANSI.reset}\n`);
  const rl = readline.createInterface({ input, output });
  const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

  try {
    let branch = await askQuestion('  Branching guidance (Enter for default): ');
    branch = branch.trim() || DEFAULT_GIT_PROTOCOL.branch;

    let commit = await askQuestion('  Commit guidance (Enter for default): ');
    commit = commit.trim() || DEFAULT_GIT_PROTOCOL.commit;

    let pr = await askQuestion('  PR guidance (Enter for default): ');
    pr = pr.trim() || DEFAULT_GIT_PROTOCOL.pr;

    return { branch, commit, pr };
  } finally {
    rl.close();
  }
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
