/**
 * GSDD Code-Structure Guards
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GSDD_PATH = path.join(ROOT, 'bin', 'gsdd.mjs');
const MODELS_MODULE = path.join(ROOT, 'bin', 'lib', 'models.mjs');
const MANIFEST_MODULE = path.join(ROOT, 'bin', 'lib', 'manifest.mjs');
const HEALTH_MODULE = path.join(ROOT, 'bin', 'lib', 'health.mjs');
const HEALTH_TRUTH_MODULE = path.join(ROOT, 'bin', 'lib', 'health-truth.mjs');
const INIT_MODULE = path.join(ROOT, 'bin', 'lib', 'init.mjs');
const INIT_RUNTIME_MODULE = path.join(ROOT, 'bin', 'lib', 'init-runtime.mjs');
const LIFECYCLE_STATE_MODULE = path.join(ROOT, 'bin', 'lib', 'lifecycle-state.mjs');
const LIFECYCLE_PREFLIGHT_MODULE = path.join(ROOT, 'bin', 'lib', 'lifecycle-preflight.mjs');
const TEMPLATES_MODULE = path.join(ROOT, 'bin', 'lib', 'templates.mjs');
const README_MD = path.join(ROOT, 'README.md');
const DISTILLED_README_MD = path.join(ROOT, 'distilled', 'README.md');
const DESIGN_MD = path.join(ROOT, 'distilled', 'DESIGN.md');
const PLANNING_SPEC_MD = path.join(ROOT, '.planning', 'SPEC.md');
const PLANNING_ROADMAP_MD = path.join(ROOT, '.planning', 'ROADMAP.md');
const INTERNAL_TODO_MD = path.join(ROOT, '.internal-research', 'TODO.md');

function lineCount(filePath) {
  return fs.readFileSync(filePath, 'utf-8').split('\n').length;
}

function isGitTracked(relativePath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function introBeforeWhatThisIs(markdown) {
  const marker = '\n## What This Is';
  const idx = markdown.indexOf(marker);
  return idx === -1 ? markdown : markdown.slice(0, idx);
}

describe('G9 - Generation Manifest Contract', () => {
  test('bin/lib/manifest.mjs exists', () => {
    assert.ok(fs.existsSync(MANIFEST_MODULE),
      'bin/lib/manifest.mjs must exist. FIX: Create the manifest module.');
  });

  test('manifest module exports required functions', async () => {
    const mod = await import(`file://${MANIFEST_MODULE.replace(/\\/g, '/')}`);
    const required = ['fileHash', 'hashDirectory', 'buildManifest', 'readManifest', 'writeManifest', 'detectModifications'];
    for (const fn of required) {
      assert.strictEqual(typeof mod[fn], 'function',
        `manifest.mjs must export ${fn}. FIX: Add export for ${fn}.`);
    }
  });
});

describe('G10 - CLI Module Boundary', () => {
  test('init module exists and exports command factories', async () => {
    assert.ok(fs.existsSync(INIT_MODULE),
      'bin/lib/init.mjs must exist. FIX: Extract init/update/help logic into bin/lib/init.mjs.');
    const mod = await import(`file://${INIT_MODULE.replace(/\\/g, '/')}`);
    assert.strictEqual(typeof mod.createCmdInit, 'function',
      'init.mjs must export createCmdInit. FIX: Export createCmdInit from bin/lib/init.mjs.');
    assert.strictEqual(typeof mod.createCmdUpdate, 'function',
      'init.mjs must export createCmdUpdate. FIX: Export createCmdUpdate from bin/lib/init.mjs.');
    assert.strictEqual(typeof mod.cmdHelp, 'function',
      'init.mjs must export cmdHelp. FIX: Export cmdHelp from bin/lib/init.mjs.');
  });

  test('templates module exists and exports sync helpers', async () => {
    assert.ok(fs.existsSync(TEMPLATES_MODULE),
      'bin/lib/templates.mjs must exist. FIX: Extract template sync logic into bin/lib/templates.mjs.');
    const mod = await import(`file://${TEMPLATES_MODULE.replace(/\\/g, '/')}`);
    assert.strictEqual(typeof mod.installProjectTemplates, 'function',
      'templates.mjs must export installProjectTemplates. FIX: Export installProjectTemplates from bin/lib/templates.mjs.');
    assert.strictEqual(typeof mod.refreshTemplates, 'function',
      'templates.mjs must export refreshTemplates. FIX: Export refreshTemplates from bin/lib/templates.mjs.');
  });

  test('gsdd.mjs imports the extracted modules', () => {
    const gsddContent = fs.readFileSync(GSDD_PATH, 'utf-8');
    assert.ok(gsddContent.includes("from './lib/init.mjs'"),
      'gsdd.mjs must import init.mjs. FIX: Add init.mjs import to gsdd.mjs.');
    assert.ok(gsddContent.includes('createCmdInit') && gsddContent.includes('createCmdUpdate'),
      'gsdd.mjs must wire createCmdInit/createCmdUpdate. FIX: Use the extracted init command factories.');
  });

  test('gsdd.mjs keeps FRAMEWORK_VERSION and re-exports command surface', () => {
    const gsddContent = fs.readFileSync(GSDD_PATH, 'utf-8');
    assert.ok(gsddContent.includes('FRAMEWORK_VERSION'),
      'gsdd.mjs must define FRAMEWORK_VERSION. FIX: Keep FRAMEWORK_VERSION in the composition root.');
    assert.ok(gsddContent.includes('export') && gsddContent.includes('cmdInit') && gsddContent.includes('cmdUpdate'),
      'gsdd.mjs must export the CLI command surface. FIX: Re-export cmdInit/cmdUpdate from gsdd.mjs.');
  });

  test('help text still documents --templates and --dry', async () => {
    const mod = await import(`file://${INIT_MODULE.replace(/\\/g, '/')}`);
    const previousLog = console.log;
    let output = '';
    console.log = (...parts) => { output += `${parts.join(' ')}\n`; };
    try {
      mod.cmdHelp();
    } finally {
      console.log = previousLog;
    }

    assert.match(output, /--templates/,
      'Help text must document --templates flag. FIX: Add --templates to the extracted cmdHelp output.');
    assert.match(output, /--dry/,
      'Help text must document --dry flag. FIX: Add --dry to the extracted cmdHelp output.');
  });

  test('gsdd.mjs no longer defines extracted command bodies inline', () => {
    const gsddContent = fs.readFileSync(GSDD_PATH, 'utf-8');
    for (const forbidden of [
      'async function cmdInit',
      'function cmdUpdate',
      'function refreshTemplates',
      'function generateOpenStandardSkills',
      'function detectPlatforms',
      'function getAdaptersToUpdate',
    ]) {
      assert.ok(!gsddContent.includes(forbidden),
        `gsdd.mjs must not define ${forbidden} inline. FIX: Keep extracted command logic in bin/lib modules.`);
    }
  });

  test('gsdd.mjs remains a thin facade', () => {
    const lines = lineCount(GSDD_PATH);
    assert.ok(lines <= 140,
      `gsdd.mjs is ${lines} lines (max 140). FIX: Keep the entrypoint as a thin composition root.`);
  });
});

describe('G11 - Codex Doc Contract', () => {
  test('README describes Codex as portable-skill entry plus native checker agent', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.doesNotMatch(readme, /overrides gsdd-plan skill/i,
      'README.md must not claim that Codex overrides the shared gsdd-plan skill.');
    assert.match(readme, /portable .*gsdd-plan.*\.codex\/agents/i,
      'README.md must describe Codex as the portable gsdd-plan entry plus the native checker agent.');
  });

  test('distilled README no longer describes Codex as deprecated', () => {
    const readme = fs.readFileSync(DISTILLED_README_MD, 'utf-8');
    assert.doesNotMatch(readme, /deprecated compatibility only/i,
      'distilled/README.md must not describe --tools codex as deprecated once the native checker adapter exists.');
    assert.match(readme, /\.codex\/agents\/gsdd-plan-checker\.toml/,
      'distilled/README.md must document the generated Codex checker agent.');
  });
});

describe('G13 - Models Pre-Init Safety', () => {
  test('models.mjs exports isProjectInitialized', async () => {
    const mod = await import(`file://${MODELS_MODULE.replace(/\\/g, '/')}`);
    assert.strictEqual(typeof mod.isProjectInitialized, 'function',
      'models.mjs must export isProjectInitialized. FIX: Add isProjectInitialized export.');
  });

  test('all 5 mutation commands check isProjectInitialized', () => {
    const modelsSource = fs.readFileSync(MODELS_MODULE, 'utf-8');
    const mutationFunctions = [
      'cmdModelsProfile',
      'cmdModelsAgentProfile',
      'cmdModelsClearAgentProfile',
      'cmdModelsSetRuntimeOverride',
      'cmdModelsClearRuntimeOverride',
    ];
    for (const fn of mutationFunctions) {
      const fnStart = modelsSource.indexOf(`function ${fn}`);
      assert.notStrictEqual(fnStart, -1, `${fn} must exist in models.mjs`);
      const nextFnStart = modelsSource.indexOf('\nfunction ', fnStart + 1);
      const fnBody = modelsSource.slice(fnStart, nextFnStart > -1 ? nextFnStart : modelsSource.length);
      assert.match(fnBody, /isProjectInitialized/,
        `${fn} must call isProjectInitialized. FIX: Add pre-init guard to ${fn}.`);
    }
  });

  test('mutation commands use loadConfigForMutation instead of ensureProjectConfig', () => {
    const modelsSource = fs.readFileSync(MODELS_MODULE, 'utf-8');
    const mutationFunctions = [
      'cmdModelsProfile',
      'cmdModelsAgentProfile',
      'cmdModelsClearAgentProfile',
      'cmdModelsSetRuntimeOverride',
      'cmdModelsClearRuntimeOverride',
    ];
    for (const fn of mutationFunctions) {
      const fnStart = modelsSource.indexOf(`function ${fn}`);
      const nextFnStart = modelsSource.indexOf('\nfunction ', fnStart + 1);
      const fnBody = modelsSource.slice(fnStart, nextFnStart > -1 ? nextFnStart : modelsSource.length);
      assert.doesNotMatch(fnBody, /ensureProjectConfig/,
        `${fn} must not call ensureProjectConfig. FIX: Use loadConfigForMutation instead.`);
    }
  });
});

describe('G14 - Health Module Contract', () => {
  test('bin/lib/health.mjs exists', () => {
    assert.ok(fs.existsSync(HEALTH_MODULE),
      'bin/lib/health.mjs must exist. FIX: Create the health module.');
  });

  test('health module exports createCmdHealth', async () => {
    const mod = await import(`file://${HEALTH_MODULE.replace(/\\/g, '/')}`);
    assert.strictEqual(typeof mod.createCmdHealth, 'function',
      'health.mjs must export createCmdHealth. FIX: Add export for createCmdHealth.');
  });

  test('gsdd.mjs registers health command', () => {
    const gsddContent = fs.readFileSync(GSDD_PATH, 'utf-8');
    assert.ok(gsddContent.includes("health: cmdHealth"),
      'gsdd.mjs must register health command. FIX: Add health: cmdHealth to COMMANDS.');
  });

  test('gsdd.mjs exports cmdHealth', () => {
    const gsddContent = fs.readFileSync(GSDD_PATH, 'utf-8');
    assert.match(gsddContent, /export.*cmdHealth/,
      'gsdd.mjs must export cmdHealth. FIX: Add cmdHealth to the export statement.');
  });

  test('help text mentions health command', async () => {
    const mod = await import(`file://${INIT_MODULE.replace(/\\/g, '/')}`);
    const previousLog = console.log;
    let output = '';
    console.log = (...parts) => { output += `${parts.join(' ')}\n`; };
    try {
      mod.cmdHelp();
    } finally {
      console.log = previousLog;
    }
    assert.match(output, /health/,
      'Help text must document the health command. FIX: Add health to cmdHelp output.');
  });

  test('health checks include fix instructions (no orphan diagnostics)', () => {
    const healthSource = fs.readFileSync(HEALTH_MODULE, 'utf-8');
    const lines = healthSource.split('\n');
    const pushLineRe = /^\s*(?:errors|warnings)\.push\(\{/;
    let pushCount = 0;

    for (let i = 0; i < lines.length; i++) {
      if (!pushLineRe.test(lines[i])) continue;
      pushCount++;
      let block = '';
      for (let j = i; j < Math.min(i + 12, lines.length); j++) {
        block += `${lines[j]}\n`;
        if (lines[j].includes('});')) break;
      }
      assert.match(block, /fix:/,
        `Every error/warning diagnostic must include a fix instruction. FIX: Add fix field. Found: ${block.slice(0, 120)}`);
    }
    assert.ok(pushCount > 0, 'health module must have diagnostic pushes');
  });
});

// ── G15: OWASP Authorization Matrix ─────────────────────────────────
describe('G15: OWASP Authorization Matrix', () => {
  const TEMPLATE_PATH = path.join(ROOT, 'distilled', 'templates', 'auth-matrix.md');
  const CHECKER_PATH = path.join(ROOT, 'agents', 'integration-checker.md');
  const AUDIT_PATH = path.join(ROOT, 'distilled', 'workflows', 'audit-milestone.md');
  const NEW_PROJECT_PATH = path.join(ROOT, 'distilled', 'workflows', 'new-project.md');
  const DESIGN_PATH = path.join(ROOT, 'distilled', 'DESIGN.md');

  test('auth-matrix.md template exists', () => {
    assert.ok(fs.existsSync(TEMPLATE_PATH),
      'distilled/templates/auth-matrix.md must exist. FIX: Create the template file.');
  });

  test('template contains OWASP pivot format markers', () => {
    const content = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.match(content, /Resource.*Action.*anonymous|Resource.*Action.*Role/i,
      'Template must contain OWASP pivot table headers. FIX: Add Resource/Action/Role table.');
    assert.match(content, /ALLOW/,
      'Template must document ALLOW permission. FIX: Add ALLOW to permission values.');
    assert.match(content, /DENY/,
      'Template must document DENY permission. FIX: Add DENY to permission values.');
    assert.match(content, /OWN/,
      'Template must document OWN permission. FIX: Add OWN to permission values.');
  });

  test('template references .planning/AUTH_MATRIX.md project artifact path', () => {
    const content = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.match(content, /\.planning\/AUTH_MATRIX\.md/,
      'Template must reference .planning/AUTH_MATRIX.md as project artifact. FIX: Add file location section.');
  });

  test('integration-checker.md references AUTH_MATRIX.md', () => {
    const content = fs.readFileSync(CHECKER_PATH, 'utf-8');
    assert.match(content, /AUTH_MATRIX\.md/,
      'integration-checker must reference AUTH_MATRIX.md. FIX: Add AUTH_MATRIX.md to inputs.');
  });

  test('integration-checker.md describes matrix-driven verification (Step 4a)', () => {
    const content = fs.readFileSync(CHECKER_PATH, 'utf-8');
    assert.match(content, /Step 4a/,
      'integration-checker must have Step 4a. FIX: Add matrix-driven auth verification sub-step.');
    assert.match(content, /\bVERIFIED\b/,
      'Step 4a must define VERIFIED cell status. FIX: Add cell status definitions.');
    assert.match(content, /\bMISMATCH\b/,
      'Step 4a must define MISMATCH cell status. FIX: Add cell status definitions.');
    assert.match(content, /\bUNTESTED\b/,
      'Step 4a must define UNTESTED cell status. FIX: Add cell status definitions.');
    assert.match(content, /matrix_coverage/,
      'Step 4a must include matrix_coverage output key. FIX: Add matrix_coverage to output schema.');
  });

  test('integration-checker.md matrix check is backwards compatible', () => {
    const content = fs.readFileSync(CHECKER_PATH, 'utf-8');
    assert.match(content, /does not exist.*skip/i,
      'Step 4a must be gated by AUTH_MATRIX.md existence check. FIX: Add existence guard.');
  });

  test('audit-milestone.md load_context references AUTH_MATRIX.md', () => {
    const content = fs.readFileSync(AUDIT_PATH, 'utf-8');
    assert.match(content, /AUTH_MATRIX\.md/,
      'audit-milestone must reference AUTH_MATRIX.md in load_context. FIX: Add to load_context list.');
  });

  test('new-project.md mentions auth matrix as optional', () => {
    const content = fs.readFileSync(NEW_PROJECT_PATH, 'utf-8');
    assert.match(content, /[Aa]uthorization [Mm]atrix.*optional|optional.*[Aa]uth/i,
      'new-project must mention auth matrix as optional. FIX: Add optional auth matrix item to spec_creation.');
  });

  test('DESIGN.md contains D21 with OWASP reference', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /## 21\./,
      'DESIGN.md must contain section 21. FIX: Add D21 OWASP Authorization Matrix.');
    assert.match(content, /OWASP/,
      'D21 must reference OWASP. FIX: Add OWASP evidence to D21.');
  });

  test('template is reasonably sized', () => {
    const content = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    const lines = content.split('\n').length;
    assert.ok(lines <= 120,
      `auth-matrix.md template should be <= 120 lines (got ${lines}). FIX: Trim template.`);
  });
});

// ── G17: Mapper Output Quantification ─────────────────────────────────
describe('G17 - Mapper Output Quantification', () => {
  const CONVENTIONS_TPL = path.join(ROOT, 'distilled', 'templates', 'codebase', 'conventions.md');
  const ARCHITECTURE_TPL = path.join(ROOT, 'distilled', 'templates', 'codebase', 'architecture.md');
  const STACK_TPL = path.join(ROOT, 'distilled', 'templates', 'codebase', 'stack.md');
  const CONCERNS_TPL = path.join(ROOT, 'distilled', 'templates', 'codebase', 'concerns.md');
  const DELEGATE_QUALITY = path.join(ROOT, 'distilled', 'templates', 'delegates', 'mapper-quality.md');
  const DELEGATE_ARCH = path.join(ROOT, 'distilled', 'templates', 'delegates', 'mapper-arch.md');
  const DELEGATE_TECH = path.join(ROOT, 'distilled', 'templates', 'delegates', 'mapper-tech.md');
  const DELEGATE_CONCERNS = path.join(ROOT, 'distilled', 'templates', 'delegates', 'mapper-concerns.md');
  const MAPPER_ROLE = path.join(ROOT, 'agents', 'mapper.md');
  const DESIGN_PATH = path.join(ROOT, 'distilled', 'DESIGN.md');

  // A: Template section presence (8 assertions)
  test('conventions.md has Convention Adoption Rates section', () => {
    const content = fs.readFileSync(CONVENTIONS_TPL, 'utf-8');
    assert.match(content, /## Convention Adoption Rates/,
      'conventions.md must have Convention Adoption Rates section. FIX: Add ## Convention Adoption Rates section.');
  });

  test('conventions.md has Golden Files section', () => {
    const content = fs.readFileSync(CONVENTIONS_TPL, 'utf-8');
    assert.match(content, /## Golden Files/,
      'conventions.md must have Golden Files section. FIX: Add ## Golden Files section.');
  });

  test('conventions.md Convention Adoption Rates uses ~N% format instruction', () => {
    const content = fs.readFileSync(CONVENTIONS_TPL, 'utf-8');
    assert.match(content, /~N%.*stable.*rising.*declining|stable\|rising\|declining/,
      'conventions.md must instruct ~N% (stable|rising|declining) format. FIX: Add format instruction to Convention Adoption Rates.');
  });

  test('architecture.md has Golden Files Per Layer section', () => {
    const content = fs.readFileSync(ARCHITECTURE_TPL, 'utf-8');
    assert.match(content, /## Golden Files Per Layer/,
      'architecture.md must have Golden Files Per Layer section. FIX: Add ## Golden Files Per Layer section.');
  });

  test('stack.md has Must-Know Packages section', () => {
    const content = fs.readFileSync(STACK_TPL, 'utf-8');
    assert.match(content, /## Must-Know Packages/,
      'stack.md must have Must-Know Packages section. FIX: Add ## Must-Know Packages section.');
  });

  test('stack.md Must-Know Packages mentions risk index', () => {
    const content = fs.readFileSync(STACK_TPL, 'utf-8');
    assert.match(content, /risk:.*low.*medium.*high|low\/medium\/high/,
      'stack.md Must-Know Packages must include risk index (low/medium/high). FIX: Add risk level language to Must-Know Packages.');
  });

  test('concerns.md has Downstream Impact Ranking section', () => {
    const content = fs.readFileSync(CONCERNS_TPL, 'utf-8');
    assert.match(content, /## Downstream Impact Ranking/,
      'concerns.md must have Downstream Impact Ranking section. FIX: Add ## Downstream Impact Ranking section.');
  });

  test('concerns.md Downstream Impact Ranking has table header with Blocks column', () => {
    const content = fs.readFileSync(CONCERNS_TPL, 'utf-8');
    assert.match(content, /\| Rank \|.*\| Blocks \|/,
      'concerns.md Downstream Impact Ranking must have table with Blocks column. FIX: Add table with Rank/Concern/Blocks/Severity/Fix effort headers.');
  });

  // B: Delegate quantification instructions (8 assertions)
  test('mapper-quality delegate Include list mentions adoption rate estimation', () => {
    const content = fs.readFileSync(DELEGATE_QUALITY, 'utf-8');
    assert.match(content, /adoption rate|~N%/,
      'mapper-quality delegate must include adoption rate estimation. FIX: Add adoption rate instruction to Include list.');
  });

  test('mapper-quality delegate quality_gate has adoption rate check', () => {
    const content = fs.readFileSync(DELEGATE_QUALITY, 'utf-8');
    assert.match(content, /At least one convention has a quantified adoption rate|quantified adoption/,
      'mapper-quality quality_gate must check for quantified adoption rate. FIX: Add adoption rate quality_gate item.');
  });

  test('mapper-quality delegate Include list mentions golden files', () => {
    const content = fs.readFileSync(DELEGATE_QUALITY, 'utf-8');
    assert.match(content, /[Gg]olden files/,
      'mapper-quality delegate must include golden files instruction. FIX: Add golden files to Include list.');
  });

  test('mapper-quality delegate quality_gate has golden files check', () => {
    const content = fs.readFileSync(DELEGATE_QUALITY, 'utf-8');
    assert.match(content, /Golden files.*at least 2|at least 2.*files/,
      'mapper-quality quality_gate must check golden files count. FIX: Add golden files quality_gate item.');
  });

  test('mapper-arch delegate Include list mentions golden files per layer', () => {
    const content = fs.readFileSync(DELEGATE_ARCH, 'utf-8');
    assert.match(content, /[Gg]olden files per layer|import frequency/,
      'mapper-arch delegate must include golden files per layer instruction. FIX: Add golden files per layer to Include list.');
  });

  test('mapper-arch delegate quality_gate has golden files table check', () => {
    const content = fs.readFileSync(DELEGATE_ARCH, 'utf-8');
    assert.match(content, /[Gg]olden files table/,
      'mapper-arch quality_gate must check golden files table. FIX: Add golden files table quality_gate item.');
  });

  test('mapper-tech delegate Include list mentions must-know packages with risk', () => {
    const content = fs.readFileSync(DELEGATE_TECH, 'utf-8');
    assert.match(content, /[Mm]ust-know packages|risk index/,
      'mapper-tech delegate must include must-know packages instruction. FIX: Add must-know packages to Include list.');
  });

  test('mapper-tech delegate quality_gate has must-know packages check', () => {
    const content = fs.readFileSync(DELEGATE_TECH, 'utf-8');
    assert.match(content, /[Mm]ust-know packages.*at least 3|at least 3.*packages/,
      'mapper-tech quality_gate must check must-know packages count. FIX: Add must-know packages quality_gate item.');
  });

  test('mapper-concerns delegate Include list mentions downstream impact ranking', () => {
    const content = fs.readFileSync(DELEGATE_CONCERNS, 'utf-8');
    assert.match(content, /[Dd]ownstream impact|impact ranking/,
      'mapper-concerns delegate must include downstream impact ranking instruction. FIX: Add downstream impact ranking to Include list.');
  });

  test('mapper-concerns delegate quality_gate has downstream impact ranking check', () => {
    const content = fs.readFileSync(DELEGATE_CONCERNS, 'utf-8');
    assert.match(content, /[Dd]ownstream impact.*table|impact.*table|at least.*concerns/,
      'mapper-concerns quality_gate must check downstream impact ranking table. FIX: Add downstream impact ranking quality_gate item.');
  });

  // C: Role quality guarantees (3 assertions)
  test('mapper.md Quality Guarantees mentions quantification', () => {
    const content = fs.readFileSync(MAPPER_ROLE, 'utf-8');
    assert.match(content, /[Qq]uantif/,
      'mapper.md Quality Guarantees must mention quantification. FIX: Add quantification guarantee to mapper.md.');
  });

  test('mapper.md Quality Guarantees mentions ~N% format', () => {
    const content = fs.readFileSync(MAPPER_ROLE, 'utf-8');
    assert.match(content, /~N%/,
      'mapper.md Quality Guarantees must mention ~N% format. FIX: Add ~N% format to mapper.md quantification guarantee.');
  });

  test('mapper.md Quality Guarantees mentions algorithmic golden files', () => {
    const content = fs.readFileSync(MAPPER_ROLE, 'utf-8');
    assert.match(content, /[Gg]olden files are algorithmic|import frequency.*golden/,
      'mapper.md Quality Guarantees must describe algorithmic golden file selection. FIX: Add algorithmic golden files guarantee to mapper.md.');
  });

  // D: D23 registration (3 assertions)
  test('DESIGN.md has D23 section', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /## 23\./,
      'DESIGN.md must contain section 23. FIX: Add D23 Mapper Output Quantification.');
  });

  test('DESIGN.md ToC has D23 entry', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /23\. \[Mapper Output Quantification/,
      'DESIGN.md ToC must have D23 entry. FIX: Add ToC entry for D23.');
  });

  test('D23 cites at least one evidence source', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /ideas\.md.*Feb 2026|Codified Context|GetDX|Agentic Coding Trends|codebase-context/i,
      'D23 must cite at least one evidence source. FIX: Add evidence citations to D23.');
  });
});

// ── G16: Distillation Ledger + Delegate Architecture ─────────────────────────────────
describe('G16 - Distillation Ledger + Delegate Architecture', () => {
  const DISTILLATION_PATH = path.join(ROOT, 'agents', 'DISTILLATION.md');
  const DESIGN_PATH = path.join(ROOT, 'distilled', 'DESIGN.md');

  test('agents/DISTILLATION.md exists', () => {
    assert.ok(fs.existsSync(DISTILLATION_PATH),
      'agents/DISTILLATION.md must exist. FIX: Create the distillation ledger.');
  });

  test('DISTILLATION.md contains all 10 canonical role names', () => {
    const content = fs.readFileSync(DISTILLATION_PATH, 'utf-8');
    const roles = ['mapper', 'researcher', 'synthesizer', 'planner', 'roadmapper', 'executor', 'verifier', 'integration-checker', 'debugger', 'approach-explorer'];
    for (const role of roles) {
      assert.match(content, new RegExp(`## \\d+\\..*${role}`, 'i'),
        `DISTILLATION.md must document ${role}. FIX: Add section for ${role}.`);
    }
  });

  test('DISTILLATION.md has GSD source label for each role', () => {
    const content = fs.readFileSync(DISTILLATION_PATH, 'utf-8');
    assert.match(content, /\*\*GSD source/i,
      'DISTILLATION.md must reference GSD sources. FIX: Add "GSD source" label to each role.');
  });

  test('DISTILLATION.md has Kept and Stripped sections', () => {
    const content = fs.readFileSync(DISTILLATION_PATH, 'utf-8');
    assert.match(content, /\*\*Kept/i,
      'DISTILLATION.md must document what was kept. FIX: Add "Kept" sections.');
    assert.match(content, /\*\*Stripped/i,
      'DISTILLATION.md must document what was stripped. FIX: Add "Stripped" sections.');
  });

  test('DISTILLATION.md has Merger type classification', () => {
    const content = fs.readFileSync(DISTILLATION_PATH, 'utf-8');
    assert.match(content, /\*\*Merger type/i,
      'DISTILLATION.md must classify merger types. FIX: Add "Merger type" to each role.');
  });

  test('DISTILLATION.md has summary merger table', () => {
    const content = fs.readFileSync(DISTILLATION_PATH, 'utf-8');
    assert.match(content, /Canonical role.*Absorbs from GSD.*Merger criteria/i,
      'DISTILLATION.md must have merger summary table. FIX: Add merger table.');
  });

  test('D22 exists in DESIGN.md', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /## 22\./,
      'DESIGN.md must contain section 22. FIX: Add D22 Delegate Layer Architecture.');
  });

  test('D22 heading references Delegate', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /22\. [^\n]*[Dd]elegate/,
      'D22 heading must reference "Delegate". FIX: Update heading to include Delegate.');
  });

  test('DESIGN.md ToC contains D22 entry', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /22\. \[Delegate Layer Architecture/,
      'DESIGN.md table of contents must have D22 entry. FIX: Add ToC entry for D22.');
  });

  test('D22 body references delegate layer pattern and distilled/templates/delegates/', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /distilled\/templates\/delegates\//,
      'D22 must reference the delegate path. FIX: Add delegate path reference to D22.');
    assert.match(content, /Delegate catalog/,
      'D22 must document the delegate catalog without a stale hard-coded count. FIX: Add the Delegate catalog heading.');
    assert.doesNotMatch(content, /Current delegates \(\d+\)|all \d+ delegate files/i,
      'D22 must not hard-code stale delegate counts. FIX: Describe the delegate catalog and derive exact file counts from disk in tests.');
  });

  test('D22 cites multi-agent orchestration literature', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /Anthropic.*multi-agent|OpenAI.*[Hh]arness|arXiv.*2603/,
      'D22 must cite multi-agent orchestration evidence. FIX: Add evidence citations to D22.');
  });

  test('D22 delegate table matches actual delegate files on disk', () => {
    const delegatesDir = path.join(ROOT, 'distilled', 'templates', 'delegates');
    const actualFiles = fs.readdirSync(delegatesDir)
      .filter(f => f.endsWith('.md'))
      .sort();
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    for (const file of actualFiles) {
      assert.ok(content.includes('`' + file + '`'),
        `D22 table must list actual delegate file ${file}. FIX: Update D22 table to match distilled/templates/delegates/.`);
    }
    assert.ok(actualFiles.length > 0,
      'Expected delegate files to exist. FIX: Restore distilled/templates/delegates/*.md.');
  });
});

// ── G18: Consumer Governance Completeness ─────────────────────────────────
describe('G18 - Consumer Governance Completeness', () => {
  const AGENTS_BLOCK = path.join(ROOT, 'distilled', 'templates', 'agents.block.md');
  const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
  const DESIGN_PATH = path.join(ROOT, 'distilled', 'DESIGN.md');

  // Read the WORKFLOWS array from bin/gsdd.mjs to get canonical workflow names
  const gsddSource = fs.readFileSync(GSDD_PATH, 'utf-8');
  const workflowNames = [...gsddSource.matchAll(/name:\s*'(gsdd-[a-z-]+)'/g)].map(m => m[1]);

  // G18.1: agents.block.md points to the portable workflow directory instead of
  // front-loading every workflow path into the AGENTS surface.
  test('agents.block.md points to the portable workflow directory', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    assert.match(content, /\.agents\/skills\/gsdd-\*\/SKILL\.md/,
      'agents.block.md must point to the portable workflow directory. FIX: Add a .agents/skills/gsdd-*/SKILL.md pointer.');
  });

  test('agents.block.md keeps only a compact set of anchor workflow names', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    for (const anchor of ['gsdd-new-project', 'gsdd-plan', 'gsdd-execute', 'gsdd-verify', 'gsdd-progress']) {
      assert.match(content, new RegExp(anchor),
        `agents.block.md must keep ${anchor} as an anchor workflow. FIX: Add ${anchor} to the compact workflow list.`);
    }

    const explicitSkillPaths = [...content.matchAll(/\.agents\/skills\/gsdd-[a-z-]+\/SKILL\.md/g)];
    assert.ok(explicitSkillPaths.length === 0,
      `agents.block.md should not enumerate every workflow path. Found ${explicitSkillPaths.length} explicit paths. FIX: Keep only the wildcard directory pointer.`);
  });

  // G18.2: CHANGELOG design decision count matches DESIGN.md
  test('CHANGELOG design decision count matches DESIGN.md', () => {
    const changelog = fs.readFileSync(CHANGELOG, 'utf-8');
    const designContent = fs.readFileSync(DESIGN_PATH, 'utf-8');
    const actualDecisions = (designContent.match(/^## \d+\./gm) || []).length;
    assert.ok(
      changelog.includes(`${actualDecisions} design decisions`),
      `CHANGELOG claims wrong design decision count. Actual: ${actualDecisions}. FIX: Update CHANGELOG to say "${actualDecisions} design decisions".`
    );
  });

  // G18.3: CHANGELOG lists all workflow names (derived dynamically from bin/gsdd.mjs)
  test('CHANGELOG lists all workflows', () => {
    const changelog = fs.readFileSync(CHANGELOG, 'utf-8');
    for (const wf of workflowNames) {
      const shortName = wf.replace(/^gsdd-/, '');
      assert.ok(
        changelog.includes(shortName),
        `CHANGELOG missing workflow "${shortName}". FIX: Add ${shortName} to CHANGELOG workflow list.`
      );
    }
  });

  // G18.4: DESIGN.md has D24 entry
  test('DESIGN.md has D24 section', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /## 24\./,
      'DESIGN.md must contain section 24. FIX: Add D24 Consumer Governance Completeness.');
  });

  test('DESIGN.md ToC has D24 entry', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /24\. \[Consumer Governance Completeness/,
      'DESIGN.md ToC must have D24 entry. FIX: Add ToC entry for D24.');
  });
});

// ── G19: Consumer First-Run Accuracy ─────────────────────────────────
describe('G19 - Consumer First-Run Accuracy', () => {
  const AGENTS_BLOCK = path.join(ROOT, 'distilled', 'templates', 'agents.block.md');
  const DESIGN_PATH = path.join(ROOT, 'distilled', 'DESIGN.md');
  const INIT_HELP = path.join(ROOT, 'bin', 'lib', 'init-runtime.mjs');

  test('README platform table uses only Native or Governance tier labels (no skill_aware)', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.doesNotMatch(readme, /skill_aware/,
      'README.md must not contain skill_aware. FIX: Replace skill_aware with governance_only in adapter tables.');
  });

  test('README platform table uses only Native or Governance tier labels (no custom_command_aware)', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.doesNotMatch(readme, /custom_command_aware/,
      'README.md must not contain custom_command_aware. FIX: Replace custom_command_aware with governance_only in adapter tables.');
  });

  test('README invocation table qualifies Cursor/Copilot/Gemini slash guidance', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.match(readme, /Cursor \/ Copilot \/ Gemini \| .*\/gsdd-plan.*when skill\/slash discovery is available/i,
      'README invocation table must qualify Cursor/Copilot/Gemini slash-command guidance. FIX: Use discovery-available wording plus SKILL.md fallback.');
  });

  test('README contains a Quickstart section', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.match(readme, /### Quickstart/,
      'README.md must contain a Quickstart section. FIX: Add ### Quickstart section after Getting Started.');
  });

  test('README describes npx init as a guided install wizard', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.match(readme, /guided install wizard/i,
      'README.md must describe the init command as a guided install wizard. FIX: Update the Platform Adapters or Getting Started section.');
    assert.match(readme, /npx -y gsdd-cli init/i,
      'README.md must prefer npx -y gsdd-cli init for humans. FIX: Replace primary bare gsdd init guidance.');
  });

  test('public docs distinguish skills entrypoints from the internal helper runtime', () => {
    const docs = [
      fs.readFileSync(README_MD, 'utf-8'),
      fs.readFileSync(path.join(ROOT, 'docs', 'RUNTIME-SUPPORT.md'), 'utf-8'),
      fs.readFileSync(path.join(ROOT, 'docs', 'USER-GUIDE.md'), 'utf-8'),
      fs.readFileSync(path.join(ROOT, 'distilled', 'README.md'), 'utf-8'),
    ].join('\n');

    assert.match(docs, /\.agents\/skills.*workflow entry/i,
      'Public docs must describe .agents/skills as the workflow entry surface. FIX: Add entry-surface wording.');
    assert.match(docs, /\.planning\/bin.*helper runtime/i,
      'Public docs must describe .planning/bin as the helper runtime. FIX: Add helper-runtime wording.');
    assert.doesNotMatch(docs, /\.agents[\\/]bin/i,
      'Public docs must not reference stale .agents/bin paths. FIX: Replace with .planning/bin/gsdd.mjs.');
  });

  test('generated governance and workflow guidance avoids stale helper and bare init paths', () => {
    const agentsBlock = fs.readFileSync(path.join(ROOT, 'distilled', 'templates', 'agents.block.md'), 'utf-8');
    const newProject = fs.readFileSync(path.join(ROOT, 'distilled', 'workflows', 'new-project.md'), 'utf-8');

    assert.doesNotMatch(agentsBlock, /adapters are generated under `bin\/`/i,
      'Generated AGENTS block must not describe adapters as generated under bin/. FIX: Describe .agents/skills, .planning/bin, and native adapter directories.');
    assert.match(agentsBlock, /npx -y gsdd-cli init/i,
      'Generated AGENTS block must prefer npx -y gsdd-cli init. FIX: Qualify bare gsdd as global-only.');
    assert.match(agentsBlock, /Codex CLI/i,
      'Generated AGENTS block must distinguish Codex CLI from Codex VS Code/app. FIX: Use Codex CLI in the $gsdd-plan invocation guidance.');
    assert.doesNotMatch(newProject, /`gsdd init --auto --brief <path>`/,
      'Generated new-project workflow must not suggest bare gsdd init for auto brief setup. FIX: Use npx -y gsdd-cli init --auto --tools <runtime> --brief <path>.');
  });

  test('public docs distinguish Codex CLI from Codex VS Code and app fallback', () => {
    const docs = [
      fs.readFileSync(README_MD, 'utf-8'),
      fs.readFileSync(path.join(ROOT, 'docs', 'RUNTIME-SUPPORT.md'), 'utf-8'),
      fs.readFileSync(path.join(ROOT, 'docs', 'USER-GUIDE.md'), 'utf-8'),
      fs.readFileSync(path.join(ROOT, 'distilled', 'README.md'), 'utf-8'),
    ].join('\n');

    assert.match(docs, /Codex CLI/i,
      'Public docs must keep the validated Codex CLI claim visible. FIX: Add Codex CLI wording.');
    assert.match(docs, /Codex VS Code/i,
      'Public docs must distinguish Codex VS Code from Codex CLI. FIX: Add Codex VS Code fallback wording.');
    assert.match(docs, /Codex app/i,
      'Public docs must distinguish the Codex app from Codex CLI. FIX: Add Codex app fallback wording.');
    assert.match(docs, /open|paste/i,
      'Public docs must describe opening/pasting SKILL.md when discovery is unavailable. FIX: Add fallback wording.');
  });

  test('README quickstart mentions all 3 platform invocation patterns', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const quickstartStart = readme.indexOf('### Quickstart');
    const quickstartEnd = readme.indexOf('###', quickstartStart + 1);
    const quickstart = readme.slice(quickstartStart, quickstartEnd > -1 ? quickstartEnd : quickstartStart + 800);
    assert.match(quickstart, /slash command/i,
      'Quickstart must mention slash commands. FIX: Add slash command invocation pattern to Quickstart.');
    assert.match(quickstart, /skill reference/i,
      'Quickstart must mention skill references. FIX: Add skill reference invocation pattern to Quickstart.');
    assert.match(quickstart, /SKILL\.md/,
      'Quickstart must mention opening SKILL.md. FIX: Add SKILL.md invocation pattern to Quickstart.');
  });

  test('README quickstart qualifies Cursor/Copilot/Gemini slash guidance before SKILL.md fallback', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const quickstartStart = readme.indexOf('### Quickstart');
    const quickstartEnd = readme.indexOf('###', quickstartStart + 1);
    const quickstart = readme.slice(quickstartStart, quickstartEnd > -1 ? quickstartEnd : quickstartStart + 800);
    assert.match(quickstart, /Cursor \/ Copilot \/ Gemini.*Use slash commands if your tool discovers/i,
      'Quickstart must qualify Cursor/Copilot/Gemini slash-command guidance. FIX: Use discovery-available wording.');
    assert.match(quickstart, /if it does not, open `.agents\/skills\/gsdd-<workflow>\/SKILL\.md`/i,
      'Quickstart must include SKILL.md fallback only when discovery is unavailable. FIX: Add fallback wording after slash guidance.');
  });

  test('agents.block.md uses compact invoke guidance', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    assert.match(content, /^Invoke:/m,
      'agents.block.md must keep a compact Invoke line. FIX: Add a single-line Invoke section.');
  });

  test('agents.block.md invocation line mentions slash commands for supported runtimes', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    assert.match(content, /\/gsdd-plan.*Claude.*OpenCode.*Cursor\/Copilot\/Gemini when skill discovery is available/i,
      'agents.block.md invocation must qualify slash-command guidance for less-proven runtimes. FIX: Include discovery-available wording in the compact Invoke line.');
  });

  test('agents.block.md invocation section mentions Codex skill references', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    assert.match(content, /Codex.*skill reference|\$gsdd-/,
      'agents.block.md invocation must mention Codex skill references. FIX: Add skill reference guidance for Codex.');
  });

  test('agents.block.md invocation line mentions opening SKILL.md for fallback tools', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    assert.match(content, /open SKILL\.md directly elsewhere/i,
      'agents.block.md invocation must mention opening SKILL.md for fallback tools. FIX: Add compact SKILL.md fallback guidance to the Invoke line.');
  });

  test('agents.block.md stays focused on compact governance rules', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    assert.match(content, /^Rules:/m,
      'agents.block.md must keep a compact Rules section. FIX: Preserve the short governance rules list.');
    assert.doesNotMatch(content, /### How To Invoke Workflows|### Where The Workflows Live/i,
      'agents.block.md should stay compact and avoid the old verbose section layout. FIX: Keep invocation/workflow guidance condensed.');
  });

  test('agents.block.md stays focused on governance and discovery, not launch proof posture', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    assert.doesNotMatch(content, /### Public Support Wording/i,
      'agents.block.md must not carry a public support wording section. FIX: Keep launch proof posture in public docs/help, not consumer governance.');
    assert.doesNotMatch(content, /directly validated runtime story|directly validated today|qualified support/i,
      'agents.block.md must not restate launch proof posture. FIX: Keep the generated governance block focused on invocation and behavior rules.');
  });

  test('README adapter architecture table does NOT contain skill_aware', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const archSection = readme.slice(readme.indexOf('### Adapter Architecture'));
    assert.doesNotMatch(archSection, /`skill_aware`/,
      'README adapter architecture table must not contain skill_aware. FIX: Replace with governance_only.');
  });

  test('README adapter architecture table does NOT contain custom_command_aware', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const archSection = readme.slice(readme.indexOf('### Adapter Architecture'));
    assert.doesNotMatch(archSection, /`custom_command_aware`/,
      'README adapter architecture table must not contain custom_command_aware. FIX: Replace with governance_only.');
  });

  test('DESIGN.md contains D25 entry', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /## 25\./,
      'DESIGN.md must contain section 25. FIX: Add D25 Consumer First-Run Experience.');
  });

  test('init help text does not imply Cursor/Copilot/Gemini need AGENTS for workflow discovery', () => {
    const content = fs.readFileSync(INIT_HELP, 'utf-8');
    assert.match(content, /cursor\s+Generate root AGENTS\.md governance block; workflows are already discovered natively from \.agents\/skills\//,
      "init help must describe cursor as governance augmentation on top of native skill discovery. FIX: Replace 'Same as agents' with native-discovery wording.");
    assert.match(content, /copilot\s+Generate root AGENTS\.md governance block; workflows are already discovered natively from \.agents\/skills\//,
      "init help must describe copilot as governance augmentation on top of native skill discovery. FIX: Replace 'Same as agents' with native-discovery wording.");
    assert.match(content, /gemini\s+Generate root AGENTS\.md governance block; workflows are already discovered natively from \.agents\/skills\//,
      "init help must describe gemini as governance augmentation on top of native skill discovery. FIX: Replace 'Same as agents' with native-discovery wording.");
  });

  test('init help describes separate governance decision in the wizard', () => {
    const content = fs.readFileSync(INIT_HELP, 'utf-8');
    assert.match(content, /separately decide whether repo-wide AGENTS\.md governance is worth installing/i,
      'init help must describe governance as a separate wizard decision. FIX: Add wizard governance wording to help text.');
  });

  test('init help text carries the same proof-split public support wording', () => {
    const content = fs.readFileSync(INIT_HELP, 'utf-8');
    assert.match(content, /directly validated launch surfaces.*Claude Code.*OpenCode.*Codex CLI/i,
      'init help must state which runtimes are directly validated. FIX: Add a direct-proof note in the help text.');
    assert.match(content, /Cursor, Copilot, and Gemini are qualified support/i,
      'init help must describe Cursor/Copilot/Gemini as qualified support. FIX: Add the qualified-support note in the help text.');
  });

  test('post-init routing includes slash-command guidance for Cursor/Copilot/Gemini', async () => {
    const mod = await import(`file://${INIT_RUNTIME_MODULE.replace(/\\/g, '/')}`);
    const lines = mod.getPostInitRoutingLines(['cursor', 'copilot', 'gemini']);
    const content = lines.join('\n');
    assert.match(content, /Cursor:\s+\/gsdd-new-project/,
      'post-init routing must show Cursor slash-command guidance. FIX: Add Cursor /gsdd-new-project to init output.');
    assert.match(content, /Copilot:\s+\/gsdd-new-project/,
      'post-init routing must show Copilot slash-command guidance. FIX: Add Copilot /gsdd-new-project to init output.');
    assert.match(content, /Gemini CLI:\s+\/gsdd-new-project/,
      'post-init routing must show Gemini slash-command guidance. FIX: Add Gemini /gsdd-new-project to init output.');
  });

  test('DESIGN.md ToC lists every documented decision', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    const tocEntries = (content.match(/^\d+\. \[/gm) || []);
    const decisionHeaders = (content.match(/^## (?:(?:\d+\.)|(?:D\d+ - ))/gm) || []);
    assert.strictEqual(tocEntries.length, decisionHeaders.length,
      `DESIGN.md ToC has ${tocEntries.length} entries but ${decisionHeaders.length} documented decisions. FIX: Update DESIGN.md ToC to list every decision.`);
  });
});

// ---------------------------------------------------------------------------
// G20 - Session Continuity Contracts
// ---------------------------------------------------------------------------
describe('G20 - Session Continuity Contracts', () => {
  const WORKFLOWS_DIR = path.join(ROOT, 'distilled', 'workflows');
  const PAUSE_PATH = path.join(WORKFLOWS_DIR, 'pause.md');
  const RESUME_PATH = path.join(WORKFLOWS_DIR, 'resume.md');
  const PROGRESS_PATH = path.join(WORKFLOWS_DIR, 'progress.md');
  const DESIGN_PATH = path.join(ROOT, 'distilled', 'DESIGN.md');

  // ---- A. Pause checkpoint contract ----

  test('pause.md <write_checkpoint> contains frontmatter template with workflow, phase, timestamp', () => {
    const content = fs.readFileSync(PAUSE_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<write_checkpoint>'), content.indexOf('</write_checkpoint>'));
    assert.match(section, /workflow:/, 'write_checkpoint must contain workflow frontmatter. FIX: Add workflow field to checkpoint template.');
    assert.match(section, /phase:/, 'write_checkpoint must contain phase frontmatter. FIX: Add phase field to checkpoint template.');
    assert.match(section, /timestamp:/, 'write_checkpoint must contain timestamp frontmatter. FIX: Add timestamp field to checkpoint template.');
  });

  test('pause.md checkpoint template has all 6 XML sections', () => {
    const content = fs.readFileSync(PAUSE_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<write_checkpoint>'), content.indexOf('</write_checkpoint>'));
    const required = ['current_state', 'completed_work', 'remaining_work', 'decisions', 'blockers', 'next_action'];
    for (const tag of required) {
      assert.match(section, new RegExp(`<${tag}>`),
        `write_checkpoint must contain <${tag}> section. FIX: Add <${tag}> to checkpoint template.`);
    }
  });

  test('pause.md <detect_work> covers 3 work types', () => {
    const content = fs.readFileSync(PAUSE_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<detect_work>'), content.indexOf('</detect_work>'));
    assert.match(section, /phase/i, 'detect_work must mention phase work. FIX: Add phase detection to detect_work.');
    assert.match(section, /quick/i, 'detect_work must mention quick work. FIX: Add quick detection to detect_work.');
    assert.match(section, /generic/i, 'detect_work must mention generic work. FIX: Add generic detection to detect_work.');
  });

  test('pause.md <gather_state> covers 6 conversation topics', () => {
    const content = fs.readFileSync(PAUSE_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<gather_state>'), content.indexOf('</gather_state>'));
    const topics = ['completed', 'approach', 'remaining', 'decisions', 'blockers', 'resum'];
    for (const topic of topics) {
      assert.match(section, new RegExp(topic, 'i'),
        `gather_state must mention ${topic}. FIX: Add ${topic} to gather_state conversation topics.`);
    }
  });

  test('pause.md <advisory_git> exists and references gitProtocol', () => {
    const content = fs.readFileSync(PAUSE_PATH, 'utf-8');
    assert.match(content, /<advisory_git>/, 'pause.md must have <advisory_git> section. FIX: Add advisory_git section.');
    const section = content.slice(content.indexOf('<advisory_git>'), content.indexOf('</advisory_git>'));
    assert.match(section, /gitProtocol/, 'advisory_git must reference gitProtocol. FIX: Add gitProtocol reference to advisory_git.');
  });

  test('pause.md <confirm> exists with resume instruction', () => {
    const content = fs.readFileSync(PAUSE_PATH, 'utf-8');
    assert.match(content, /<confirm>/, 'pause.md must have <confirm> section. FIX: Add confirm section.');
    const section = content.slice(content.indexOf('<confirm>'), content.indexOf('</confirm>'));
    assert.match(section, /resume/, 'confirm must mention resume. FIX: Add resume instruction to confirm section.');
  });

  // ---- B. Resume routing completeness ----

  test('resume.md <detect_state> has 3 routing conditions', () => {
    const content = fs.readFileSync(RESUME_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<detect_state>'), content.indexOf('</detect_state>'));
    assert.match(section, /No `.planning\/`|No.*\.planning/, 'detect_state must check for missing .planning/. FIX: Add .planning/ existence check.');
    assert.match(section, /partial init|not fully initialized/, 'detect_state must check for partial init. FIX: Add partial init detection.');
    assert.match(section, /proceed|Both exist/, 'detect_state must have a proceed condition. FIX: Add proceed path to detect_state.');
  });

  test('resume.md <load_artifacts> references 5 artifact types', () => {
    const content = fs.readFileSync(RESUME_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<load_artifacts>'), content.indexOf('</load_artifacts>'));
    assert.match(section, /ROADMAP\.md/, 'load_artifacts must reference ROADMAP.md. FIX: Add ROADMAP.md to load_artifacts.');
    assert.match(section, /SPEC\.md/, 'load_artifacts must reference SPEC.md. FIX: Add SPEC.md to load_artifacts.');
    assert.match(section, /\.continue-here\.md|checkpoint/i, 'load_artifacts must reference checkpoint file. FIX: Add .continue-here.md to load_artifacts.');
    assert.match(section, /phase/i, 'load_artifacts must reference phase directories. FIX: Add phase directory scanning to load_artifacts.');
    assert.match(section, /LOG\.md|quick/i, 'load_artifacts must reference quick task log. FIX: Add LOG.md to load_artifacts.');
  });

  test('resume.md <determine_action> has 5 routing branches in priority order', () => {
    const content = fs.readFileSync(RESUME_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<determine_action>'), content.indexOf('</determine_action>'));
    assert.match(section, /checkpoint|\.continue-here/i, 'determine_action must have checkpoint routing. FIX: Add checkpoint branch.');
    assert.match(section, /PLAN.*without.*SUMMARY|Incomplete.*execution/i, 'determine_action must have incomplete execution routing. FIX: Add PLAN-without-SUMMARY branch.');
    assert.match(section, /\/gsdd-plan|needs planning/i, 'determine_action must route to plan. FIX: Add planning branch.');
    assert.match(section, /\/gsdd-verify|needs verification/i, 'determine_action must route to verify. FIX: Add verification branch.');
    assert.match(section, /\/gsdd-audit-milestone|All phases complete/i, 'determine_action must route to audit-milestone. FIX: Add all-phases-complete branch.');
  });

  test('resume.md <cleanup_checkpoint> references deletion before routing', () => {
    const content = fs.readFileSync(RESUME_PATH, 'utf-8');
    assert.match(content, /<cleanup_checkpoint>/, 'resume.md must have <cleanup_checkpoint> section. FIX: Add cleanup_checkpoint section.');
    const section = content.slice(content.indexOf('<cleanup_checkpoint>'), content.indexOf('</cleanup_checkpoint>'));
    assert.match(section, /delet/i, 'cleanup_checkpoint must reference deletion. FIX: Add deletion instruction to cleanup_checkpoint.');
  });

  test('resume.md <present_options> contains quick-resume shortcut', () => {
    const content = fs.readFileSync(RESUME_PATH, 'utf-8');
    assert.match(content, /<present_options>/, 'resume.md must have <present_options> section. FIX: Add present_options section.');
    const section = content.slice(content.indexOf('<present_options>'), content.indexOf('</present_options>'));
    assert.match(section, /continue|go|resume/i, 'present_options must contain quick-resume shortcut. FIX: Add continue/go/resume shortcut.');
  });

  // ---- C. Progress routing completeness ----

  test('progress.md <check_existence> has 4-way detection', () => {
    const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<check_existence>'), content.indexOf('</check_existence>'));
    assert.match(section, /No `.planning\/`|No.*\.planning/, 'check_existence must check for missing .planning/. FIX: Add .planning/ existence check.');
    assert.match(section, /No.*ROADMAP.*AND.*no.*SPEC|no artifacts/i, 'check_existence must check for no artifacts. FIX: Add no-artifacts detection.');
    assert.match(section, /codebase|quick/i,
      'check_existence must distinguish non-phase brownfield artifacts from truly empty state. FIX: Add codebase/quick detection before routing to /gsdd-new-project.');
    assert.match(section, /between.milestones|SPEC.*exists.*ROADMAP.*not/i, 'check_existence must detect between-milestones state. FIX: Add between-milestones detection.');
    assert.match(section, /Both exist|proceed/i, 'check_existence must have proceed path. FIX: Add proceed condition.');
  });

  test('progress.md <route_action> contains all 6 named branches', () => {
    const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<route_action>'), content.indexOf('</route_action>'));
    assert.match(section, /Branch A/i, 'route_action must have Branch A (checkpoint). FIX: Add Branch A.');
    assert.match(section, /Branch B/i, 'route_action must have Branch B (execute). FIX: Add Branch B.');
    assert.match(section, /Branch C/i, 'route_action must have Branch C (plan). FIX: Add Branch C.');
    assert.match(section, /Branch D/i, 'route_action must have Branch D (verify). FIX: Add Branch D.');
    assert.match(section, /Branch E/i, 'route_action must have Branch E (audit-milestone). FIX: Add Branch E.');
    assert.match(section, /Branch F/i, 'route_action must have Branch F (non-phase state). FIX: Add Branch F.');
  });

  test('progress.md distinguishes audit-ready from archived-with-ROADMAP state', () => {
    const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    const derive = content.slice(content.indexOf('<derive_status>'), content.indexOf('</derive_status>'));
    const route = content.slice(content.indexOf('<route_action>'), content.indexOf('</route_action>'));

    assert.match(derive, /MILESTONES\.md/,
      'derive_status must inspect .planning/MILESTONES.md before treating an all-complete roadmap as archived. FIX: Add shipped-ledger check.');
    assert.match(derive, /MILESTONE-AUDIT\.md|archived milestone audit artifact/i,
      'derive_status must require the matching archived milestone audit artifact. FIX: Add audit-artifact check.');
    assert.match(route, /archived-with-`?ROADMAP\.md`?|retained `?ROADMAP\.md`?/i,
      'route_action must name the archived-with-ROADMAP state explicitly. FIX: Add retained-ROADMAP wording.');
    assert.match(route, /Branch E[\s\S]*not yet archived/i,
      'Branch E must stay limited to audit-ready, not-yet-archived milestones. FIX: Narrow Branch E condition.');
    assert.match(route, /Branch F[\s\S]*\/gsdd-new-milestone/i,
      'Branch F must route archived milestones to /gsdd-new-milestone. FIX: Add archived milestone routing.');
  });

  test('progress.md Branch F covers codebase-only and quick-lane brownfield states', () => {
    const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    const derive = content.slice(content.indexOf('<derive_status>'), content.indexOf('</derive_status>'));
    const route = content.slice(content.indexOf('<route_action>'), content.indexOf('</route_action>'));

    assert.match(derive, /codebase_only|codebase-only/i,
      'derive_status must classify codebase-only brownfield state. FIX: Add codebase-only non-phase classification.');
    assert.match(derive, /quick_lane|quick lane/i,
      'derive_status must classify quick-lane-only brownfield state. FIX: Add quick-lane non-phase classification.');
    assert.match(route, /codebase-only brownfield state[\s\S]*\/gsdd-quick/i,
      'Branch F must route codebase-only brownfield state toward /gsdd-quick. FIX: Add codebase-only quick routing.');
    assert.match(route, /quick-lane brownfield state with incomplete quick work[\s\S]*\/gsdd-quick/i,
      'Branch F must route incomplete quick-lane state back to /gsdd-quick. FIX: Add quick-lane continuation routing.');
    assert.match(route, /Also available: \/gsdd-new-project[\s\S]*\/gsdd-map-codebase/i,
      'Branch F must preserve both /gsdd-new-project and /gsdd-map-codebase as brownfield alternatives. FIX: Add both alternatives to the non-phase brownfield route.');
  });

  test('progress.md <edge_cases> section exists and documents compound states', () => {
    const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    assert.match(content, /<edge_cases>/, 'progress.md must have <edge_cases> section. FIX: Add edge_cases section.');
    const section = content.slice(content.indexOf('<edge_cases>'), content.indexOf('</edge_cases>'));
    assert.match(section, /compound|Checkpoint.*unexecuted|multiple/i,
      'edge_cases must document compound states. FIX: Add compound state handling to edge_cases.');
  });

  test('progress.md <recent_work> section exists', () => {
    const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    assert.match(content, /<recent_work>/, 'progress.md must have <recent_work> section. FIX: Add recent_work section.');
    const section = content.slice(content.indexOf('<recent_work>'), content.indexOf('</recent_work>'));
    assert.match(section, /SUMMARY\.md/i, 'recent_work must reference SUMMARY.md scanning. FIX: Add SUMMARY.md scanning to recent_work.');
  });

  test('progress.md branches use named output format with "Also available"', () => {
    const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<route_action>'), content.indexOf('</route_action>'));
    assert.match(section, /Also available/i,
      'route_action branches must include "Also available" alternatives. FIX: Add "Also available" to branch output format.');
  });

  test('progress.md success_criteria contains "no files created, modified, or deleted"', () => {
    const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    assert.match(content, /[Nn]o files (are )?created,? modified,? or deleted|read.only/i,
      'progress.md success_criteria must state no files are created/modified/deleted. FIX: Add read-only assertion to success_criteria.');
  });

  // ---- D. Cross-workflow session contract ----

  test('pause creates .continue-here.md, resume reads + deletes it, progress only reads it', () => {
    const pause = fs.readFileSync(PAUSE_PATH, 'utf-8');
    const resume = fs.readFileSync(RESUME_PATH, 'utf-8');
    const progress = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    assert.match(pause, /\.continue-here\.md/, 'pause.md must reference .continue-here.md. FIX: Add .continue-here.md to pause.');
    assert.match(resume, /\.continue-here\.md/, 'resume.md must reference .continue-here.md. FIX: Add .continue-here.md to resume.');
    assert.match(progress, /\.continue-here\.md/, 'progress.md must reference .continue-here.md. FIX: Add .continue-here.md to progress.');
    // Resume deletes, progress does not
    assert.match(resume, /delet.*\.continue-here|\.continue-here.*delet/is,
      'resume.md must delete .continue-here.md. FIX: Add checkpoint deletion to resume.');
    assert.match(progress, /[Rr]ead.only|[Nn]o files.*created.*modified.*deleted/,
      'progress.md must be read-only (not delete checkpoint). FIX: Ensure progress is read-only.');
  });

  test('all 3 session workflows reference the same checkpoint path', () => {
    const pause = fs.readFileSync(PAUSE_PATH, 'utf-8');
    const resume = fs.readFileSync(RESUME_PATH, 'utf-8');
    const progress = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    const checkpointPath = '.planning/.continue-here.md';
    assert.ok(pause.includes(checkpointPath),
      `pause.md must reference ${checkpointPath}. FIX: Use canonical checkpoint path.`);
    assert.ok(resume.includes(checkpointPath),
      `resume.md must reference ${checkpointPath}. FIX: Use canonical checkpoint path.`);
    assert.ok(progress.includes(checkpointPath),
      `progress.md must reference ${checkpointPath}. FIX: Use canonical checkpoint path.`);
  });

  test('pause.md and resume.md both reference .continue-here.bak for backup safety (I29)', () => {
    const pause = fs.readFileSync(PAUSE_PATH, 'utf-8');
    const resume = fs.readFileSync(RESUME_PATH, 'utf-8');
    assert.match(pause, /\.continue-here\.bak/,
      'pause.md must reference .continue-here.bak. FIX: Add .bak cleanup to <write_checkpoint>.');
    assert.match(resume, /\.continue-here\.bak/,
      'resume.md must reference .continue-here.bak. FIX: Add .bak copy to <cleanup_checkpoint>.');
  });

  test('resume.md <completion> must NOT delete .continue-here.bak (session-boundary safety, D42)', () => {
    const content = fs.readFileSync(RESUME_PATH, 'utf-8');
    const compStart = content.indexOf('<completion>');
    const compEnd = content.indexOf('</completion>');
    const completion = content.slice(compStart, compEnd);
    const deletesBAK = /delete/i.test(completion) && completion.includes('.continue-here.bak');
    assert.ok(!deletesBAK,
      'resume.md <completion> must not delete .continue-here.bak. FIX: Remove .bak deletion from <completion>; downstream workflows auto-clean after absorbing judgment (D42).');
  });

  test('plan.md, execute.md, verify.md, quick.md reference .continue-here.bak as fallback judgment source (D42)', () => {
    const targets = [
      ['plan.md', path.join(WORKFLOWS_DIR, 'plan.md')],
      ['execute.md', path.join(WORKFLOWS_DIR, 'execute.md')],
      ['verify.md', path.join(WORKFLOWS_DIR, 'verify.md')],
      ['quick.md', path.join(WORKFLOWS_DIR, 'quick.md')],
    ];
    for (const [name, filePath] of targets) {
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.match(content, /\.continue-here\.bak/,
        `${name} must reference .continue-here.bak as session-boundary fallback judgment source. FIX: Add fallback read to <load_context> or Step 2 (D42).`);
    }
  });

  test('resume <determine_action> routes to workflows that exist in the valid workflow set', () => {
    const content = fs.readFileSync(RESUME_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<determine_action>'), content.indexOf('</determine_action>'));
    const workflows = section.match(/\/gsdd-[\w-]+/g) || [];
    const validWorkflows = [
      '/gsdd-new-project', '/gsdd-plan', '/gsdd-execute', '/gsdd-verify',
      '/gsdd-audit-milestone', '/gsdd-new-milestone', '/gsdd-quick', '/gsdd-pause', '/gsdd-resume',
      '/gsdd-progress', '/gsdd-map-codebase'
    ];
    for (const wf of workflows) {
      assert.ok(validWorkflows.includes(wf),
        `resume.md references unknown workflow ${wf}. FIX: Use only valid workflow references.`);
    }
    assert.ok(workflows.length >= 3,
      `resume.md determine_action must route to at least 3 workflows, found ${workflows.length}. FIX: Add routing branches.`);
  });

  test('progress <route_action> routes to workflows that exist in the 14-workflow set', () => {
    const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<route_action>'), content.indexOf('</route_action>'));
    const workflows = section.match(/\/gsdd-\w[\w-]*/g) || [];
    const validWorkflows = [
      '/gsdd-new-project', '/gsdd-plan', '/gsdd-execute', '/gsdd-verify',
      '/gsdd-audit-milestone', '/gsdd-complete-milestone', '/gsdd-new-milestone',
      '/gsdd-plan-milestone-gaps', '/gsdd-quick', '/gsdd-pause', '/gsdd-resume',
      '/gsdd-progress', '/gsdd-map-codebase'
    ];
    for (const wf of workflows) {
      assert.ok(validWorkflows.includes(wf),
        `progress.md references unknown workflow ${wf}. FIX: Use only valid workflow references.`);
    }
    assert.ok(workflows.length >= 5,
      `progress.md route_action must route to at least 5 workflows, found ${workflows.length}. FIX: Add routing branches.`);
  });

  test('pause and resume reference config.json for conditional routing', () => {
    const pause = fs.readFileSync(PAUSE_PATH, 'utf-8');
    const resume = fs.readFileSync(RESUME_PATH, 'utf-8');
    assert.match(pause, /config\.json/, 'pause.md must reference config.json. FIX: Add config.json reference to pause.');
    assert.match(resume, /config\.json/, 'resume.md must reference config.json. FIX: Add config.json reference to resume.');
  });

  test('DESIGN.md contains D26 entry', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /## 26\./,
      'DESIGN.md must contain section 26. FIX: Add D26 Session Continuity Contract Hardening.');
  });
});

// ---------------------------------------------------------------------------
// G21 - Consumer Surface Completeness
// ---------------------------------------------------------------------------
describe('G21 - Consumer Surface Completeness', () => {
  const DESIGN_PATH = path.join(ROOT, 'distilled', 'DESIGN.md');

  test('README has Troubleshooting section', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.match(readme, /## Troubleshooting/,
      'README.md must have a ## Troubleshooting section. FIX: Add ## Troubleshooting section to README.');
  });

  test('Troubleshooting mentions health as first step', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const tsStart = readme.indexOf('## Troubleshooting');
    const tsEnd = readme.indexOf('\n## ', tsStart + 1);
    const section = readme.slice(tsStart, tsEnd > -1 ? tsEnd : tsStart + 1000);
    assert.match(section, /npx -y gsdd-cli health|gsdd health/,
      'Troubleshooting must mention health as first step. FIX: Add npx -y gsdd-cli health as first troubleshooting step.');
  });

  test('Troubleshooting links to User Guide', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const tsStart = readme.indexOf('## Troubleshooting');
    const tsEnd = readme.indexOf('\n## ', tsStart + 1);
    const section = readme.slice(tsStart, tsEnd > -1 ? tsEnd : tsStart + 1000);
    assert.match(section, /USER-GUIDE\.md/,
      'Troubleshooting must link to docs/USER-GUIDE.md. FIX: Add User Guide link to Troubleshooting.');
  });

  test('README mentions --auto headless mode in Getting Started', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const gsStart = readme.indexOf('## Getting Started');
    const gsEnd = readme.indexOf('\n## ', gsStart + 1);
    const section = readme.slice(gsStart, gsEnd > -1 ? gsEnd : gsStart + 3000);
    assert.match(section, /--auto/,
      'Getting Started must mention --auto flag. FIX: Add Headless Mode section with --auto to Getting Started.');
  });

  test('README mentions --brief in Getting Started', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const gsStart = readme.indexOf('## Getting Started');
    const gsEnd = readme.indexOf('\n## ', gsStart + 1);
    const section = readme.slice(gsStart, gsEnd > -1 ? gsEnd : gsStart + 3000);
    assert.match(section, /--brief/,
      'Getting Started must mention --brief flag. FIX: Add --brief to Headless Mode section.');
  });

  test('README has Team Use section', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.match(readme, /### Team Use/,
      'README.md must have a ### Team Use section. FIX: Add ### Team Use section to Getting Started.');
  });

  test('Team Use references commitDocs', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const tuStart = readme.indexOf('### Team Use');
    const tuEnd = readme.indexOf('\n### ', tuStart + 1);
    const section = readme.slice(tuStart, tuEnd > -1 ? tuEnd : tuStart + 800);
    assert.match(section, /commitDocs/,
      'Team Use must reference commitDocs setting. FIX: Mention commitDocs in Team Use section.');
  });

  test('README links to docs/USER-GUIDE.md', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.match(readme, /\[User Guide\]\(docs\/USER-GUIDE\.md\)/,
      'README must link to docs/USER-GUIDE.md. FIX: Add [User Guide](docs/USER-GUIDE.md) link.');
  });

  test('README Configuration explains model profile strategy (quality/balanced/budget guidance)', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const cfgStart = readme.indexOf('## Configuration');
    const cfgEnd = readme.indexOf('\n## ', cfgStart + 1);
    const section = readme.slice(cfgStart, cfgEnd > -1 ? cfgEnd : cfgStart + 3000);
    assert.match(section, /quality.*maximize|maximize.*rigor/i,
      'Configuration must explain quality profile. FIX: Add model profile guidance to Configuration.');
    assert.match(section, /budget.*minimize|minimize.*cost/i,
      'Configuration must explain budget profile. FIX: Add model profile guidance to Configuration.');
  });

  test('README has What to Track in Git section', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.match(readme, /### What to Track in Git/,
      'README.md must have a ### What to Track in Git section. FIX: Add ### What to Track in Git section.');
  });

  test('DESIGN.md contains D27 entry', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /## 27\./,
      'DESIGN.md must contain section 27. FIX: Add D27 Consumer-Ready Surface Completion.');
  });

  // ToC count already asserted by G19; no duplicate needed here.
});

// ---------------------------------------------------------------------------
// G22 - Workflow Completion Routing
// ---------------------------------------------------------------------------
describe('G22 - Workflow Completion Routing', () => {
  const WORKFLOWS_DIR = path.join(ROOT, 'distilled', 'workflows');
  const DESIGN_PATH = path.join(ROOT, 'distilled', 'DESIGN.md');

  // Lifecycle workflows that MUST have <completion> sections with routing
  const LIFECYCLE_WORKFLOWS = [
    'new-project.md',
    'plan.md',
    'execute.md',
    'verify.md',
    'audit-milestone.md',
    'complete-milestone.md',
    'new-milestone.md',
    'plan-milestone-gaps.md',
    'quick.md',
    'pause.md',
    'resume.md',
    'map-codebase.md',
  ];

  for (const wf of LIFECYCLE_WORKFLOWS) {
    test(`${wf} has <completion> section`, () => {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, wf), 'utf-8');
      assert.match(content, /<completion>/,
        `${wf} must have a <completion> section. FIX: Add <completion> section with next-step routing.`);
      assert.match(content, /<\/completion>/,
        `${wf} must have a closing </completion> tag. FIX: Close the <completion> section.`);
    });

    test(`${wf} completion names a next step`, () => {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, wf), 'utf-8');
      const compStart = content.indexOf('<completion>');
      const compEnd = content.indexOf('</completion>');
      if (compStart === -1 || compEnd === -1) return; // caught by previous test
      const section = content.slice(compStart, compEnd);
      assert.match(section, /\/gsdd-/,
        `${wf} completion must reference at least one /gsdd- command. FIX: Add next-step routing to <completion>.`);
    });
  }

  // Specific routing correctness: each lifecycle workflow routes to the right next step
  test('new-project.md completion routes to /gsdd-plan', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-project.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    assert.match(section, /\/gsdd-plan/,
      'new-project completion must route to /gsdd-plan. FIX: Add /gsdd-plan as next step in completion.');
  });

  test('plan.md completion keeps execution as a separate explicit next workflow', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'plan.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    assert.match(section, /\/gsdd-execute/,
      'plan completion must route to /gsdd-execute. FIX: Add /gsdd-execute as next step in completion.');
    assert.match(section, /Planning stops here|plan-only|separate run/i,
      'plan completion must state that planning ends before execution starts. FIX: Add explicit plan-only boundary wording.');
    assert.doesNotMatch(section, /execute the plan/i,
      'plan completion must not use imperative same-run execution wording. FIX: Replace "execute the plan" with explicit separate-run routing.');
  });

  test('execute.md completion routes to /gsdd-verify or /gsdd-progress', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'execute.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    const hasVerify = /\/gsdd-verify/.test(section);
    const hasProgress = /\/gsdd-progress/.test(section);
    assert.ok(hasVerify || hasProgress,
      'execute completion must route to /gsdd-verify or /gsdd-progress. FIX: Add next-step routing to execute completion.');
  });

  test('verify.md completion routes to /gsdd-progress or /gsdd-plan', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'verify.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    const hasProgress = /\/gsdd-progress/.test(section);
    const hasPlan = /\/gsdd-plan/.test(section);
    assert.ok(hasProgress || hasPlan,
      'verify completion must route to /gsdd-progress or /gsdd-plan. FIX: Add next-step routing to verify completion.');
  });

  // Persistence enforcement gates
  test('execute.md has MANDATORY persistence gate for SUMMARY.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'execute.md'), 'utf-8');
    assert.match(content, /MANDATORY.*SUMMARY\.md.*disk/s,
      'execute.md must have MANDATORY persistence gate for SUMMARY.md. FIX: Add MANDATORY write enforcement in <state_updates>.');
  });

  test('verify.md has <persistence> section for VERIFICATION.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'verify.md'), 'utf-8');
    assert.match(content, /<persistence>/,
      'verify.md must have a <persistence> section. FIX: Add <persistence> section for VERIFICATION.md write enforcement.');
    const section = content.slice(content.indexOf('<persistence>'), content.indexOf('</persistence>'));
    assert.match(section, /MANDATORY/,
      'verify.md <persistence> must contain MANDATORY language. FIX: Add MANDATORY enforcement to <persistence>.');
    assert.match(section, /VERIFICATION\.md/,
      'verify.md <persistence> must reference VERIFICATION.md. FIX: Add VERIFICATION.md path to <persistence>.');
  });

  // Positional discipline gates in new-project.md
  test('new-project.md has STOP gate after questioning', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-project.md'), 'utf-8');
    const questionEnd = content.indexOf('</questioning>');
    // Find the <research> tag that appears AFTER </questioning> (not the one in early description text)
    const researchStart = content.indexOf('\n<research>', questionEnd);
    if (questionEnd === -1 || researchStart === -1) return;
    const between = content.slice(questionEnd, researchStart);
    assert.match(between, /STOP/,
      'new-project.md must have STOP gate between </questioning> and <research>. FIX: Add positional STOP gate after questioning.');
    assert.match(between, /Do NOT.*code/i,
      'new-project.md STOP gate must prohibit code writing. FIX: Add "Do NOT write any application code" to STOP gate.');
  });

  test('new-project.md has STOP gate after research', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-project.md'), 'utf-8');
    const researchEnd = content.indexOf('</research>');
    const specStart = content.indexOf('<data_schema_definition>') !== -1
      ? content.indexOf('<data_schema_definition>')
      : content.indexOf('<spec_creation>');
    if (researchEnd === -1 || specStart === -1) return;
    const between = content.slice(researchEnd, specStart);
    assert.match(between, /STOP/,
      'new-project.md must have STOP gate between </research> and spec creation. FIX: Add positional STOP gate after research.');
    assert.match(between, /Do NOT.*code/i,
      'new-project.md STOP gate must prohibit code writing. FIX: Add "Do NOT write any application code" to STOP gate.');
  });

  // Context clearing hint
  for (const wf of LIFECYCLE_WORKFLOWS) {
    test(`${wf} completion mentions context clearing`, () => {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, wf), 'utf-8');
      const compStart = content.indexOf('<completion>');
      const compEnd = content.indexOf('</completion>');
      if (compStart === -1 || compEnd === -1) return;
      const section = content.slice(compStart, compEnd);
      assert.match(section, /clear.*context|context.*clear/i,
        `${wf} completion must hint at clearing context. FIX: Add "Consider clearing context" to <completion>.`);
    });
  }

  // DESIGN.md entry
  test('DESIGN.md contains D28 entry', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /## 28\./,
      'DESIGN.md must contain section 28. FIX: Add D28 Workflow Completion Routing.');
  });
});

// ---------------------------------------------------------------------------
// G23 - Approach Explorer Quality
// ---------------------------------------------------------------------------
describe('G23 - Approach Explorer Quality', () => {
  const ROLE_PATH = path.join(ROOT, 'agents', 'approach-explorer.md');
  const DELEGATE_PATH = path.join(ROOT, 'distilled', 'templates', 'delegates', 'approach-explorer.md');
  const TEMPLATE_PATH = path.join(ROOT, 'distilled', 'templates', 'approach.md');
  const WORKFLOW_PATH = path.join(ROOT, 'distilled', 'workflows', 'plan.md');
  const PLANNER_PATH = path.join(ROOT, 'agents', 'planner.md');
  const DESIGN_PATH = path.join(ROOT, 'distilled', 'DESIGN.md');

  const roleContent = fs.readFileSync(ROLE_PATH, 'utf-8');
  const delegateContent = fs.readFileSync(DELEGATE_PATH, 'utf-8');
  const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
  const plannerContent = fs.readFileSync(PLANNER_PATH, 'utf-8');

  // G23.1: Role uses XML semantic structure
  test('approach-explorer role uses XML semantic tags', () => {
    const requiredTags = ['<role>', '<algorithm>', '<examples>', '<anti_patterns>', '<quality_guarantees>'];
    for (const tag of requiredTags) {
      assert.ok(roleContent.includes(tag),
        `approach-explorer.md missing ${tag}. FIX: Add ${tag} section to role contract.`);
    }
  });

  // G23.2: At least 2 conversation examples
  test('approach-explorer role has at least 2 example blocks', () => {
    const exampleBlocks = (roleContent.match(/<example[\s>]/g) || []).length;
    assert.ok(exampleBlocks >= 3,
      `approach-explorer.md has ${exampleBlocks} <example> blocks (need >= 3). FIX: Add conversation flow examples per Anthropic 3-5 recommendation.`);
  });

  // G23.3: Self-check quality gate exists in algorithm
  test('approach-explorer role has self-check quality gate', () => {
    assert.match(roleContent, /self.check|quality.gate/i,
      'approach-explorer.md must have a self-check quality gate. FIX: Add quality gate step before writing APPROACH.md.');
  });

  // G23.4: Taste/technical classification exists
  test('approach-explorer role has taste/technical classification', () => {
    assert.match(roleContent, /taste/i,
      'approach-explorer.md must classify gray areas as taste/technical. FIX: Add gray area classification.');
    assert.match(roleContent, /technical/i,
      'approach-explorer.md must classify gray areas as taste/technical. FIX: Add gray area classification.');
  });

  test('approach-explorer surfaces require explicit alignment proof under workflow.discuss', () => {
    for (const [label, content] of [
      ['role', roleContent],
      ['delegate', delegateContent],
      ['template', fs.readFileSync(TEMPLATE_PATH, 'utf-8')],
    ]) {
      assert.match(content, /workflow\.discuss/i,
        `${label} must mention workflow.discuss for alignment proof gating.`);
      assert.match(content, /alignment_status/i,
        `${label} must require alignment_status in APPROACH.md.`);
      assert.match(content, /user_confirmed/i,
        `${label} must require user_confirmed proof state.`);
      assert.match(content, /approved_skip/i,
        `${label} must require approved_skip proof state.`);
    }
  });

  test('approach-explorer rejects agent-only no-questions-needed proof', () => {
    const combined = [roleContent, delegateContent, fs.readFileSync(TEMPLATE_PATH, 'utf-8')].join('\n');
    assert.match(combined, /No questions needed/i,
      'approach surfaces must name the no-questions-needed bypass explicitly.');
    assert.match(combined, /Agent's Discretion[\s\S]{0,160}not (?:valid )?alignment proof|not (?:valid )?proof[\s\S]{0,160}Agent's Discretion/i,
      'approach surfaces must say Agent\'s Discretion is not alignment proof.');
  });

  // G23.5: No fixed question count prescription (e.g., "ask exactly 4 questions")
  test('approach-explorer role does not prescribe fixed question count', () => {
    assert.doesNotMatch(roleContent, /\bask (exactly )?\d+ questions?\b/i,
      'approach-explorer.md must NOT prescribe a fixed question count. FIX: Use adaptive convergence instead of fixed count.');
  });

  // G23.6: Vendor-neutral — no "Claude" in role contract
  test('approach-explorer role is vendor-neutral', () => {
    // Allow "Claude" only inside comments or vendor hints at the bottom
    const beforeVendorHints = roleContent.split(/## Vendor Hints/)[0];
    assert.doesNotMatch(beforeVendorHints, /\bClaude\b/,
      'approach-explorer.md must be vendor-neutral (no "Claude" before Vendor Hints). FIX: Replace with vendor-agnostic language.');
  });

  // G23.7: No "Claude's Discretion" anywhere outside _archive
  test('no "Claude\'s Discretion" outside _archive', () => {
    const filesToCheck = [ROLE_PATH, DELEGATE_PATH, TEMPLATE_PATH, WORKFLOW_PATH, PLANNER_PATH];
    for (const fp of filesToCheck) {
      const content = fs.readFileSync(fp, 'utf-8');
      assert.doesNotMatch(content, /Claude's Discretion/,
        `${path.basename(fp)} contains "Claude's Discretion". FIX: Replace with "Agent's Discretion".`);
    }
  });

  // G23.8: Delegate is thin (< 40 non-empty lines)
  test('approach-explorer delegate is under 40 non-empty lines', () => {
    const nonEmpty = delegateContent.split('\n').filter(l => /\S/.test(l)).length;
    assert.ok(nonEmpty < 40,
      `approach-explorer delegate has ${nonEmpty} non-empty lines (max 39). FIX: Move content to role contract.`);
  });

  // G23.9: Plan workflow has hybrid architecture description
  test('plan workflow describes hybrid approach exploration', () => {
    assert.match(workflowContent, /research.*subagent|subagent.*research/i,
      'plan.md must describe research subagent pattern. FIX: Add research subagent description to <approach_exploration>.');
  });

  // G23.10: Planner uses "Agent's Discretion"
  test('planner uses Agent\'s Discretion not Claude\'s Discretion', () => {
    assert.match(plannerContent, /Agent's Discretion/,
      'planner.md must use "Agent\'s Discretion". FIX: Replace "Claude\'s Discretion" with "Agent\'s Discretion".');
  });

  // G23.11: DESIGN.md has D29 entry
  test('DESIGN.md contains D29 entry', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    assert.match(content, /## 29\./,
      'DESIGN.md must contain section 29. FIX: Add D29 Approach Exploration.');
  });

  // G23.12: Claude adapter approach-explorer has interactive tool
  test('Claude adapter approach-explorer includes AskUserQuestion', () => {
    const adapterPath = path.join(ROOT, 'bin', 'adapters', 'claude.mjs');
    const adapterContent = fs.readFileSync(adapterPath, 'utf-8');
    // Find the renderClaudeApproachExplorer function and check its tools line
    const explorerFn = adapterContent.slice(
      adapterContent.indexOf('renderClaudeApproachExplorer'),
      adapterContent.indexOf('renderClaudePlanChecker')
    );
    assert.match(explorerFn, /AskUserQuestion/,
      'Claude adapter approach-explorer must include AskUserQuestion tool. FIX: Add AskUserQuestion to tools list.');
  });
});

describe('G24 - Hardening Propagation', () => {
  const WORKFLOWS_DIR = path.join(ROOT, 'distilled', 'workflows');
  const PLAN_CHECKER_PATH = path.join(ROOT, 'distilled', 'templates', 'delegates', 'plan-checker.md');

  // --- quick.md (H1, H2, H6) ---

  test('quick.md has STOP persistence gate for SUMMARY.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    assert.match(content, /STOP.*SUMMARY.*disk|STOP.*SUMMARY.*exist/s,
      'quick.md must have STOP persistence gate for SUMMARY.md after executor delegate. FIX: Add STOP write enforcement after Step 4.');
  });

  test('quick.md has STOP persistence gate for VERIFICATION.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    assert.match(content, /STOP.*VERIFICATION.*disk|STOP.*VERIFICATION.*exist/s,
      'quick.md must have STOP persistence gate for VERIFICATION.md after verifier delegate. FIX: Add STOP write enforcement after Step 5.');
  });

  test('quick.md has STOP gate between plan and execute', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const planDelegateEnd = content.indexOf('</delegate>', content.indexOf('## Step 3'));
    const executeStep = content.indexOf('## Step 4');
    assert.ok(planDelegateEnd > -1 && executeStep > -1,
      'quick.md must have Step 3 (plan) and Step 4 (execute). FIX: Check workflow structure.');
    const between = content.slice(planDelegateEnd, executeStep);
    assert.match(between, /\bSTOP\b/,
      'quick.md must have STOP gate between plan delegate and execute step. FIX: Add positional STOP gate after Step 3 plan delegate.');
  });

  test('quick.md has reduced_assurance plan self-check', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    assert.match(content, /reduced_assurance/,
      'quick.md must label self-check as reduced_assurance. FIX: Add reduced_assurance plan self-check after STOP gate.');
  });

  // --- quick.md D32: Alignment Hardening (plan preview, scope signal, conditional plan-checker) ---

  test('quick.md has plan preview gate between plan and execute', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const planStep = content.indexOf('## Step 3:');
    const executeStep = content.indexOf('## Step 4:');
    assert.ok(planStep > -1 && executeStep > -1,
      'quick.md must have Step 3 (plan) and Step 4 (execute). FIX: Check workflow structure.');
    const between = content.slice(planStep, executeStep);
    assert.match(between, /[Pp]lan [Pp]review/,
      'quick.md must have plan preview gate between plan and execute steps (D32). FIX: Add Step 3.7 plan preview section.');
  });

  test('quick.md plan preview shows task count and files', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    assert.match(content, /[Tt]asks:.*\{count\}|[Tt]ask count/,
      'quick.md plan preview must display task count. FIX: Add task count to plan preview output.');
    assert.match(content, /[Ff]iles.*\{file|[Ff]iles to.*touch|[Ff]ile.*list/i,
      'quick.md plan preview must display files to be modified. FIX: Add file list to plan preview output.');
  });

  test('quick.md plan preview has default-yes confirmation', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    assert.match(content, /Enter.*proceed|default.*yes|press.*Enter/i,
      'quick.md plan preview must have default-yes (Enter to proceed) confirmation (D32). FIX: Add default-yes prompt to plan preview.');
  });

  test('quick.md preview edit branch cleans up provisional task directory', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const previewStart = content.indexOf('## Step 3.7');
    assert.ok(previewStart > -1,
      'quick.md must have ## Step 3.7 plan preview section. FIX: Add Step 3.7 plan preview.');
    const previewSection = content.slice(previewStart, previewStart + 2200);
    assert.match(previewSection, /edit description.*clean up the task directory/i,
      'quick.md must clean up the provisional quick-task directory before returning to Step 1 from the plan preview. FIX: Add cleanup to the "edit description" branch.');
  });

  test('quick.md preview /gsdd-plan branch cleans up provisional task directory', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const previewStart = content.indexOf('## Step 3.7');
    assert.ok(previewStart > -1,
      'quick.md must have ## Step 3.7 plan preview section. FIX: Add Step 3.7 plan preview.');
    const previewSection = content.slice(previewStart, previewStart + 2200);
    assert.match(previewSection, /switch to \/gsdd-plan.*clean up the task directory/i,
      'quick.md must clean up the provisional quick-task directory before switching to /gsdd-plan from the plan preview. FIX: Add cleanup to the "switch to /gsdd-plan" branch.');
  });

  test('quick.md has scope signal evaluation', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    assert.match(content, /[Ss]cope [Ss]ignal/,
      'quick.md must have scope signal evaluation section (D32). FIX: Add Step 3.6 scope signal evaluation.');
    assert.match(content, /8.*files|>8|architecture.*keyword/i,
      'quick.md scope signal must check file count or architecture keywords. FIX: Add scope heuristics (file count >8, architecture keywords).');
  });

  test('quick.md scope signal recommends /gsdd-plan for escalation', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    // Find the actual ## Step 3.6 heading (not anti_patterns mention of Step 3.6)
    const scopeStart = content.indexOf('## Step 3.6');
    assert.ok(scopeStart > -1,
      'quick.md must have ## Step 3.6 scope signal section. FIX: Add Step 3.6 scope signal evaluation.');
    const afterScope = content.slice(scopeStart, scopeStart + 1500);
    assert.match(afterScope, /gsdd-plan/,
      'quick.md scope signal must recommend /gsdd-plan for escalation (D32). FIX: Add /gsdd-plan recommendation in scope signal.');
  });

  test('quick.md has conditional plan-checker referencing plan-checker.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    assert.match(content, /workflow\.planCheck|planCheck/,
      'quick.md must reference workflow.planCheck config toggle (D32). FIX: Add conditional plan-checker gated on workflow.planCheck.');
    assert.match(content, /plan-checker\.md/,
      'quick.md must reference plan-checker.md delegate for independent check (D32). FIX: Add delegate block referencing plan-checker.md.');
  });

  test('quick.md plan-checker uses max 1 revision cycle', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    assert.match(content, /1 revision cycle|[Mm]aximum 1|[Mm]ax 1/,
      'quick.md plan-checker must use max 1 revision cycle for quick scope (D32). FIX: Limit plan-checker to 1 revision cycle.');
  });

  test('quick.md Step 4 requires plan preview completion', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const step4Start = content.indexOf('## Step 4');
    assert.ok(step4Start > -1, 'quick.md must have Step 4.');
    const step4Section = content.slice(step4Start, step4Start + 500);
    assert.match(step4Section, /preview|confirm|Step 3\.7/i,
      'quick.md Step 4 must reference plan preview or confirmation as prerequisite (D32). FIX: Add guard text at Step 4 referencing plan preview.');
  });

  // --- quick.md D33: Approach Clarification (conditional pre-plan interview) ---

  test('quick.md has approach clarification step between Step 2 and Step 3', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const step2 = content.indexOf('## Step 2:');
    const step3 = content.indexOf('## Step 3:');
    assert.ok(step2 > -1 && step3 > -1,
      'quick.md must have Step 2 and Step 3. FIX: Check workflow structure.');
    const between = content.slice(step2, step3);
    assert.match(between, /Step 2\.5|[Aa]pproach [Cc]larification/,
      'quick.md must have approach clarification step between Step 2 and Step 3 (D33). FIX: Add Step 2.5 approach clarification.');
  });

  test('quick.md approach clarification gates on workflow.discuss', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const step25Start = content.indexOf('Step 2.5');
    assert.ok(step25Start > -1,
      'quick.md must have Step 2.5. FIX: Add Step 2.5 approach clarification.');
    const step25Section = content.slice(step25Start, step25Start + 2000);
    assert.match(step25Section, /workflow\.discuss/,
      'quick.md approach clarification must gate on workflow.discuss config toggle (D33). FIX: Add workflow.discuss check to Step 2.5.');
  });

  test('quick.md approach clarification has ambiguity signals', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const step25Start = content.indexOf('Step 2.5');
    assert.ok(step25Start > -1, 'quick.md must have Step 2.5.');
    const step25Section = content.slice(step25Start, step25Start + 2000);
    assert.match(step25Section, /[Aa]mbiguity|[Dd]estructive|[Vv]ague scope|[Mm]ultiple valid/i,
      'quick.md approach clarification must have ambiguity signal detection (D33). FIX: Add ambiguity signals table to Step 2.5.');
  });

  test('quick.md approach clarification uses recommendation-first questions', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const step25Start = content.indexOf('Step 2.5');
    assert.ok(step25Start > -1, 'quick.md must have Step 2.5.');
    const step25Section = content.slice(step25Start, step25Start + 2000);
    assert.match(step25Section, /recommend|I'd approach|proceed.*prefer/i,
      'quick.md approach clarification must use recommendation-first question format (D33). FIX: Add recommendation-first question template.');
  });

  test('quick.md planner receives approach context', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const step3Start = content.indexOf('## Step 3:');
    const step35Start = content.indexOf('## Step 3.5:');
    assert.ok(step3Start > -1 && step35Start > -1,
      'quick.md must have Step 3 and Step 3.5.');
    const plannerSection = content.slice(step3Start, step35Start);
    assert.match(plannerSection, /\$APPROACH_CONTEXT|[Aa]pproach.*context/i,
      'quick.md Step 3 planner delegate must receive approach context from Step 2.5 (D33). FIX: Add $APPROACH_CONTEXT to planner context.');
  });

  test('quick.md planner receives codebase context when codebase maps exist', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const step2Start = content.indexOf('## Step 2:');
    const step25Start = content.indexOf('## Step 2.5:');
    assert.ok(step2Start > -1 && step25Start > -1, 'quick.md must have Step 2 and Step 2.5.');
    const step2Section = content.slice(step2Start, step25Start);
    assert.match(step2Section, /\.planning\/codebase\/.*ARCHITECTURE\.md|ARCHITECTURE\.md/,
      'quick.md must read ARCHITECTURE.md when codebase maps exist. FIX: Add codebase-context read in Step 2.');
    assert.match(step2Section, /\.planning\/codebase\/.*STACK\.md|STACK\.md/,
      'quick.md must read STACK.md when codebase maps exist. FIX: Add codebase-context read in Step 2.');
    assert.match(step2Section, /\.planning\/codebase\/.*CONVENTIONS\.md|CONVENTIONS\.md/,
      'quick.md must read CONVENTIONS.md when codebase maps exist. FIX: Add conventions context in Step 2.');
    assert.match(step2Section, /\.planning\/codebase\/.*CONCERNS\.md|CONCERNS\.md/,
      'quick.md must read CONCERNS.md when codebase maps exist. FIX: Add concerns context in Step 2.');
    assert.match(step2Section, /whichever.*are present|available docs|missing docs/i,
      'quick.md Step 2 must handle partial codebase-map state gracefully. FIX: Read whichever codebase docs exist and note missing ones.');
    assert.match(step2Section, /safest surfaces to touch|risky zones to avoid|re-verified after change/i,
      'quick.md Step 2 must summarize actionable brownfield guidance, not only architecture/stack facts. FIX: Add safe/risky/re-verify guidance to $CODEBASE_CONTEXT.');
    const step3Start = content.indexOf('## Step 3:');
    const step35Start = content.indexOf('## Step 3.5:');
    assert.ok(step3Start > -1 && step35Start > -1,
      'quick.md must have Step 3 and Step 3.5.');
    const plannerSection = content.slice(step3Start, step35Start);
    assert.match(plannerSection, /\$CODEBASE_CONTEXT|[Cc]odebase context/i,
      'quick.md Step 3 planner delegate must receive $CODEBASE_CONTEXT. FIX: Pass codebase context to planner delegate.');
  });

  test('quick.md builds an inline brownfield baseline when codebase maps are missing', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const step2Start = content.indexOf('## Step 2:');
    const step25Start = content.indexOf('## Step 2.5:');
    assert.ok(step2Start > -1 && step25Start > -1, 'quick.md must have Step 2 and Step 2.5.');
    const step2Section = content.slice(step2Start, step25Start);
    assert.match(step2Section, /If `?\.planning\/codebase\/`? does not exist.*inline brownfield baseline/is,
      'quick.md must build an inline brownfield baseline when no codebase maps exist. FIX: Add provisional baseline logic to Step 2.');
    assert.match(step2Section, /README\.md|package\.json|pyproject\.toml|Cargo\.toml/i,
      'quick.md inline baseline must inspect stable repo-root guidance such as README or manifests. FIX: Add root-surface reads for the inline baseline.');
    assert.match(step2Section, /provisional baseline|calling out unknowns/i,
      'quick.md inline baseline must mark its uncertainty explicitly. FIX: Label the baseline as provisional and note unknowns.');
  });

  test('quick.md scope signal can escalate to /gsdd-map-codebase when orientation is too weak', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const scopeStart = content.indexOf('## Step 3.6:');
    const previewStart = content.indexOf('## Step 3.7:');
    assert.ok(scopeStart > -1 && previewStart > -1, 'quick.md must have Step 3.6 and Step 3.7.');
    const scopeSection = content.slice(scopeStart, previewStart);
    const previewSection = content.slice(previewStart, content.indexOf('## Step 4:'));
    assert.match(scopeSection, /Orientation gap/i,
      'quick.md scope signal must include an orientation-gap heuristic. FIX: Add orientation-gap escalation to Step 3.6.');
    assert.match(scopeSection, /\/gsdd-map-codebase/i,
      'quick.md orientation-gap heuristic must recommend /gsdd-map-codebase. FIX: Add map-codebase recommendation to Step 3.6.');
    assert.match(previewSection, /contains.*\/gsdd-map-codebase.*switch to \/gsdd-map-codebase/s,
      'quick.md plan preview must offer a /gsdd-map-codebase switch when the scope warning calls for deeper orientation. FIX: Add preview routing for /gsdd-map-codebase.');
    assert.match(previewSection, /switch to \/gsdd-map-codebase.*clean up the task directory/i,
      'quick.md must clean up the provisional quick-task directory before switching to /gsdd-map-codebase. FIX: Add cleanup to the map-codebase branch.');
  });

  test('quick.md approach clarification limits to max 2 questions', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    const step25Start = content.indexOf('Step 2.5');
    assert.ok(step25Start > -1, 'quick.md must have Step 2.5.');
    const step25Section = content.slice(step25Start, step25Start + 2000);
    assert.match(step25Section, /[Mm]aximum 2|[Mm]ax 2|2 questions/,
      'quick.md approach clarification must limit to max 2 questions (D33). FIX: Add maximum 2 questions constraint.');
  });

  // --- map-codebase.md (H3, H4) ---

  test('map-codebase.md validation checks file path references', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'map-codebase.md'), 'utf-8');
    const validationStart = content.indexOf('<validation>');
    const validationEnd = content.indexOf('</validation>');
    assert.ok(validationStart > -1 && validationEnd > -1,
      'map-codebase.md must have <validation> section. FIX: Add validation section.');
    const section = content.slice(validationStart, validationEnd);
    assert.match(section, /backtick|file path ref/i,
      'map-codebase.md validation must check for backtick-formatted file path references. FIX: Add file path substantiveness check.');
  });

  test('map-codebase.md validation checks minimum substantiveness', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'map-codebase.md'), 'utf-8');
    const validationStart = content.indexOf('<validation>');
    const validationEnd = content.indexOf('</validation>');
    assert.ok(validationStart > -1 && validationEnd > -1,
      'map-codebase.md must have <validation> section. FIX: Add validation section.');
    const section = content.slice(validationStart, validationEnd);
    assert.match(section, /20 non-empty lines|minimum.*lines|exceeds.*\d+.*lines/i,
      'map-codebase.md validation must check for minimum document substantiveness. FIX: Add minimum content requirement (e.g., 20 non-empty lines).');
  });

  test('map-codebase.md has MANDATORY persistence gate before secrets_scan', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'map-codebase.md'), 'utf-8');
    const validationEnd = content.indexOf('</validation>');
    const secretsScan = content.indexOf('<secrets_scan>');
    assert.ok(validationEnd > -1 && secretsScan > -1,
      'map-codebase.md must have </validation> and <secrets_scan>. FIX: Check workflow structure.');
    const between = content.slice(validationEnd, secretsScan);
    assert.match(between, /MANDATORY/,
      'map-codebase.md must have MANDATORY persistence gate between validation and secrets_scan. FIX: Add MANDATORY gate requiring all 4 codebase documents exist on disk.');
  });

  test('map-codebase.md completion offers /gsdd-quick as a brownfield next step', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'map-codebase.md'), 'utf-8');
    const completionStart = content.indexOf('<completion>');
    const completionEnd = content.indexOf('</completion>');
    assert.ok(completionStart > -1 && completionEnd > -1,
      'map-codebase.md must have <completion> section. FIX: Add completion section.');
    const section = content.slice(completionStart, completionEnd);
    assert.match(section, /\/gsdd-quick/,
      'map-codebase completion must offer /gsdd-quick as a brownfield next step. FIX: Add quick-routing to completion.');
    assert.match(section, /brownfield/i,
      'map-codebase completion must describe the quick path as brownfield feature work. FIX: Label /gsdd-quick as brownfield feature work.');
    assert.match(section, /full lifecycle setup|project initialization/i,
      'map-codebase completion must preserve /gsdd-new-project as the full initializer. FIX: Keep the stronger brownfield route explicit.');
    assert.match(section, /Safest next change lane/i,
      'map-codebase completion must synthesize a safest-next-change lane from the 4 docs. FIX: Add routing summary guidance.');
    assert.match(section, /Highest-risk zones/i,
      'map-codebase completion must surface highest-risk zones from the 4 docs. FIX: Add risk summary guidance.');
    assert.match(section, /Do NOT create a fifth persistent artifact/i,
      'map-codebase completion must keep the routing summary ephemeral. FIX: Explicitly forbid creating a fifth map artifact.');
    assert.match(section, /intentionally want to widen|only when the user intentionally wants to widen/i,
      'map-codebase completion must keep /gsdd-new-project as an explicit widen path, not a default fallback. FIX: Add widen-only wording to the completion guidance.');
  });

  // --- new-project.md (H5, H9) ---

  test('new-project.md has <persistence> section referencing SPEC.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-project.md'), 'utf-8');
    assert.match(content, /<persistence>/,
      'new-project.md must have a <persistence> section. FIX: Add <persistence> section before <success_criteria>.');
    const persistenceStart = content.indexOf('<persistence>');
    const persistenceEnd = content.indexOf('</persistence>');
    const section = content.slice(persistenceStart, persistenceEnd);
    assert.match(section, /SPEC\.md/,
      'new-project.md <persistence> must reference SPEC.md. FIX: Add MANDATORY check for SPEC.md on disk.');
  });

  test('new-project.md <persistence> section references ROADMAP.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-project.md'), 'utf-8');
    const persistenceStart = content.indexOf('<persistence>');
    const persistenceEnd = content.indexOf('</persistence>');
    if (persistenceStart === -1 || persistenceEnd === -1) return; // caught by previous test
    const section = content.slice(persistenceStart, persistenceEnd);
    assert.match(section, /ROADMAP\.md/,
      'new-project.md <persistence> must reference ROADMAP.md. FIX: Add MANDATORY check for ROADMAP.md on disk.');
  });

  test('new-project.md has STOP gate between spec approval and roadmap creation', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-project.md'), 'utf-8');
    const specCreationEnd = content.indexOf('</spec_creation>');
    assert.ok(specCreationEnd > -1,
      'new-project.md must have </spec_creation>. FIX: Check workflow structure.');
    // Search for <roadmap_creation> AFTER </spec_creation> to skip inline references
    const roadmapCreation = content.indexOf('<roadmap_creation>', specCreationEnd);
    assert.ok(roadmapCreation > -1,
      'new-project.md must have <roadmap_creation> after </spec_creation>. FIX: Check workflow structure.');
    const between = content.slice(specCreationEnd, roadmapCreation);
    assert.match(between, /\bSTOP\b/,
      'new-project.md must have STOP gate between spec creation and roadmap creation. FIX: Add positional STOP verifying SPEC.md on disk before creating ROADMAP.md.');
  });

  test('new-project.md treats existing CHANGE.md continuity as an explicit widen path', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-project.md'), 'utf-8');
    assert.match(content, /Concrete brownfield continuity already exists/i,
      'new-project.md must recognize existing brownfield continuity. FIX: Add the explicit brownfield continuity detect_mode note.');
    assert.match(content, /explicit widen path|intentionally want to widen/i,
      'new-project.md must keep /gsdd-new-project as an explicit widen path when CHANGE.md exists. FIX: Add widen-only wording for concrete brownfield continuity.');
  });

  // --- audit-milestone.md (H7) ---

  test('audit-milestone.md has MANDATORY persistence gate for MILESTONE-AUDIT.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'audit-milestone.md'), 'utf-8');
    assert.match(content, /MANDATORY.*MILESTONE-AUDIT|MANDATORY.*milestone.*audit.*disk/si,
      'audit-milestone.md must have MANDATORY persistence gate for MILESTONE-AUDIT.md. FIX: Add MANDATORY write enforcement after Step 6.');
  });

  // --- pause.md (H8) ---

  test('pause.md has MANDATORY persistence gate for .continue-here.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'pause.md'), 'utf-8');
    assert.match(content, /MANDATORY.*\.continue-here\.md|MANDATORY.*checkpoint.*disk/si,
      'pause.md must have MANDATORY persistence gate for .continue-here.md. FIX: Add MANDATORY write enforcement after </write_checkpoint>.');
  });

  // --- plan-checker.md (D31) ---

  test('plan-checker has goal_achievement dimension', () => {
    const content = fs.readFileSync(PLAN_CHECKER_PATH, 'utf-8');
    assert.match(content, /goal_achievement/,
      'plan-checker.md must include goal_achievement dimension. FIX: Add 8th dimension for outcome-level verification.');
  });

  test('plan-checker has goal_addressed sub-check', () => {
    const content = fs.readFileSync(PLAN_CHECKER_PATH, 'utf-8');
    assert.match(content, /[Gg]oal addressed/,
      'plan-checker.md goal_achievement must include goal_addressed check. FIX: Add goal_addressed sub-check.');
  });

  test('plan-checker has success criteria reachable sub-check', () => {
    const content = fs.readFileSync(PLAN_CHECKER_PATH, 'utf-8');
    assert.match(content, /[Ss]uccess criteria.*reachable|[Ss]uccess.*criteria.*traceable/i,
      'plan-checker.md goal_achievement must include success criteria reachable check. FIX: Add success criteria traceability check.');
  });

  test('plan.md dimension list includes goal_achievement', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'plan.md'), 'utf-8');
    assert.match(content, /goal_achievement/,
      'plan.md checker dimension list must include goal_achievement. FIX: Add goal_achievement dimension to "What The Checker Verifies" section and JSON schema hint.');
  });

  test('plan-constants.mjs includes goal_achievement in PLAN_CHECK_DIMENSIONS', () => {
    const content = fs.readFileSync(path.join(ROOT, 'bin', 'lib', 'plan-constants.mjs'), 'utf-8');
    assert.match(content, /goal_achievement/,
      'plan-constants.mjs must include goal_achievement in PLAN_CHECK_DIMENSIONS. FIX: Add goal_achievement to the PLAN_CHECK_DIMENSIONS array.');
  });

  test('claude adapter imports from plan-constants and interpolates dimensions', () => {
    const content = fs.readFileSync(path.join(ROOT, 'bin', 'adapters', 'claude.mjs'), 'utf-8');
    assert.match(content, /plan-constants\.mjs/,
      'claude.mjs must import from plan-constants.mjs. FIX: Add import of PLAN_CHECK_DIMENSIONS from plan-constants.mjs.');
    assert.match(content, /PLAN_CHECK_DIMENSIONS\.join/,
      'claude.mjs must interpolate PLAN_CHECK_DIMENSIONS via .join(). FIX: Replace hardcoded dimension string with PLAN_CHECK_DIMENSIONS.join() interpolation.');
  });

  test('opencode adapter imports from plan-constants and interpolates dimensions', () => {
    const content = fs.readFileSync(path.join(ROOT, 'bin', 'adapters', 'opencode.mjs'), 'utf-8');
    assert.match(content, /plan-constants\.mjs/,
      'opencode.mjs must import from plan-constants.mjs. FIX: Add import of PLAN_CHECK_DIMENSIONS from plan-constants.mjs.');
    assert.match(content, /PLAN_CHECK_DIMENSIONS\.join/,
      'opencode.mjs must interpolate PLAN_CHECK_DIMENSIONS via .join(). FIX: Replace hardcoded dimension string with PLAN_CHECK_DIMENSIONS.join() interpolation.');
  });
});

// ---------------------------------------------------------------------------
// G26 - Context Engineering: Quick Workflow (D34)
// ---------------------------------------------------------------------------

describe('G26 - Context Engineering: Quick Workflow', () => {
  const QUICK_PATH = path.join(ROOT, 'distilled', 'workflows', 'quick.md');

  test('quick.md has <anti_patterns> section', () => {
    const content = fs.readFileSync(QUICK_PATH, 'utf-8');
    assert.match(content, /<anti_patterns>/,
      'quick.md must have <anti_patterns> section (D34). FIX: Add <anti_patterns> after <role>.');
  });

  test('quick.md anti_patterns placed after role and before process', () => {
    const content = fs.readFileSync(QUICK_PATH, 'utf-8');
    const roleEnd = content.indexOf('</role>');
    const antiStart = content.indexOf('<anti_patterns>');
    const processStart = content.indexOf('<process>');
    assert.ok(roleEnd > -1 && antiStart > -1 && processStart > -1,
      'quick.md must have </role>, <anti_patterns>, and <process>.');
    assert.ok(antiStart > roleEnd,
      'quick.md <anti_patterns> must be placed after </role> (D34). FIX: Move <anti_patterns> after </role>.');
    assert.ok(antiStart < processStart,
      'quick.md <anti_patterns> must be before <process> (D34). FIX: Place <anti_patterns> between </role> and <process>.');
  });

  test('quick.md anti_patterns mentions plan preview gate', () => {
    const content = fs.readFileSync(QUICK_PATH, 'utf-8');
    const apStart = content.indexOf('<anti_patterns>');
    const apEnd = content.indexOf('</anti_patterns>');
    const section = content.slice(apStart, apEnd);
    assert.match(section, /plan preview|Step 3\.7/i,
      'quick.md anti_patterns must mention plan preview gate (D34). FIX: Add plan preview anti-pattern.');
  });

  test('quick.md anti_patterns mentions file verification', () => {
    const content = fs.readFileSync(QUICK_PATH, 'utf-8');
    const apStart = content.indexOf('<anti_patterns>');
    const apEnd = content.indexOf('</anti_patterns>');
    const section = content.slice(apStart, apEnd);
    assert.match(section, /file.*exist|disk|verification gate/i,
      'quick.md anti_patterns must mention file verification gates (D34). FIX: Add file verification anti-pattern.');
  });

  test('quick.md uses consistent gate language (no MANDATORY in process)', () => {
    const content = fs.readFileSync(QUICK_PATH, 'utf-8');
    const processStart = content.indexOf('<process>');
    const processEnd = content.indexOf('</process>');
    const processContent = content.slice(processStart, processEnd);
    assert.doesNotMatch(processContent, /\*\*MANDATORY/,
      'quick.md process gates must use STOP, not MANDATORY (D34). FIX: Normalize MANDATORY to STOP in process gates.');
  });

  test('quick.md structural sections use XML tags', () => {
    const content = fs.readFileSync(QUICK_PATH, 'utf-8');
    for (const tag of ['role', 'anti_patterns', 'prerequisites', 'process', 'success_criteria', 'completion']) {
      assert.match(content, new RegExp(`<${tag}>`),
        `quick.md must have <${tag}> XML section (D34). FIX: Add <${tag}> section.`);
    }
  });

  test('quick.md uses split escalation for undefined scope vs too many grey areas', () => {
    const content = fs.readFileSync(QUICK_PATH, 'utf-8');
    assert.match(content, /bounded change is still undefined.*\/gsdd-new-project/s,
      'quick.md must route undefined bounded changes to /gsdd-new-project. FIX: Keep the undefined-scope escalation explicit.');
    assert.match(content, /3\+ grey areas.*\/gsdd-plan/s,
      'quick.md must route defined-but-too-ambiguous tasks to /gsdd-plan. FIX: Keep the complexity escalation explicit.');
    assert.match(content, /intentional widen path|not the default fallback/i,
      'quick.md must treat /gsdd-new-project as a widen-only move when CHANGE.md already defines a bounded lane. FIX: Add the widen-only brownfield note.');
  });

  test('quick.md plan preview offers the correct switch route for undefined bounded changes', () => {
    const content = fs.readFileSync(QUICK_PATH, 'utf-8');
    const previewStart = content.indexOf('## Step 3.7');
    assert.ok(previewStart > -1, 'quick.md must have ## Step 3.7 plan preview section.');
    const previewSection = content.slice(previewStart, previewStart + 2600);
    assert.match(previewSection, /contains.*\/gsdd-new-project.*switch to \/gsdd-new-project/s,
      'quick.md plan preview must surface a /gsdd-new-project switch option when the scope warning says the bounded change is undefined. FIX: Split preview routing by warning type.');
    assert.match(previewSection, /switch to \/gsdd-new-project.*clean up the task directory/i,
      'quick.md must clean up the provisional quick-task directory before switching to /gsdd-new-project from the plan preview. FIX: Add cleanup to the new-project branch.');
  });
});

describe('G27 - Workflow Mutability Classification', () => {
  test('artifact-writing workflows are emitted as Code/edit surfaces', async () => {
    const mod = await import(`file://${GSDD_PATH.replace(/\\/g, '/')}`);
    const workflows = mod.createCliContext(ROOT).workflows;
    const mutating = new Map([
      ['gsdd-new-project', 'writes SPEC.md and ROADMAP.md'],
      ['gsdd-map-codebase', 'writes codebase map documents'],
      ['gsdd-plan', 'writes PLAN.md and planning artifacts'],
      ['gsdd-execute', 'writes SUMMARY.md'],
      ['gsdd-verify', 'writes VERIFICATION.md'],
      ['gsdd-audit-milestone', 'writes MILESTONE-AUDIT.md'],
      ['gsdd-quick', 'writes quick-task artifacts'],
      ['gsdd-pause', 'writes .continue-here.md'],
      ['gsdd-resume', 'deletes .continue-here.md before dispatch'],
    ]);

    for (const [name, reason] of mutating) {
      const workflow = workflows.find((entry) => entry.name === name);
      assert.ok(workflow, `${name} must exist in WORKFLOWS. FIX: Keep workflow registry entry.`);
      assert.strictEqual(workflow.mutatesArtifacts, true,
        `${name} must set mutatesArtifacts: true because it ${reason}. FIX: Keep mutability explicit in the workflow registry.`);
      assert.strictEqual(workflow.agent, 'Code',
        `${name} must use agent: Code because it ${reason}. FIX: Mark artifact-writing workflows as Code.`);
      assert.strictEqual(workflow.opencodeType, 'edit',
        `${name} must use opencodeType: edit because it ${reason}. FIX: Mark artifact-writing workflows as edit.`);
    }
  });

  test('progress remains the only read-only workflow classification', async () => {
    const mod = await import(`file://${GSDD_PATH.replace(/\\/g, '/')}`);
    const workflows = mod.createCliContext(ROOT).workflows;
    const readOnly = workflows.filter((workflow) => workflow.mutatesArtifacts === false);

    assert.deepStrictEqual(readOnly.map((workflow) => workflow.name), ['gsdd-progress'],
      'Only gsdd-progress should remain read-only. FIX: Do not classify artifact-writing workflows as read-only.');
    assert.strictEqual(readOnly[0].agent, 'Plan',
      'gsdd-progress must remain agent: Plan. FIX: Keep read-only status reporting in the Plan lane.');
    assert.strictEqual(readOnly[0].opencodeType, 'plan',
      'gsdd-progress must remain opencodeType: plan. FIX: Keep read-only status reporting in the plan lane.');
  });
});

describe('G28 - Spec Quality Check and Contradiction Detection', () => {
  const planWorkflow = fs.readFileSync(
    path.join(__dirname, '..', 'distilled', 'workflows', 'plan.md'), 'utf-8'
  );
  const planCheckerDelegate = fs.readFileSync(
    path.join(__dirname, '..', 'distilled', 'templates', 'delegates', 'plan-checker.md'), 'utf-8'
  );

  test('plan.md has <spec_quality_check> section', () => {
    assert.match(planWorkflow, /<spec_quality_check>/,
      'plan.md must have <spec_quality_check> section for SC1/SC2. FIX: Add <spec_quality_check> between </research_check> and <goal_backward_planning>.');
  });

  test('plan.md spec_quality_check has Resolved/Open/Ambiguous classification', () => {
    assert.ok(
      planWorkflow.includes('Resolved') && planWorkflow.includes('Open') && planWorkflow.includes('Ambiguous'),
      'plan.md spec_quality_check must classify items as Resolved, Open, or Ambiguous. FIX: Add three-way classification taxonomy to <spec_quality_check>.');
  });

  test('plan.md spec_quality_check has quality gate preventing planning with Open items', () => {
    assert.ok(
      planWorkflow.includes('STOP') && planWorkflow.includes('spec_quality_check'),
      'plan.md must have a STOP gate in spec_quality_check for Open/Ambiguous items. FIX: Add "STOP" quality gate instruction to <spec_quality_check>.');
  });

  test('plan.md context_fidelity has SPEC.md vs APPROACH.md cross-check', () => {
    assert.ok(
      planWorkflow.includes('Cross-check'),
      'plan.md context_fidelity must cross-check SPEC.md vs APPROACH.md deferral conflicts. FIX: Add Cross-check line to <context_fidelity>.');
  });

  test('plan.md has phase_contract_gate requiring roadmap out-of-scope and stop/replan conditions', () => {
    assert.match(planWorkflow, /<phase_contract_gate>/,
      'plan.md must have <phase_contract_gate> section. FIX: Add a gate that validates roadmap phase contract strength before planning.');
    assert.match(planWorkflow, /out-of-scope|anti-goals/i,
      'plan.md phase_contract_gate must require explicit out-of-scope or anti-goals in the roadmap phase contract. FIX: Add out-of-scope requirement to <phase_contract_gate>.');
    assert.match(planWorkflow, /stop\/replan/i,
      'plan.md phase_contract_gate must require explicit stop/replan conditions in the roadmap phase contract. FIX: Add stop/replan requirement to <phase_contract_gate>.');
  });

  test('plan.md anti-drift contract requires boundary and closure fields', () => {
    for (const token of ['non_goals', 'hard_boundaries', 'escalation_triggers', 'approval_gates', 'closure_claim_limit', 'leverage']) {
      assert.match(planWorkflow, new RegExp(token),
        `plan.md must include anti-drift contract field "${token}". FIX: Add ${token} to the plan schema and plan structure.`);
    }
  });

  test('planner role uses the same anti-drift plan schema as plan.md', () => {
    const plannerRole = fs.readFileSync(path.join(ROOT, 'agents', 'planner.md'), 'utf-8');
    for (const token of ['non_goals', 'hard_boundaries', 'escalation_triggers', 'approval_gates', 'anti_regression_targets', 'known_unknowns', 'high_leverage_surfaces', 'second_pass_required', 'closure_claim_limit', 'parallelism_budget', 'leverage']) {
      assert.match(plannerRole, new RegExp(token),
        `planner role must include anti-drift contract field "${token}". FIX: Keep planner.md schema aligned with plan.md.`);
    }
  });

  test('plan-checker status semantics force warnings through issues_found', () => {
    assert.match(planCheckerDelegate, /Use `"status": "passed"` only when `"issues": \[\]`/,
      'plan-checker must reserve passed for an empty issues list. FIX: Make warnings use issues_found.');
    assert.match(planCheckerDelegate, /any blocker or warning exists/i,
      'plan-checker must route warnings through issues_found. FIX: Remove checker-discretion warning handling.');
  });

  test('plan-checker.md context_compliance has must-have coverage sub-check', () => {
    assert.ok(
      planCheckerDelegate.includes('Must-have coverage'),
      'plan-checker.md context_compliance must check that phase must-haves appear in plan tasks. FIX: Add "Must-have coverage?" sub-check to context_compliance.');
  });

  test('plan-checker.md context_compliance has deferred exclusion sub-check', () => {
    assert.ok(
      planCheckerDelegate.includes('Deferred exclusion'),
      'plan-checker.md context_compliance must check that deferred/out-of-scope items are absent from plan tasks. FIX: Add "Deferred exclusion?" sub-check to context_compliance.');
  });

  test('plan-checker.md context_compliance has cross-surface consistency sub-check', () => {
    assert.ok(
      planCheckerDelegate.includes('Cross-surface consistency'),
      'plan-checker.md context_compliance must check for SPEC.md vs APPROACH.md must-have/deferred contradictions. FIX: Add "Cross-surface consistency?" sub-check to context_compliance.');
  });
});

describe('G46 - Brownfield Artifact Contract', () => {
  const changeTemplate = path.join(ROOT, 'distilled', 'templates', 'brownfield-change', 'CHANGE.md');
  const handoffTemplate = path.join(ROOT, 'distilled', 'templates', 'brownfield-change', 'HANDOFF.md');
  const verificationTemplate = path.join(ROOT, 'distilled', 'templates', 'brownfield-change', 'VERIFICATION.md');
  const gapsPath = path.join(ROOT, '.internal-research', 'gaps.md');
  const evidencePath = path.join(ROOT, 'distilled', 'EVIDENCE-INDEX.md');

  test('brownfield-change template family exists', () => {
    for (const filePath of [changeTemplate, handoffTemplate, verificationTemplate]) {
      assert.ok(fs.existsSync(filePath),
        `${path.relative(ROOT, filePath)} must exist. FIX: Create the bounded brownfield-change template family.`);
    }
  });

  test('CHANGE.md defines the canonical one-active-stream contract', () => {
    const content = fs.readFileSync(changeTemplate, 'utf-8');
    for (const token of ['## Goal', '## In Scope', '## Out of Scope', '## Done When', '## Next Action', '## PR Slice Ownership', '## Closeout Path']) {
      assert.match(content, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `CHANGE.md must include "${token}". FIX: Add the missing contract section.`);
    }
    assert.match(content, /one active medium-scope change/i,
      'CHANGE.md must state the one-active-stream boundary. FIX: Add explicit one active medium-scope change wording.');
    assert.match(content, /disjoint write ownership|disjoint PR slice/i,
      'CHANGE.md must preserve the disjoint PR-slice rule. FIX: Add explicit disjoint write-ownership language.');
    assert.doesNotMatch(content, /Phase \d+|ROADMAP\.md|\[[ x-]\]/,
      'CHANGE.md must not drift into milestone-lite semantics. FIX: Remove phase numbering, ROADMAP ownership, or checkbox state from the change contract.');
  });

  test('HANDOFF.md and VERIFICATION.md keep rolling judgment separate from closeout proof', () => {
    const handoff = fs.readFileSync(handoffTemplate, 'utf-8');
    const verification = fs.readFileSync(verificationTemplate, 'utf-8');

    for (const token of ['## Active Constraints', '## Unresolved Uncertainty', '## Decision Posture', '## Anti-Regression', '## Next Action']) {
      assert.match(handoff, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `HANDOFF.md must include "${token}". FIX: Add the missing rolling-judgment section.`);
    }
    for (const token of ['## Goal Verification', '## Evidence', '## Gaps', '## Closeout Decision']) {
      assert.match(verification, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `VERIFICATION.md must include "${token}". FIX: Add the missing closeout-proof section.`);
    }
    assert.match(verification, /code|test|runtime|delivery|human/,
      'VERIFICATION.md must preserve the shared evidence-kind vocabulary. FIX: Add the evidence-kinds guidance.');
  });

  test('planning and design truth agree on the bounded brownfield-change lane', () => {
    if (!fs.existsSync(PLANNING_SPEC_MD) || !fs.existsSync(PLANNING_ROADMAP_MD) || !fs.existsSync(INTERNAL_TODO_MD) || !fs.existsSync(gapsPath)) {
      return assert.ok(true, 'local-only planning truth is absent in CI');
    }

    const planningSpec = fs.readFileSync(PLANNING_SPEC_MD, 'utf-8');
    const roadmap = fs.readFileSync(PLANNING_ROADMAP_MD, 'utf-8');
    const todo = fs.readFileSync(INTERNAL_TODO_MD, 'utf-8');
    const gaps = fs.readFileSync(gapsPath, 'utf-8');
    const design = fs.readFileSync(DESIGN_MD, 'utf-8');
    const evidence = fs.readFileSync(evidencePath, 'utf-8');

    assert.match(planningSpec, /brownfield-change\/` folder.*CHANGE\.md.*HANDOFF\.md.*VERIFICATION\.md/i,
      '.planning/SPEC.md must describe the dedicated brownfield-change family. FIX: Add the explicit 3-file lane contract.');
    assert.match(roadmap, /parallelism/i,
      '.planning/ROADMAP.md Phase 40 must preserve parallelism boundaries, not only size/escalation. FIX: Add parallelism to the phase contract.');
    assert.match(todo, /Phase 41|\/gsdd-plan 41|\/gsdd-verify 41/i,
      '.internal-research/TODO.md must keep the active brownfield continuity next step current. FIX: Update the active next step after Phase 40 and Phase 41 progress.');
    assert.match(gaps, /I43[\s\S]*brownfield-change/i,
      '.internal-research/gaps.md must narrow I43 around the new brownfield-change contract. FIX: Update I43 after Phase 40.');
    assert.match(design, /## D54 - Bounded Brownfield Change Folder Contract/,
      'distilled/DESIGN.md must record the bounded brownfield-change decision. FIX: Add D54 to DESIGN.md.');
    assert.match(evidence, /## D54 — Bounded Brownfield Change Folder Contract/,
      'distilled/EVIDENCE-INDEX.md must index the new brownfield-change decision. FIX: Add D54 to EVIDENCE-INDEX.md.');
  });
});

describe('G47 - Brownfield Continuity Contract', () => {
  const changeTemplate = path.join(ROOT, 'distilled', 'templates', 'brownfield-change', 'CHANGE.md');
  const handoffTemplate = path.join(ROOT, 'distilled', 'templates', 'brownfield-change', 'HANDOFF.md');
  const progressWorkflow = path.join(ROOT, 'distilled', 'workflows', 'progress.md');
  const resumeWorkflow = path.join(ROOT, 'distilled', 'workflows', 'resume.md');

  test('CHANGE.md and HANDOFF.md keep one operational anchor plus one judgment surface', () => {
    const change = fs.readFileSync(changeTemplate, 'utf-8');
    const handoff = fs.readFileSync(handoffTemplate, 'utf-8');

    assert.match(change, /\.planning\/brownfield-change\/CHANGE\.md/,
      'CHANGE.md must name the live brownfield artifact path. FIX: Add the instantiated continuity path.');
    assert.match(change, /read this file first|authoritative next action/i,
      'CHANGE.md must state that progress/resume read it first for operational continuity. FIX: Add the operational-anchor guidance.');
    assert.match(handoff, /Operational state still lives in `CHANGE\.md`/i,
      'HANDOFF.md must explicitly defer operational state to CHANGE.md. FIX: Add the one-anchor wording.');
    assert.match(handoff, /must not become a second status or routing authority/i,
      'HANDOFF.md must forbid dual-authority drift. FIX: Preserve the judgment-only boundary.');
  });

  test('progress.md reports active brownfield change continuity without mutating state', () => {
    const progress = fs.readFileSync(progressWorkflow, 'utf-8');

    assert.match(progress, /active medium-scope brownfield continuity state/i,
      'progress.md must recognize the active brownfield change state. FIX: Add the brownfield-change detection branch.');
    assert.match(progress, /`active_brownfield_change`/i,
      'progress.md must name the active brownfield non-phase state explicitly. FIX: Add active_brownfield_change to derive_status.');
    assert.match(progress, /CHANGE\.md` first as the canonical operational anchor/i,
      'progress.md must read CHANGE.md first for brownfield continuity. FIX: Add the operational-anchor rule.');
    assert.match(progress, /HANDOFF\.md`.*judgment-only context/i,
      'progress.md must keep HANDOFF.md as judgment-only context. FIX: Add the handoff-only wording.');
    assert.match(progress, /Brownfield continuity warning/i,
      'progress.md must surface brownfield artifact/worktree drift as a warning. FIX: Add the continuity warning block.');
    assert.match(progress, /Run \/gsdd-resume to restore the active brownfield change context/i,
      'progress.md must route the active brownfield change toward /gsdd-resume. FIX: Add the active brownfield Branch F recommendation.');
    assert.match(progress, /progress` stays read-only\.|progress stays read-only\./i,
      'progress.md must remain read-only while reporting the brownfield state. FIX: Preserve the read-only boundary.');
    assert.match(progress, /strict-match rule/i,
      'progress.md must name the shared strict-match rule before letting a checkpoint outrank CHANGE.md. FIX: Add the strict-match routing language.');
    assert.match(progress, /branch alignment[\s\S]*scope alignment[\s\S]*still-active execution state/i,
      'progress.md must spell out the three strict-match checks. FIX: Add branch/scope/still-active execution-state wording.');
  });

  test('resume.md restores active brownfield change context with acknowledgement-gated mismatch handling', () => {
    const resume = fs.readFileSync(resumeWorkflow, 'utf-8');

    assert.match(resume, /\.planning\/brownfield-change\/CHANGE\.md/,
      'resume.md must load the active brownfield change artifact. FIX: Add CHANGE.md to detect/load state.');
    assert.match(resume, /canonical operational continuity anchor/i,
      'resume.md must treat CHANGE.md as the operational anchor. FIX: Add the anchor wording.');
    assert.match(resume, /Do not flatten `CHANGE\.md` and `HANDOFF\.md` into co-equal operational sources/i,
      'resume.md must forbid dual operational authorities. FIX: Preserve the handoff-only posture.');
    assert.match(resume, /material brownfield artifact\/worktree mismatch|artifact\/worktree mismatch is material/i,
      'resume.md must name the brownfield artifact/worktree mismatch seam. FIX: Add the mismatch rule.');
    assert.match(resume, /require acknowledgement before continuing the brownfield change/i,
      'resume.md must require acknowledgement on material brownfield mismatch. FIX: Add the acknowledgement gate.');
    assert.match(resume, /present the `CHANGE\.md` next action as the primary resume target/i,
      'resume.md must route active brownfield continuity through CHANGE.md next_action. FIX: Add the brownfield determine_action branch.');
    assert.match(resume, /strict-match rule/i,
      'resume.md must share the strict-match checkpoint precedence rule with progress. FIX: Add the strict-match note to provenance reconciliation or determine_action.');
    assert.match(resume, /branch alignment[\s\S]*scope alignment[\s\S]*still-active execution state/i,
      'resume.md must spell out the three strict-match checks. FIX: Add branch/scope/still-active execution-state wording.');
  });
});

describe('G48 - Brownfield Growth And Milestone Handoff', () => {
  const changeTemplate = path.join(ROOT, 'distilled', 'templates', 'brownfield-change', 'CHANGE.md');
  const handoffTemplate = path.join(ROOT, 'distilled', 'templates', 'brownfield-change', 'HANDOFF.md');
  const verificationTemplate = path.join(ROOT, 'distilled', 'templates', 'brownfield-change', 'VERIFICATION.md');
  const newProjectWorkflow = path.join(ROOT, 'distilled', 'workflows', 'new-project.md');
  const newMilestoneWorkflow = path.join(ROOT, 'distilled', 'workflows', 'new-milestone.md');
  const progressWorkflow = path.join(ROOT, 'distilled', 'workflows', 'progress.md');
  const resumeWorkflow = path.join(ROOT, 'distilled', 'workflows', 'resume.md');

  test('brownfield templates preserve structural promotion guidance without inventing a new artifact family', () => {
    const change = fs.readFileSync(changeTemplate, 'utf-8');
    const handoff = fs.readFileSync(handoffTemplate, 'utf-8');
    const verification = fs.readFileSync(verificationTemplate, 'utf-8');

    assert.match(change, /Structural Promotion Triggers/i,
      'CHANGE.md must define explicit structural promotion triggers. FIX: Add a Structural Promotion Triggers section.');
    assert.match(change, /one active stream|one active medium-scope change/i,
      'CHANGE.md must keep the one-active-stream boundary visible during widening. FIX: Re-state the one-active-stream rule near the promotion guidance.');
    assert.match(change, /\/gsdd-new-project[\s\S]*first milestone/i,
      'CHANGE.md must route first-milestone widening through /gsdd-new-project. FIX: Add the first-milestone widen path.');
    assert.match(change, /\/gsdd-new-milestone[\s\S]*shipped milestone history|next milestone cycle/i,
      'CHANGE.md must route subsequent widening through /gsdd-new-milestone. FIX: Add the subsequent-milestone widen path.');
    assert.match(change, /Do not invent a separate promotion artifact|Do not create a second durable handoff file/i,
      'CHANGE.md must forbid a second promotion artifact. FIX: Add the no-new-promotion-artifact rule.');

    assert.match(handoff, /preserved judgment input to `?\/gsdd-new-project`? or `?\/gsdd-new-milestone`?/i,
      'HANDOFF.md must describe how widening reuses the judgment surface. FIX: Add the widening handoff note.');
    assert.match(verification, /existing proof surface even when the bounded change widens|Milestone-init workflows should read it/i,
      'VERIFICATION.md must preserve proof reuse during widening. FIX: Add widening reuse guidance to the verification template.');
  });

  test('new-project.md reuses brownfield artifacts as widening inputs instead of rediscovering them', () => {
    const content = fs.readFileSync(newProjectWorkflow, 'utf-8');

    assert.match(content, /brownfield_widening_context/i,
      'new-project.md must have an explicit brownfield widening section. FIX: Add <brownfield_widening_context>.');
    assert.match(content, /CHANGE\.md[\s\S]*HANDOFF\.md[\s\S]*VERIFICATION\.md/i,
      'new-project.md must read CHANGE.md, HANDOFF.md, and VERIFICATION.md when widening. FIX: Add the three widening inputs.');
    assert.match(content, /Do not create a new promotion artifact/i,
      'new-project.md must forbid a new promotion artifact during widening. FIX: Add the no-new-artifact rule.');
    assert.match(content, /do not make the user rediscover context already preserved on disk/i,
      'new-project.md questioning must reuse preserved brownfield context. FIX: Add the no-rediscovery rule.');
    assert.match(content, /route this widen request to `?\/gsdd-new-milestone`?/i,
      'new-project.md must defer to /gsdd-new-milestone when shipped milestone history already exists. FIX: Add the subsequent-milestone redirect.');
  });

  test('new-milestone.md consumes brownfield widening inputs and preserves context into phase design', () => {
    const content = fs.readFileSync(newMilestoneWorkflow, 'utf-8');

    assert.match(content, /brownfield_widening_inputs/i,
      'new-milestone.md must have an explicit brownfield widening input section. FIX: Add <brownfield_widening_inputs>.');
    assert.match(content, /CHANGE\.md[\s\S]*HANDOFF\.md[\s\S]*VERIFICATION\.md/i,
      'new-milestone.md must consume the full brownfield artifact family during widening. FIX: Add the three widening inputs.');
    assert.match(content, /explicit widen request/i,
      'new-milestone.md must treat invocation from active brownfield continuity as an explicit widen request. FIX: Add the explicit widen-request wording.');
    assert.match(content, /Do not force the user to rediscover this context/i,
      'new-milestone.md must preserve brownfield context instead of rediscovery. FIX: Add the no-rediscovery rule.');
    assert.match(content, /preserve the already-captured scope, decisions, and proof\/gap context/i,
      'new-milestone.md phase design must preserve the existing brownfield context. FIX: Add the preserved-scope/proof phase-design rule.');
  });

  test('progress.md and resume.md keep milestone widening case-by-case instead of a default fallback', () => {
    const progress = fs.readFileSync(progressWorkflow, 'utf-8');
    const resume = fs.readFileSync(resumeWorkflow, 'utf-8');

    assert.match(progress, /Growth boundary: stay in the bounded lane/i,
      'progress.md must keep bounded growth explicit. FIX: Add the growth-boundary status line.');
    assert.match(progress, /\/gsdd-new-milestone[\s\S]*intentionally want to widen/i,
      'progress.md must offer /gsdd-new-milestone only as an intentional widen path. FIX: Add the explicit subsequent-milestone widen option.');

    assert.match(resume, /multiple active streams, milestone-owned lifecycle state, or broader requirement tracking/i,
      'resume.md must describe the structural triggers for widening. FIX: Add the bounded-growth trigger wording.');
    assert.match(resume, /use `?\/gsdd-new-project`? for first-milestone setup and `?\/gsdd-new-milestone`?/i,
      'resume.md must distinguish first-milestone and subsequent-milestone widening. FIX: Add the split widen-path wording.');
  });
});

describe('G29 - Outcome-Based Verification Contracts', () => {
  const verifyWorkflow = fs.readFileSync(
    path.join(__dirname, '..', 'distilled', 'workflows', 'verify.md'), 'utf-8'
  );

  test('verify.md has <evidence_contract> section', () => {
    assert.match(verifyWorkflow, /<evidence_contract>/,
      'verify.md must have <evidence_contract> section (GA1/ENGINE-04). FIX: Add <evidence_contract> between </must_haves> and <verification_levels>.');
  });

  test('verify.md evidence_contract is positioned between must_haves and verification_levels', () => {
    const mustHavesEnd = verifyWorkflow.indexOf('</must_haves>');
    const proofContractStart = verifyWorkflow.indexOf('<evidence_contract>');
    const verificationLevelsStart = verifyWorkflow.indexOf('<verification_levels>');
    assert.ok(mustHavesEnd > -1 && proofContractStart > -1 && verificationLevelsStart > -1,
      'verify.md must have </must_haves>, <evidence_contract>, and <verification_levels>. FIX: Check section structure.');
    assert.ok(
      proofContractStart > mustHavesEnd && proofContractStart < verificationLevelsStart,
      'verify.md <evidence_contract> must be after </must_haves> and before <verification_levels> (GA1). FIX: Reorder sections.');
  });

  test('verify.md evidence_contract names the five stable evidence kinds and both delivery postures', () => {
    const pcStart = verifyWorkflow.indexOf('<evidence_contract>');
    const pcEnd = verifyWorkflow.indexOf('</evidence_contract>');
    const section = verifyWorkflow.slice(pcStart, pcEnd);
    for (const proofType of ['code', 'test', 'runtime', 'delivery', 'human']) {
      assert.ok(
        section.includes(proofType),
        `verify.md <evidence_contract> must name evidence kind "${proofType}" (GA1/ENGINE-04). FIX: Add all five stable evidence kinds.`);
    }
    for (const posture of ['repo_only', 'delivery_sensitive']) {
      assert.ok(
        section.includes(posture),
        `verify.md <evidence_contract> must name delivery posture "${posture}" (ENGINE-04). FIX: Add both shared delivery postures.`
      );
    }
  });

  test('verify.md must_haves contains risk: high self-classification', () => {
    const mhStart = verifyWorkflow.indexOf('<must_haves>');
    const mhEnd = verifyWorkflow.indexOf('</must_haves>');
    const section = verifyWorkflow.slice(mhStart, mhEnd);
    assert.ok(
      section.includes('risk: high') || section.includes('risk:high'),
      'verify.md <must_haves> must include risk: high classification step (GA2/VERIFY-02). FIX: Add risk self-classification at end of <must_haves>.');
  });

  test('verify.md must_haves risk classification references behavioral or UX changes', () => {
    const mhStart = verifyWorkflow.indexOf('<must_haves>');
    const mhEnd = verifyWorkflow.indexOf('</must_haves>');
    const section = verifyWorkflow.slice(mhStart, mhEnd);
    assert.ok(
      section.includes('behavioral') || section.includes('UX change') || section.includes('user-visible'),
      'verify.md <must_haves> risk classification must reference behavioral/UX changes as the trigger (GA2). FIX: Add trigger language.');
  });

  test('verify.md report_format records delivery posture plus required/observed/missing evidence fields', () => {
    const rfStart = verifyWorkflow.indexOf('<report_format>');
    const rfEnd = verifyWorkflow.indexOf('</report_format>');
    const section = verifyWorkflow.slice(rfStart, rfEnd);
    for (const field of ['delivery_posture', 'required_evidence', 'observed_evidence', 'missing_evidence', 'severity']) {
      assert.ok(
        section.includes(field),
        `verify.md <report_format> must include ${field}. FIX: Keep the evidence-gated closure fields in the frontmatter contract.`
      );
    }
  });

});

describe('G11b - Launch Claim Hardening', () => {
  test('README uses proof-split wording instead of broad all-runtime parity copy', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.doesNotMatch(readme, /\*\*Works with Claude Code, OpenCode, Codex CLI, Cursor, Copilot, and Gemini CLI\.\*\*/i,
      'README.md must not use the old broad all-runtime top-line claim. FIX: Replace it with proof-split wording.');
    assert.match(readme, /Directly validated today:.*Claude Code.*Codex CLI.*OpenCode/i,
      'README.md must name the directly validated runtimes. FIX: Add plain proof-split wording near the top.');
    assert.match(readme, /Qualified support:.*Cursor.*Copilot.*Gemini/i,
      'README.md must distinguish qualified support runtimes. FIX: Add the qualified-support line near the top.');
  });

  test('README adapter tables avoid internal runtime taxonomy jargon', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.doesNotMatch(readme, /native_capable|governance_only/i,
      'README.md must not expose internal runtime taxonomy jargon in public tables. FIX: Use plain public wording such as "Directly validated" or "Qualified support".');
  });

  test('README and distilled README stay benchmark-free for the public launch surface', () => {
    const rootReadme = fs.readFileSync(README_MD, 'utf-8');
    const distilledReadme = fs.readFileSync(DISTILLED_README_MD, 'utf-8');
    assert.doesNotMatch(rootReadme, /benchmark|CodeGraphContext/i,
      'README.md must stay benchmark-free in Phase 13. FIX: Remove benchmark/comparison launch copy.');
    assert.doesNotMatch(distilledReadme, /benchmark|CodeGraphContext/i,
      'distilled/README.md must stay benchmark-free in Phase 13. FIX: Remove benchmark/comparison launch copy.');
  });

  test('public generated wording avoids stale counts, dates, phase leakage, and state-file wording', () => {
    const publicDocs = [
      README_MD,
      path.join(ROOT, 'docs', 'USER-GUIDE.md'),
      path.join(ROOT, 'docs', 'RUNTIME-SUPPORT.md'),
      DISTILLED_README_MD,
      path.join(ROOT, 'distilled', 'DESIGN.md'),
      path.join(ROOT, 'distilled', 'EVIDENCE-INDEX.md'),
      path.join(ROOT, 'distilled', 'workflows', 'new-project.md'),
      path.join(ROOT, 'distilled', 'templates', 'agents.block.md'),
    ].map(file => fs.readFileSync(file, 'utf-8')).join('\n');

    assert.doesNotMatch(publicDocs, /Current delegates \(\d+\)|all \d+ delegate files|\b\d+ delegates:/i,
      'Public/generated docs must not hard-code stale delegate counts. FIX: Use catalog/category wording or derive counts in tests.');
    assert.doesNotMatch(publicDocs, /updated 2026/i,
      'Public/generated docs must not use stale date-sensitive "updated 2026" headings. FIX: Use durable headings without update dates.');
    assert.doesNotMatch(publicDocs, /Phase 32 validation target|mandatory Phase 32|Phase 29\/32|freshness enforcement remains Phase 32/i,
      'Public/generated docs must not leak internal phase tracking labels. FIX: Describe the durable capability instead of the implementation phase.');
    assert.doesNotMatch(publicDocs, /Current State is set/i,
      'Public/generated docs must use ROADMAP/phase-status language, not stale Current State wording. FIX: Reference ROADMAP phase status.');
    assert.match(publicDocs, /npx -y gsdd-cli init/i,
      'Public/generated docs must preserve npx-first human guidance. FIX: Keep npx -y gsdd-cli init in onboarding copy.');
    assert.match(publicDocs, /node \.planning\/bin\/gsdd\.mjs/i,
      'Public/generated docs must preserve repo-local workflow helper command guidance. FIX: Keep node .planning/bin/gsdd.mjs examples.');
  });
});

describe('G30 - Verify ROADMAP Closure On Pass', () => {
  const verifyWorkflow = fs.readFileSync(
    path.join(__dirname, '..', 'distilled', 'workflows', 'verify.md'), 'utf-8'
  );

  test('verify.md persistence section mandates ROADMAP update on passed status', () => {
    const persStart = verifyWorkflow.indexOf('<persistence>');
    const persEnd = verifyWorkflow.indexOf('</persistence>');
    const section = verifyWorkflow.slice(persStart, persEnd);
    assert.ok(
      section.includes('ROADMAP'),
      'verify.md <persistence> must instruct updating ROADMAP.md on pass (I27 fix). FIX: Add ROADMAP [x] update step after writing VERIFICATION.md.');
  });

  test('verify.md persistence ROADMAP update is conditional on passed status', () => {
    const persStart = verifyWorkflow.indexOf('<persistence>');
    const persEnd = verifyWorkflow.indexOf('</persistence>');
    const section = verifyWorkflow.slice(persStart, persEnd);
    assert.ok(
      section.includes('if') && section.includes('passed') && section.includes('ROADMAP'),
      'verify.md <persistence> ROADMAP update must be conditional on status: passed (I27 fix). FIX: Add "if status: passed" guard to ROADMAP update.');
  });

  test('verify.md success_criteria includes ROADMAP [x] check', () => {
    const scStart = verifyWorkflow.indexOf('<success_criteria>');
    const scEnd = verifyWorkflow.indexOf('</success_criteria>');
    const section = verifyWorkflow.slice(scStart, scEnd);
    assert.ok(
      section.includes('ROADMAP') && section.includes('passed'),
      'verify.md <success_criteria> must include a ROADMAP [x] check for passed status (I27 fix). FIX: Add ROADMAP checkbox to success_criteria list.');
  });
});

describe('G34 - Git Delivery Visibility', () => {
  const verifyWorkflow = fs.readFileSync(
    path.join(__dirname, '..', 'distilled', 'workflows', 'verify.md'), 'utf-8'
  );
  const progressWorkflow = fs.readFileSync(
    path.join(__dirname, '..', 'distilled', 'workflows', 'progress.md'), 'utf-8'
  );

  test('verify.md has git delivery collection step before report_format', () => {
    const sectionStart = verifyWorkflow.indexOf('<git_delivery_collection>');
    const sectionEnd = verifyWorkflow.indexOf('</git_delivery_collection>');
    const reportFormatStart = verifyWorkflow.indexOf('<report_format>');
    assert.ok(
      sectionStart > -1 && sectionEnd > -1,
      'verify.md must have a <git_delivery_collection> section. FIX: Add a dedicated delivery-metadata collection step before report_format.'
    );
    assert.ok(
      sectionStart < reportFormatStart,
      'verify.md <git_delivery_collection> must appear before <report_format>. FIX: Collect delivery metadata before defining the output artifact.'
    );
  });

  test('verify.md git delivery collection names required commands', () => {
    const section = verifyWorkflow.slice(
      verifyWorkflow.indexOf('<git_delivery_collection>'),
      verifyWorkflow.indexOf('</git_delivery_collection>')
    );
    for (const required of [
      'git rev-parse --abbrev-ref HEAD',
      'git rev-list --count "main..HEAD"',
      'gh pr list --head',
      'git status --short',
    ]) {
      assert.ok(
        section.includes(required),
        `verify.md <git_delivery_collection> must reference \`${required}\`. FIX: Add the command to the collection step.`
      );
    }
  });

  test('verify.md git delivery check stays non-blocking', () => {
    const section = verifyWorkflow.slice(
      verifyWorkflow.indexOf('<git_delivery_collection>'),
      verifyWorkflow.indexOf('</git_delivery_collection>')
    );
    assert.ok(
      /do \*\*not\*\* downgrade|do not downgrade|delivery warnings only/i.test(section),
      'verify.md <git_delivery_collection> must say delivery findings are warning-level by default. FIX: Keep missing PR/unmerged commits/non-clean worktree non-blocking.'
    );
  });

  test('verify.md report_format includes git_delivery_check block with required fields', () => {
    const rfStart = verifyWorkflow.indexOf('<report_format>');
    const rfEnd = verifyWorkflow.indexOf('</report_format>');
    const section = verifyWorkflow.slice(rfStart, rfEnd);
    assert.ok(
      section.includes('<git_delivery_check>') && section.includes('</git_delivery_check>'),
      'verify.md <report_format> must include a <git_delivery_check> block. FIX: Keep the frontmatter output block in the report template.'
    );
    for (const field of ['branch', 'commits_ahead_of_main', 'pr_state']) {
      assert.ok(
        section.includes(field),
        `verify.md <report_format> git_delivery_check block must include field \`${field}\`. FIX: Restore the required frontmatter field.`
      );
    }
  });

  test('progress.md retains unmerged commit check and conditional warning', () => {
    assert.ok(
      progressWorkflow.includes('<unmerged_commits_check>') && progressWorkflow.includes('</unmerged_commits_check>'),
      'progress.md must keep the <unmerged_commits_check> block. FIX: Restore the derive_status subsection.'
    );
    assert.ok(
      progressWorkflow.includes('Unmerged commits: [N] commit(s) on this branch not yet merged to main'),
      'progress.md must keep the conditional unmerged-commit warning text. FIX: Restore the present_status warning block.'
    );
    assert.ok(
      progressWorkflow.includes('silent when empty'),
      'progress.md must preserve the silent-when-empty contract. FIX: Keep the success_criteria bullet and derive_status wording.'
    );
  });
});

describe('Phase 18 deterministic CLI guards', () => {
  const workflowsDir = path.join(ROOT, 'distilled', 'workflows');

  test('bin/gsdd.mjs registers file-op, phase-status, and lifecycle-preflight commands', () => {
    const gsddContent = fs.readFileSync(GSDD_PATH, 'utf-8');
    assert.match(gsddContent, /'file-op'\s*:/,
      'bin/gsdd.mjs must register the file-op command. FIX: Add file-op to COMMANDS.');
    assert.match(gsddContent, /'phase-status'\s*:/,
      'bin/gsdd.mjs must register the phase-status command. FIX: Add phase-status to COMMANDS.');
    assert.match(gsddContent, /'lifecycle-preflight'\s*:/,
      'bin/gsdd.mjs must register the lifecycle-preflight command. FIX: Add lifecycle-preflight to COMMANDS.');
  });

  test('bin/lib/file-ops.mjs exists and exports cmdFileOp', async () => {
    const fileOpsPath = path.join(ROOT, 'bin', 'lib', 'file-ops.mjs');
    assert.ok(fs.existsSync(fileOpsPath),
      'bin/lib/file-ops.mjs must exist. FIX: Add the deterministic file-op helper module.');
    const mod = await import(`file://${fileOpsPath.replace(/\\/g, '/')}`);
    assert.strictEqual(typeof mod.cmdFileOp, 'function',
      'bin/lib/file-ops.mjs must export cmdFileOp. FIX: Export the file-op command handler.');
  });

  test('init help text documents file-op, phase-status, and lifecycle-preflight', async () => {
    const mod = await import(`file://${INIT_MODULE.replace(/\\/g, '/')}`);
    const previousLog = console.log;
    let output = '';
    console.log = (...parts) => { output += `${parts.join(' ')}\n`; };
    try {
      mod.cmdHelp();
    } finally {
      console.log = previousLog;
    }

    assert.match(output, /file-op <copy\|delete\|regex-sub>/,
      'Help text must document file-op. FIX: Add file-op command to cmdHelp output.');
    assert.match(output, /phase-status <N> <status>/,
      'Help text must document phase-status. FIX: Add phase-status command to cmdHelp output.');
    assert.match(output, /lifecycle-preflight <surface> \[phase\]/,
      'Help text must document lifecycle-preflight. FIX: Add lifecycle-preflight command to cmdHelp output.');
  });

  test('local helper renderer emits a self-contained helper runtime and platform shims', async () => {
    const renderingPath = path.join(ROOT, 'bin', 'lib', 'rendering.mjs');
    const renderingSource = fs.readFileSync(renderingPath, 'utf-8');

    assert.match(renderingSource, /import \{ cmdFileOp \} from '\.\/lib\/file-ops\.mjs';/,
      'rendering.mjs must generate a self-contained helper runtime entrypoint. FIX: Import the copied helper modules instead of proxying through npm exec.');
    assert.match(renderingSource, /bootstrapHelperWorkspace\(import\.meta\.url\)/,
      'rendering.mjs must bootstrap workspace root from the generated helper location. FIX: Initialize the local helper runtime with bootstrapHelperWorkspace().');
    assert.doesNotMatch(renderingSource, /npm(?:\.cmd)?'.*exec.*--package=/s,
      'rendering.mjs must not keep the npm exec trampoline. FIX: Remove packaged CLI proxy execution from the local helper runtime.');
    assert.match(renderingSource, /relativePath:\s*'bin\/gsdd'/,
      'rendering.mjs must emit a POSIX repo-local gsdd shim. FIX: Add the .planning/bin/gsdd wrapper.');
    assert.match(renderingSource, /relativePath:\s*'bin\/gsdd\.cmd'/,
      'rendering.mjs must emit a Windows repo-local gsdd shim. FIX: Add the .planning/bin/gsdd.cmd wrapper.');
    assert.match(renderingSource, /relativePath:\s*'bin\/gsdd\.ps1'/,
      'rendering.mjs must emit a PowerShell repo-local gsdd shim. FIX: Add the .planning/bin/gsdd.ps1 wrapper.');
    assert.match(renderingSource, /relativePath:\s*`bin\/lib\/\$\{fileName\}`/,
      'rendering.mjs must copy helper support modules into .planning/bin/lib/. FIX: Render helper lib entries together with the runtime entrypoint.');
  });

  test('affected workflows route checkpoint file ops through the repo-local helper launcher', () => {
    const expectations = [
      ['pause.md', /node \.planning\/bin\/gsdd\.mjs file-op delete \.planning\/\.continue-here\.bak --missing ok/],
      ['resume.md', /node \.planning\/bin\/gsdd\.mjs file-op copy \.planning\/\.continue-here\.md \.planning\/\.continue-here\.bak/],
      ['resume.md', /node \.planning\/bin\/gsdd\.mjs file-op delete \.planning\/\.continue-here\.md/],
      ['plan.md', /node \.planning\/bin\/gsdd\.mjs file-op delete \.planning\/\.continue-here\.bak --missing ok/],
      ['execute.md', /node \.planning\/bin\/gsdd\.mjs file-op delete \.planning\/\.continue-here\.bak --missing ok/],
      ['verify.md', /node \.planning\/bin\/gsdd\.mjs file-op delete \.planning\/\.continue-here\.bak --missing ok/],
      ['quick.md', /node \.planning\/bin\/gsdd\.mjs file-op delete \.planning\/\.continue-here\.bak --missing ok/],
    ];

    for (const [name, pattern] of expectations) {
      const content = fs.readFileSync(path.join(workflowsDir, name), 'utf-8');
      assert.match(content, pattern,
        `${name} must route deterministic checkpoint file ops through the repo-local helper launcher. FIX: Replace manual copy/delete instructions with node .planning/bin/gsdd.mjs file-op.`);
    }
  });

  test('resume.md no longer describes manual checkpoint copy/delete prose', () => {
    const content = fs.readFileSync(path.join(workflowsDir, 'resume.md'), 'utf-8');
    assert.doesNotMatch(content, /(^|\n)\s*\d+\.\s*Copy `?\.planning\/\.continue-here\.md`? to `?\.planning\/\.continue-here\.bak`?/i,
      'resume.md must not keep the old manual copy wording. FIX: Reference node .planning/bin/gsdd.mjs file-op copy only.');
    assert.doesNotMatch(content, /(^|\n)\s*\d+\.\s*Delete `?\.planning\/\.continue-here\.md`?/i,
      'resume.md must not keep the old manual delete wording. FIX: Reference node .planning/bin/gsdd.mjs file-op delete only.');
  });

  test('execute.md and verify.md route roadmap status changes through the repo-local helper launcher', () => {
    for (const name of ['execute.md', 'verify.md']) {
      const content = fs.readFileSync(path.join(workflowsDir, name), 'utf-8');
      assert.match(content, /node \.planning\/bin\/gsdd\.mjs phase-status/,
        `${name} must route ROADMAP phase status updates through node .planning/bin/gsdd.mjs phase-status. FIX: Replace manual checkbox mutation text.`);
    }
  });
});

describe('G31 - Evidence Index Completeness', () => {
  const designContent = fs.readFileSync(
    path.join(__dirname, '..', 'distilled', 'DESIGN.md'), 'utf-8'
  );
  const evidenceContent = fs.readFileSync(
    path.join(__dirname, '..', 'distilled', 'EVIDENCE-INDEX.md'), 'utf-8'
  );

  // Count numbered decisions in ToC: lines matching "N. [Title]"
  const tocDecisions = (designContent.match(/^\d+\. \[/gm) || []).length;

  // Count D-entries in EVIDENCE-INDEX.md: lines matching "## DN —"
  const evidenceEntries = (evidenceContent.match(/^## D\d+ —/gm) || []).length;

  test('distilled/EVIDENCE-INDEX.md exists', () => {
    assert.ok(
      fs.existsSync(path.join(__dirname, '..', 'distilled', 'EVIDENCE-INDEX.md')),
      'distilled/EVIDENCE-INDEX.md must exist (Phase 5 SC-3). FIX: Create the evidence index file.');
  });

  test('EVIDENCE-INDEX.md entry count matches DESIGN.md ToC decision count', () => {
    assert.ok(
      evidenceEntries > 0,
      'EVIDENCE-INDEX.md must have at least one D-entry. FIX: Add ## DN — entries.');
    assert.strictEqual(
      evidenceEntries,
      tocDecisions,
      `EVIDENCE-INDEX.md has ${evidenceEntries} entries but DESIGN.md ToC has ${tocDecisions} decisions. FIX: Add missing entries or remove extras.`
    );
  });

  test('every EVIDENCE-INDEX.md entry has at least one source line', () => {
    // Split into per-entry blocks and verify each has a bullet
    const entries = evidenceContent.split(/^## D\d+ —/m).slice(1);
    const entriesWithoutSources = entries.filter(block => !block.includes('\n- '));
    assert.strictEqual(
      entriesWithoutSources.length,
      0,
      `${entriesWithoutSources.length} EVIDENCE-INDEX.md entries have no source lines. FIX: Add at least one "- source" bullet per entry.`
    );
  });

  test('DESIGN.md preamble references gaps.md', () => {
    const preambleEnd = designContent.indexOf('## Table of Contents');
    const preamble = designContent.slice(0, preambleEnd);
    assert.ok(
      preamble.includes('gaps.md'),
      'DESIGN.md preamble must reference gaps.md (Phase 5 SC-3). FIX: Add gaps.md pointer to the preamble blockquote.');
  });
});

describe('G32 - Open Gaps Structure', () => {
  const gapsPath = path.join(__dirname, '..', '.internal-research', 'gaps.md');
  const gapsExists = fs.existsSync(gapsPath);
  const gapsContent = gapsExists ? fs.readFileSync(gapsPath, 'utf-8') : '';
  const skipReason = gapsExists ? false : '.internal-research/ is local-only and gitignored — skip in CI';

  test('.internal-research/gaps.md exists and is non-empty', { skip: skipReason }, () => {
    assert.ok(gapsContent.length > 100, '.internal-research/gaps.md must not be empty. FIX: Add gap entries.');
  });

  test('every gaps.md gap entry has a Status line', { skip: skipReason }, () => {
    const gapBlocks = gapsContent.split(/^### Gap/m).slice(1);
    const missingStatus = gapBlocks.filter(block => {
      const firstLines = block.split('\n').slice(0, 8).join('\n');
      return !firstLines.includes('- Status:');
    });
    assert.strictEqual(
      missingStatus.length,
      0,
      `${missingStatus.length} gaps.md entries are missing a "- Status:" line. FIX: Add "- Status: NOW|LATER|CLOSED" to each gap entry.`
    );
  });

  test('gaps.md has a Carry-over Priority Snapshot section', { skip: skipReason }, () => {
    assert.ok(
      gapsContent.includes('Carry-over Priority Snapshot'),
      'gaps.md must include a "Carry-over Priority Snapshot" section (Phase 5 SC-3). FIX: Add the summary section at the bottom.');
  });
});

describe('G33 - Phase 5 Success Criteria', () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  const gsmdjsContent = fs.readFileSync(path.join(__dirname, '..', 'bin', 'gsdd.mjs'), 'utf-8');

  test('SC-1: package.json has no mandatory runtime dependencies', () => {
    const deps = pkgJson.dependencies;
    assert.ok(
      deps === undefined || Object.keys(deps).length === 0,
      'package.json must have no mandatory dependencies (SC-1: no vendor lock-in). FIX: Remove mandatory runtime deps or move to devDependencies.');
  });

  test('SC-1: bin/gsdd.mjs has no dashboard or MCP imports', () => {
    assert.ok(
      !gsmdjsContent.includes('dashboard') && !gsmdjsContent.includes('@modelcontextprotocol'),
      'bin/gsdd.mjs must not import dashboard or MCP packages (SC-1: no hidden services). FIX: Remove the import.');
  });

  test('SC-2: all 10 CLI commands are registered', () => {
    // Commands appear as keys in the command registry object, e.g.: init: cmdInit, 'find-phase': cmdFindPhase
    const commandPatterns = [
      /\binit\s*:/,
      /\bupdate\s*:/,
      /\bhealth\s*:/,
      /\bverify\s*:/,
      /\bscaffold\s*:/,
      /'file-op'\s*:/,
      /'find-phase'\s*:/,
      /'phase-status'\s*:/,
      /\bmodels\s*:/,
      /\bhelp\s*:/,
    ];
    for (const pattern of commandPatterns) {
      assert.ok(
        pattern.test(gsmdjsContent),
        `bin/gsdd.mjs must register the '${pattern.source}' command (SC-2: deterministic mechanics). FIX: Add the command to the registry.`
      );
    }
  });

  test('SC-2: bin/lib/manifest.mjs exports generation manifest functions', () => {
    const manifestContent = fs.readFileSync(path.join(__dirname, '..', 'bin', 'lib', 'manifest.mjs'), 'utf-8');
    assert.ok(
      manifestContent.includes('buildManifest'),
      'bin/lib/manifest.mjs must export buildManifest (SC-2). FIX: Add the export.');
    assert.ok(
      manifestContent.includes('writeManifest'),
      'bin/lib/manifest.mjs must export writeManifest (SC-2). FIX: Add the export.');
  });

  test('SC-2: bin/lib/phase.mjs exports artifact verification and roadmap-status functions', () => {
    const phaseContent = fs.readFileSync(path.join(__dirname, '..', 'bin', 'lib', 'phase.mjs'), 'utf-8');
    assert.ok(
      phaseContent.includes('cmdVerify') || phaseContent.includes('createCmdVerify'),
      'bin/lib/phase.mjs must export a verify command (SC-2). FIX: Add the export.');
    assert.ok(
      phaseContent.includes('cmdScaffold') || phaseContent.includes('createCmdScaffold'),
      'bin/lib/phase.mjs must export a scaffold command (SC-2). FIX: Add the export.');
    assert.ok(
      phaseContent.includes('cmdPhaseStatus'),
      'bin/lib/phase.mjs must export cmdPhaseStatus (SC-2). FIX: Add the roadmap phase-status helper export.');
  });

  test('SC-3: distilled/EVIDENCE-INDEX.md exists with entries', () => {
    assert.ok(
      fs.existsSync(path.join(__dirname, '..', 'distilled', 'EVIDENCE-INDEX.md')),
      'distilled/EVIDENCE-INDEX.md must exist (SC-3: evidence discipline). FIX: Create the evidence index.');
    const content = fs.readFileSync(path.join(__dirname, '..', 'distilled', 'EVIDENCE-INDEX.md'), 'utf-8');
    const entryCount = (content.match(/^## D\d+ —/gm) || []).length;
    assert.ok(
      entryCount >= 37,
      `distilled/EVIDENCE-INDEX.md must have at least 37 entries (SC-3), found ${entryCount}. FIX: Add missing entries.`);
  });

  test('SC-3: .internal-research/gaps.md exists with structured gap entries', () => {
    const gapsPath = path.join(__dirname, '..', '.internal-research', 'gaps.md');
    if (!fs.existsSync(gapsPath)) {
      // .internal-research/ is gitignored and local-only — skip silently in CI
      return;
    }
    const content = fs.readFileSync(gapsPath, 'utf-8');
    assert.ok(
      content.includes('### Gap') && content.includes('- Status:'),
      '.internal-research/gaps.md must have structured gap entries with Status lines (SC-3). FIX: Add gap entries with "- Status:" fields.');
  });
});

// ---------------------------------------------------------------------------
// G35 - Milestone Lifecycle Workflows
// ---------------------------------------------------------------------------
describe('G35 - Milestone Lifecycle Workflows', () => {
  const WORKFLOWS_DIR = path.join(ROOT, 'distilled', 'workflows');
  const MILESTONE_WORKFLOWS = [
    'new-milestone.md',
    'complete-milestone.md',
    'plan-milestone-gaps.md',
  ];

  // Structural invariant: each file uses standard GSDD workflow sections
  for (const wf of MILESTONE_WORKFLOWS) {
    test(`${wf} uses standard GSDD workflow sections`, () => {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, wf), 'utf-8');
      assert.match(content, /<role>/,
        `${wf} must have a <role> section. FIX: Add <role> section defining the workflow identity.`);
      assert.match(content, /<\/role>/,
        `${wf} must close the <role> section. FIX: Close the <role> section.`);
      assert.match(content, /<process>/,
        `${wf} must have a <process> section. FIX: Add <process> section with workflow steps.`);
      assert.match(content, /<\/process>/,
        `${wf} must close the <process> section. FIX: Close the <process> section.`);
      assert.match(content, /<success_criteria>/,
        `${wf} must have a <success_criteria> section. FIX: Add <success_criteria> checklist.`);
      assert.match(content, /<completion>/,
        `${wf} must have a <completion> section. FIX: Add <completion> section with next-step routing.`);
    });

    test(`${wf} uses no vendor-specific APIs`, () => {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, wf), 'utf-8');
      assert.doesNotMatch(content, /AskUserQuestion\(/,
        `${wf} must not use AskUserQuestion (vendor API). FIX: Replace with plain text questions.`);
      assert.doesNotMatch(content, /\bTask\(/,
        `${wf} must not use Task() (vendor API). FIX: Replace with <delegate> blocks.`);
      assert.doesNotMatch(content, /gsd-tools\.cjs/,
        `${wf} must not use gsd-tools.cjs (GSD dependency). FIX: Replace with direct file operations.`);
    });
  }

  // Routing correctness: each workflow routes to the right next step
  test('new-milestone.md completion routes to /gsdd-plan', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-milestone.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    assert.match(section, /\/gsdd-plan/,
      'new-milestone completion must route to /gsdd-plan. FIX: Add /gsdd-plan as next step in completion.');
  });

  test('complete-milestone.md completion routes to /gsdd-new-milestone', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'complete-milestone.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    assert.match(section, /\/gsdd-new-milestone/,
      'complete-milestone completion must route to /gsdd-new-milestone. FIX: Add /gsdd-new-milestone as next step in completion.');
  });

  test('plan-milestone-gaps.md completion routes to /gsdd-plan', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'plan-milestone-gaps.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    assert.match(section, /\/gsdd-plan/,
      'plan-milestone-gaps completion must route to /gsdd-plan. FIX: Add /gsdd-plan as next step in completion.');
  });

  // Context references: each workflow reads the right source files
  test('new-milestone.md load_context references SPEC.md and MILESTONES.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-milestone.md'), 'utf-8');
    const ctx = content.slice(content.indexOf('<load_context>'), content.indexOf('</load_context>'));
    assert.match(ctx, /SPEC\.md/,
      'new-milestone load_context must reference SPEC.md. FIX: Add SPEC.md to load_context.');
    assert.match(ctx, /MILESTONES\.md/,
      'new-milestone load_context must reference MILESTONES.md. FIX: Add MILESTONES.md to load_context.');
    assert.match(ctx, /brownfield-change\/CHANGE\.md/,
      'new-milestone load_context must reference CHANGE.md when widening from an active bounded change. FIX: Add the brownfield widening inputs to load_context.');
    assert.match(ctx, /HANDOFF\.md/,
      'new-milestone load_context must reference HANDOFF.md when widening from an active bounded change. FIX: Add the handoff input to load_context.');
    assert.match(ctx, /VERIFICATION\.md/,
      'new-milestone load_context must reference VERIFICATION.md when widening from an active bounded change. FIX: Add the verification input to load_context.');
  });

  test('complete-milestone.md load_context references MILESTONE-AUDIT.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'complete-milestone.md'), 'utf-8');
    const ctx = content.slice(content.indexOf('<load_context>'), content.indexOf('</load_context>'));
    assert.match(ctx, /MILESTONE-AUDIT\.md/,
      'complete-milestone load_context must reference MILESTONE-AUDIT.md. FIX: Add MILESTONE-AUDIT.md to load_context.');
  });

  test('plan-milestone-gaps.md references MILESTONE-AUDIT.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'plan-milestone-gaps.md'), 'utf-8');
    assert.match(content, /MILESTONE-AUDIT\.md/,
      'plan-milestone-gaps must reference MILESTONE-AUDIT.md. FIX: Add MILESTONE-AUDIT.md reference.');
  });

  test('plan-milestone-gaps.md completion routes to /gsdd-audit-milestone after gap closure', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'plan-milestone-gaps.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    assert.match(section, /\/gsdd-audit-milestone/,
      'plan-milestone-gaps completion must mention /gsdd-audit-milestone for re-audit. FIX: Add re-audit hint to completion.');
  });

  test('MILESTONES.md must be listed in .gitignore (internal-only, not public)', () => {
    const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf-8');
    assert.match(gitignore, /MILESTONES\.md/,
      'MILESTONES.md must be in .gitignore — it is an internal-only milestone tracker and must not appear on the public surface. FIX: Add MILESTONES.md to .gitignore.');
  });
});

describe('G36 - Git Branch Safety', () => {
  const executeWorkflow = fs.readFileSync(path.join(ROOT, 'distilled', 'workflows', 'execute.md'), 'utf-8');
  const completeMilestoneWorkflow = fs.readFileSync(path.join(ROOT, 'distilled', 'workflows', 'complete-milestone.md'), 'utf-8');
  const gitRulesStart = executeWorkflow.indexOf('Git rules:');
  const gitRulesSection = gitRulesStart !== -1
    ? executeWorkflow.slice(gitRulesStart, executeWorkflow.indexOf('</execution_loop>'))
    : '';
  const pr67Title = 'chore: simplify agents.block.md to wildcard pointer + update G18 guards';
  const pr68Body = 'This branch also initializes the v1.0.0 Public Launch milestone locally';
  const pr91Title = 'feat: tighten search contract (Phase 8 - DISC-01 + SAFE-01)';

  test('execute.md has a "Git rules:" section', () => {
    assert.ok(gitRulesStart !== -1, 'execute.md must contain a "Git rules:" section — section marker not found.');
  });

  test('execute.md warns before implementing on main or master', () => {
    assert.match(gitRulesSection, /main.*master|master.*main/i,
      'execute.md must explicitly warn about main/master execution. FIX: Add a wrong-branch rule naming both branches.');
    assert.match(gitRulesSection, /STOP|hard-warn/i,
      'execute.md wrong-branch rule must hard-warn or stop. FIX: Add STOP or hard-warn wording.');
  });

  test('execute.md wrong-branch check names both main and master explicitly', () => {
    assert.match(gitRulesSection, /main/,
      'execute.md wrong-branch rule must name main explicitly. FIX: Add main to the git rules warning.');
    assert.match(gitRulesSection, /master/,
      'execute.md wrong-branch rule must name master explicitly. FIX: Add master to the git rules warning.');
  });

  test('complete-milestone.md has spent-branch guard in Step 1', () => {
    const readinessSection = completeMilestoneWorkflow.slice(
      completeMilestoneWorkflow.indexOf('## 1. Verify Readiness'),
      completeMilestoneWorkflow.indexOf('## 2. Determine Version')
    );
    assert.match(readinessSection, /spent.branch|already.merged|merged.*branch/i,
      'complete-milestone.md must guard against spent or already-merged branches during readiness checks. FIX: Add the spent-branch guard to Step 1.');
  });

  test('complete-milestone.md spent-branch guard mentions git branch --merged', () => {
    assert.match(completeMilestoneWorkflow, /git branch --merged/,
      'complete-milestone.md spent-branch guard must mention git branch --merged. FIX: Add the explicit command to the readiness check.');
  });

  test('execute.md naming rule covers requirement IDs', () => {
    assert.match(gitRulesSection, /requirement.*ID|requirement IDs/i,
      'execute.md naming hygiene must cover requirement IDs. FIX: Extend the naming rule beyond phase/plan/task IDs.');
  });

  test('execute.md naming rule covers milestone labels', () => {
    assert.match(gitRulesSection, /milestone.*label|internal.*milestone/i,
      'execute.md naming hygiene must cover internal milestone labels. FIX: Extend the naming rule to milestone labels.');
  });

  test('execute.md git rules require PR creation after committing on a feature branch', () => {
    assert.match(gitRulesSection, /PR creation|create a PR/i,
      'execute.md must instruct the executor to create a PR after committing on a feature branch. FIX: Add a PR creation rule to the git rules section.');
  });

  test('recorded PR incidents remain explicit regression fixtures for public naming hygiene', () => {
    assert.match(pr67Title, /\bG18\b/,
      'PR #67 regression fixture must preserve the leaked internal tracker label. FIX: Keep the exact incident title in the test fixture.');
    assert.match(pr68Body, /v1\.0\.0 Public Launch milestone locally/i,
      'PR #68 regression fixture must preserve the leaked local milestone framing. FIX: Keep the exact incident body text in the test fixture.');
    assert.match(pr91Title, /Phase 8/i,
      'PR #91 regression fixture must preserve the leaked phase label. FIX: Keep the exact incident title in the test fixture.');
    assert.match(pr91Title, /DISC-01|SAFE-01/,
      'PR #91 regression fixture must preserve the leaked requirement labels. FIX: Keep the exact incident title in the test fixture.');
  });
});

describe('G37 - Launch Surface Consistency', () => {
  test('README and distilled README use repo-native delivery spine framing', () => {
    const rootReadme = fs.readFileSync(README_MD, 'utf-8');
    const distilledReadme = fs.readFileSync(DISTILLED_README_MD, 'utf-8');
    assert.match(rootReadme, /repo-native delivery spine/i,
      'README.md must describe Workspine as a repo-native delivery spine. FIX: Use the repo-native delivery spine framing in the public intro.');
    assert.match(distilledReadme, /repo-native delivery spine/i,
      'distilled/README.md must describe Workspine as a repo-native delivery spine. FIX: Align the distilled intro with the repo-native delivery spine launch framing.');
  });

  test('lead launch copy is product-first instead of origin-first', () => {
    const rootIntro = introBeforeWhatThisIs(fs.readFileSync(README_MD, 'utf-8'));
    const distilledIntro = introBeforeWhatThisIs(fs.readFileSync(DISTILLED_README_MD, 'utf-8'));
    assert.match(rootIntro, /planning, checking, execution, verification, and handoff/i,
      'README.md must lead with what the product does. FIX: Make the first explanatory paragraph describe the planning/checking/execution/verification/handoff contract.');
    assert.doesNotMatch(rootIntro, /Distilled from|Get Shit Done/i,
      'README.md lead copy must not foreground origin-story wording. FIX: Move GSD attribution out of the lead intro.');
    assert.match(distilledIntro, /planning, checking, execution, verification, and handoff/i,
      'distilled/README.md must lead with what the product does. FIX: Make the first explanatory paragraph describe the repo-native contract before any origin context.');
    assert.doesNotMatch(distilledIntro, /Distilled from|from GSD/i,
      'distilled/README.md lead copy must not foreground GSD origin wording. FIX: Move origin context out of the lead intro.');
  });

  test('phase 23 planning truth locks Workspine while retaining gsdd-cli and .planning contracts', () => {
    if (!fs.existsSync(PLANNING_SPEC_MD) || !fs.existsSync(INTERNAL_TODO_MD)) {
      return;
    }

    const planningSpec = fs.readFileSync(PLANNING_SPEC_MD, 'utf-8');
    const design = fs.readFileSync(DESIGN_MD, 'utf-8');
    const todo = fs.readFileSync(INTERNAL_TODO_MD, 'utf-8');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    assert.match(planningSpec, /Workspine/i,
      '.planning/SPEC.md must name Workspine as the active public-name target in planning truth. FIX: Record the Workspine posture explicitly.');
    assert.match(design, /Workspine/i,
      'distilled/DESIGN.md must preserve the Workspine posture rationale. FIX: Record Workspine in D45.');
    assert.match(todo, /Workspine/i,
      '.internal-research/TODO.md must carry forward the Workspine posture. FIX: Update the active milestone notes.');
    assert.match(planningSpec, /`gsdd-cli`, `gsdd`, `gsdd-\*`, and `\.planning\/`/i,
      '.planning/SPEC.md must keep the retained gsdd/.planning contracts explicit. FIX: Keep the launch posture honest about the operative contracts.');
    assert.strictEqual(pkg.name, 'gsdd-cli',
      'package.json name must remain gsdd-cli. FIX: Keep the package name stable while the public product name is still only locked in planning truth.');
  });

  test('v1.2.0 archive preserves the posture-lock handoff without reverting naming truth', () => {
    if (!fs.existsSync(PLANNING_SPEC_MD) || !fs.existsSync(PLANNING_ROADMAP_MD)) {
      return;
    }

    const planningSpec = fs.readFileSync(PLANNING_SPEC_MD, 'utf-8');
    const roadmap = fs.readFileSync(PLANNING_ROADMAP_MD, 'utf-8');
    assert.match(planningSpec, /v1\.2\.0 Fork-Honest Launch Hardening — SHIPPED|\/gsdd-new-milestone|v1\.3\.0 Engine Contract Hardening|\/gsdd-verify 29|v1\.5\.0 Brownfield Change Continuity|\/gsdd-plan 39|v1\.6 Release Spine Hardening|\/gsdd-execute 44/i,
      '.planning/SPEC.md must reflect honest milestone state after the v1.2.0 archive handoff, whether still between milestones or already in the next milestone. FIX: Keep Current State aligned to repo truth.');
    assert.match(roadmap, /Phase 24: Naming Contract Reconciliation/i,
      '.planning/ROADMAP.md must preserve the archived naming-surface reconciliation path. FIX: Keep the v1.2.0 phase chain visible after collapse.');
    assert.match(roadmap, /Phase 25: Public Proof Export/i,
      '.planning/ROADMAP.md must preserve the archived proof-export path. FIX: Keep the v1.2.0 phase chain visible after collapse.');
    assert.match(roadmap, /Phase 27: Release Packaging Audit/i,
      '.planning/ROADMAP.md must preserve the archived release-packaging path. FIX: Keep the v1.2.0 phase chain visible after collapse.');
    assert.match(roadmap, /Workspine/i,
      '.planning/ROADMAP.md must keep the Workspine handoff visible after archive. FIX: Preserve the posture-lock summary in the collapsed milestone block.');
    assert.doesNotMatch(roadmap, /Northline/,
      '.planning/ROADMAP.md must not keep Northline as the active public-name target after the Workspine lock. FIX: Remove stale Northline-specific phase wording.');
  });

  test('phase 24 public naming surfaces are Workspine-led and retire Northline', async () => {
    const rootReadme = fs.readFileSync(README_MD, 'utf-8');
    const distilledReadme = fs.readFileSync(DISTILLED_README_MD, 'utf-8');
    const userGuide = fs.readFileSync(path.join(ROOT, 'docs', 'USER-GUIDE.md'), 'utf-8');
    const brownfieldProof = fs.readFileSync(path.join(ROOT, 'docs', 'BROWNFIELD-PROOF.md'), 'utf-8');
    const runtimeSupport = fs.readFileSync(path.join(ROOT, 'docs', 'RUNTIME-SUPPORT.md'), 'utf-8');
    const verificationDiscipline = fs.readFileSync(path.join(ROOT, 'docs', 'VERIFICATION-DISCIPLINE.md'), 'utf-8');
    const security = fs.readFileSync(path.join(ROOT, 'SECURITY.md'), 'utf-8');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    const mod = await import(`file://${INIT_RUNTIME_MODULE.replace(/\\/g, '/')}`);
    const helpText = mod.getHelpText();

    for (const [label, content] of [
      ['README.md', rootReadme],
      ['distilled/README.md', distilledReadme],
      ['docs/USER-GUIDE.md', userGuide],
      ['docs/BROWNFIELD-PROOF.md', brownfieldProof],
      ['docs/RUNTIME-SUPPORT.md', runtimeSupport],
      ['docs/VERIFICATION-DISCIPLINE.md', verificationDiscipline],
      ['SECURITY.md', security],
    ]) {
      assert.match(content, /Workspine/i,
        `${label} must lead with Workspine after Phase 24. FIX: Reconcile the public naming layer to the Workspine posture.`);
      assert.doesNotMatch(content, /Northline/i,
        `${label} must not keep Northline as the active public brand after Phase 24. FIX: Remove stale Northline wording from the tracked public surface.`);
    }

    assert.match(rootReadme, /retained technical contracts/i,
      'README.md must explain that gsdd-cli/gsdd/gsdd-* /.planning remain deliberate retained contracts. FIX: Add the retained-contract explanation near the top-level intro.');
    assert.match(userGuide, /retained technical contracts/i,
      'docs/USER-GUIDE.md must explain the retained naming stack explicitly. FIX: Tell users that gsdd-cli/gsdd/gsdd-* /.planning are intentional retained contracts.');
    assert.match(rootReadme, /began as a fork of.*Get Shit Done/i,
      'README.md must keep one brief appreciative lineage note. FIX: Add a concise lineage note that acknowledges GSD/GSDD without making it the active product identity.');
    assert.match(distilledReadme, /began as a fork of.*Get Shit Done/i,
      'distilled/README.md must keep the same brief appreciative lineage note. FIX: Mirror the concise lineage note in the distilled public surface.');
    assert.match(helpText, /Workspine is the public product name; the retained package, command, workflow, and workspace contracts stay gsdd-cli, gsdd, gsdd-\*, and \.planning\//i,
      'init-runtime help text must explain the retained technical contracts explicitly. FIX: Add the Workspine-plus-retained-contract note to the help text.');
    assert.match(pkg.description, /^Workspine\b/,
      'package.json description must be Workspine-led after Phase 24. FIX: Align package metadata with the public product name.');
  });

  test('tracked public launch surfaces preserve the qualified support proof split', () => {
    const rootReadme = fs.readFileSync(README_MD, 'utf-8');
    const distilledReadme = fs.readFileSync(DISTILLED_README_MD, 'utf-8');
    assert.doesNotMatch(rootReadme, /governance_only/i,
      'README.md must not expose governance_only after Phase 21. FIX: Keep internal runtime taxonomy out of the public launch surface.');
    assert.match(rootReadme, /Qualified support:.*Cursor.*Copilot.*Gemini/i,
      'README.md must keep the qualified-support proof split explicit. FIX: Retain the qualified support launch wording near the top of the README.');
    assert.doesNotMatch(distilledReadme, /governance_only/i,
      'distilled/README.md must not expose governance_only after Phase 21. FIX: Keep internal runtime taxonomy out of the distilled launch surface.');
    assert.match(distilledReadme, /Qualified support only:.*Cursor.*Copilot.*Gemini/i,
      'distilled/README.md must keep the qualified-support proof split explicit. FIX: Retain the launch proof posture in the distilled README.');
  });

  test('README install command and package metadata stay aligned', () => {
    const rootReadme = fs.readFileSync(README_MD, 'utf-8');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    assert.match(rootReadme, /npx -y gsdd-cli init/,
      'README.md must document the published package entrypoint. FIX: Keep npx -y gsdd-cli init in the install examples.');
    assert.strictEqual(pkg.name, 'gsdd-cli',
      'package.json name must remain gsdd-cli. FIX: Keep the package name aligned with README install commands.');
    assert.strictEqual(pkg.bin.gsdd, 'bin/gsdd.mjs',
      'package.json bin.gsdd must remain bin/gsdd.mjs. FIX: Keep the gsdd command aligned with README guidance.');
  });

  test('agents.block keeps launch proof posture out of consumer governance text', () => {
    const content = fs.readFileSync(path.join(ROOT, 'distilled', 'templates', 'agents.block.md'), 'utf-8');
    assert.doesNotMatch(content, /### Public Support Wording/i,
      'agents.block.md must not define launch proof posture. FIX: Remove the public support wording section from consumer governance.');
    assert.doesNotMatch(content, /qualified support|directly validated/i,
      'agents.block.md must not duplicate public launch evidence language. FIX: Keep launch proof posture in README/package/help surfaces instead.');
  });

  test('init runtime help text preserves the proof split', async () => {
    const mod = await import(`file://${INIT_RUNTIME_MODULE.replace(/\\/g, '/')}`);
    const helpText = mod.getHelpText();
    assert.match(helpText, /directly validated launch surfaces.*Claude Code.*OpenCode.*Codex CLI/i,
      'init-runtime help text must name only the directly validated runtimes. FIX: Keep the help text aligned with launch proof.');
    assert.match(helpText, /qualified support.*shared \.agents\/skills\/ surface plus optional governance/i,
      'init-runtime help text must distinguish qualified support from directly validated native runtimes. FIX: Keep the proof split explicit in the notes.');
    assert.match(helpText, /\$gsdd-plan is plan-only until explicit \$gsdd-execute/i,
      'init-runtime help text must keep the explicit plan-to-execute boundary visible for Codex. FIX: Add the plan-only / execute-unlock note to the codex help text.');
  });
});

describe('G38 - I38 Approach-Exploration Hard Gate', () => {
  test('plan-checker.md fails closed when discuss=true and no APPROACH.md', () => {
    const checkerPath = path.join(__dirname, '..', 'distilled', 'templates', 'delegates', 'plan-checker.md');
    const content = fs.readFileSync(checkerPath, 'utf-8');
    assert.match(content, /workflow\.discuss.*true.*blocker|blocker.*workflow\.discuss.*true/is,
      'plan-checker.md approach_alignment must emit a blocker when workflow.discuss=true and no APPROACH.md is provided. FIX: Add discuss-config-aware fail-closed language to the approach_alignment dimension.');
    assert.match(content, /fix_hint/,
      'plan-checker.md approach_alignment blocker must include a fix_hint directing the planner to run approach exploration. FIX: Add fix_hint to the discuss=true blocker case.');
  });
});

describe('G49 - Native Alignment Proof Gate', () => {
  const checkerPath = path.join(ROOT, 'distilled', 'templates', 'delegates', 'plan-checker.md');
  const checkerContent = fs.readFileSync(checkerPath, 'utf-8');
  const planWorkflowPath = path.join(ROOT, 'distilled', 'workflows', 'plan.md');
  const planWorkflowContent = fs.readFileSync(planWorkflowPath, 'utf-8');
  const plannerRoleContent = fs.readFileSync(path.join(ROOT, 'agents', 'planner.md'), 'utf-8');

  test('plan-checker blocks proofless and agent-discretion-only APPROACH artifacts', () => {
    assert.match(checkerContent, /alignment_status: user_confirmed|user_confirmed/i,
      'plan-checker must recognize user_confirmed alignment proof.');
    assert.match(checkerContent, /alignment_status: approved_skip|approved_skip/i,
      'plan-checker must recognize approved_skip alignment proof.');
    assert.match(checkerContent, /agent-discretion-only proof|Agent's Discretion[\s\S]*blocker/i,
      'plan-checker must block agent-discretion-only approach proof.');
    assert.match(checkerContent, /No questions needed[\s\S]*blocker|blocker[\s\S]*No questions needed/i,
      'plan-checker must block agent-only no-questions-needed skip claims.');
  });

  test('plan-checker requires approved skip metadata', () => {
    for (const snippet of ['explicit_skip_approved: true', 'alignment_method', 'user_confirmed_at', 'skip_scope', 'skip_rationale', 'fix_hint']) {
      assert.ok(checkerContent.includes(snippet),
        `plan-checker approved-skip validation must include ${snippet}.`);
    }
  });

  test('alignment proof schema uses canonical field names across generated inputs', () => {
    const surfaces = [
      ['approach template', fs.readFileSync(path.join(ROOT, 'distilled', 'templates', 'approach.md'), 'utf-8')],
      ['approach delegate', fs.readFileSync(path.join(ROOT, 'distilled', 'templates', 'delegates', 'approach-explorer.md'), 'utf-8')],
      ['approach role', fs.readFileSync(path.join(ROOT, 'agents', 'approach-explorer.md'), 'utf-8')],
      ['plan workflow', planWorkflowContent],
      ['plan checker', checkerContent],
    ];
    for (const [label, content] of surfaces) {
      for (const field of ['alignment_status', 'alignment_method', 'user_confirmed_at', 'explicit_skip_approved', 'skip_scope', 'skip_rationale', 'confirmed_decisions']) {
        assert.ok(content.includes(field), `${label} must include canonical alignment proof field ${field}.`);
      }
    }
  });

  test('plan workflow validates existing APPROACH proof before goal-backward planning', () => {
    assert.match(planWorkflowContent, /Use existing[\s\S]{0,180}validate the alignment proof/i,
      'plan.md must not let existing APPROACH.md bypass alignment-proof validation. FIX: Validate existing APPROACH.md before goal-backward planning.');
    assert.match(planWorkflowContent, /workflow\.discuss: true[\s\S]{0,220}alignment_status: user_confirmed[\s\S]{0,80}alignment_status: approved_skip/i,
      'plan.md must require valid alignment_status proof before planning when workflow.discuss=true.');
    assert.doesNotMatch(planWorkflowContent, /Skipped when no APPROACH\.md is provided/i,
      'plan.md must not say approach_alignment is skipped when workflow.discuss=true and no APPROACH.md exists.');
  });

  test('alignment proof gate is independent of optional planCheck', () => {
    assert.match(planWorkflowContent, /workflow\.planCheck: false[\s\S]{0,220}does not skip[\s\S]{0,160}alignment-proof gate/i,
      'plan.md must keep workflow.discuss alignment proof mandatory even when workflow.planCheck=false.');
  });

  test('planner role does not bypass missing APPROACH when discuss is required', () => {
    assert.match(plannerRoleContent, /workflow\.discuss: true[\s\S]{0,140}stop[\s\S]{0,140}approach exploration/i,
      'planner role must not plan through missing APPROACH.md when workflow.discuss=true.');
    assert.doesNotMatch(plannerRoleContent, /If no APPROACH\.md exists:[\s\S]{0,120}Plan using SPEC\.md and research only[\s\S]{0,120}skip the approach_alignment dimension/i,
      'planner role must not unconditionally skip approach_alignment when APPROACH.md is missing.');
  });

  test('plan-checker input contract includes project config', () => {
    assert.match(checkerContent, /\.planning\/config\.json/i,
      'plan-checker must receive project config so workflow.discuss checks are grounded in explicit input.');
    assert.match(checkerContent, /workflow\.discuss/i,
      'plan-checker must inspect workflow.discuss from config.');
  });
});

describe('G42 - Public Proof Export', () => {
  test('public proof and support entrypoints are git-tracked before repo truth advertises them', () => {
    const requiredTrackedPaths = [
      'docs/BROWNFIELD-PROOF.md',
      'docs/RUNTIME-SUPPORT.md',
      'docs/VERIFICATION-DISCIPLINE.md',
      'docs/proof/consumer-node-cli/README.md',
      'docs/proof/consumer-node-cli/brief.md',
      'docs/proof/consumer-node-cli/SPEC.md',
      'docs/proof/consumer-node-cli/ROADMAP.md',
      'docs/proof/consumer-node-cli/phases/01-foundation/01-01-PLAN.md',
      'docs/proof/consumer-node-cli/phases/01-foundation/01-01-SUMMARY.md',
      'docs/proof/consumer-node-cli/phases/01-foundation/01-VERIFICATION.md',
    ];

    for (const relativePath of requiredTrackedPaths) {
      assert.ok(isGitTracked(relativePath),
        `${relativePath} must be git-tracked before the public proof boundary claims repo-alone truth. FIX: git add the proof/support artifact or remove the tracked-proof claim.`);
    }
  });

  test('reader-facing proof docs do not cite local-only or internal proof paths', () => {
    const publicProofSurfaces = [
      ['README.md', fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8')],
      ['distilled/README.md', fs.readFileSync(path.join(ROOT, 'distilled', 'README.md'), 'utf-8')],
      ['docs/BROWNFIELD-PROOF.md', fs.readFileSync(path.join(ROOT, 'docs', 'BROWNFIELD-PROOF.md'), 'utf-8')],
      ['docs/RUNTIME-SUPPORT.md', fs.readFileSync(path.join(ROOT, 'docs', 'RUNTIME-SUPPORT.md'), 'utf-8')],
      ['docs/VERIFICATION-DISCIPLINE.md', fs.readFileSync(path.join(ROOT, 'docs', 'VERIFICATION-DISCIPLINE.md'), 'utf-8')],
    ];
    const forbidden = [
      /\.planning\/live-proof/i,
      /22-launch-proof/i,
      /v1\.1-MILESTONE-AUDIT/i,
      /\.internal-research/i,
    ];

    for (const [label, content] of publicProofSurfaces) {
      for (const pattern of forbidden) {
        assert.doesNotMatch(content, pattern,
          `${label} must not cite local-only or internal proof surfaces. FIX: Route readers through tracked public proof docs only.`);
      }
    }

  });

  test('tracked proof pack preserves provenance notes and concrete greeting evidence', () => {
    const proofReadme = fs.readFileSync(path.join(ROOT, 'docs', 'proof', 'consumer-node-cli', 'README.md'), 'utf-8');
    const proofBrief = fs.readFileSync(path.join(ROOT, 'docs', 'proof', 'consumer-node-cli', 'brief.md'), 'utf-8');
    const verification = fs.readFileSync(path.join(ROOT, 'docs', 'proof', 'consumer-node-cli', 'phases', '01-foundation', '01-VERIFICATION.md'), 'utf-8');

    assert.match(proofReadme, /Phase 22/i,
      'docs/proof/consumer-node-cli/README.md must keep Phase 22 provenance. FIX: Add the export provenance note.');
    assert.match(proofReadme, /evidence-only/i,
      'docs/proof/consumer-node-cli/README.md must explain that the local live-proof tree is evidence-only. FIX: Add the evidence-only note.');
    assert.match(proofReadme, /release-floor/i,
      'docs/proof/consumer-node-cli/README.md must frame the pack as release-floor proof. FIX: Add the release-floor wording.');
    assert.match(proofBrief, /--name Ada/i,
      'docs/proof/consumer-node-cli/brief.md must preserve the named-greeting requirement. FIX: Keep the original brief requirement.');
    assert.match(verification, /Hello, world!/i,
      'docs/proof/consumer-node-cli/phases/01-foundation/01-VERIFICATION.md must preserve the failed default-greeting output. FIX: Keep the initial verification evidence.');
    assert.match(verification, /Hello, Ada!/i,
      'docs/proof/consumer-node-cli/phases/01-foundation/01-VERIFICATION.md must preserve the successful named-greeting output. FIX: Keep the re-verification evidence.');
  });
});

describe('G43 - Release Packaging Audit', () => {
  test('package metadata stays on the verified release floor and trims internal tarball drift', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

    assert.match(pkg.description, /^Workspine\b.*Claude Code, Codex CLI, and OpenCode/i,
      'package.json description must stay Workspine-led and name only the directly validated runtimes. FIX: Keep the description on the release-floor proof boundary.');
    for (const keyword of ['cursor', 'copilot', 'gemini', 'gemini-cli']) {
      assert.ok(!pkg.keywords.includes(keyword),
        `package.json keywords must not imply parity for ${keyword}. FIX: Keep unvalidated runtimes out of package-facing metadata.`);
    }
    for (const requiredKeyword of ['workspine', 'claude-code', 'codex-cli', 'opencode', 'multi-runtime']) {
      assert.ok(pkg.keywords.includes(requiredKeyword),
        `package.json keywords must include ${requiredKeyword}. FIX: Keep the package metadata aligned with the verified release-floor story.`);
    }
    assert.ok(!pkg.files.includes('distilled/'),
      'package.json files must not publish the entire distilled/ tree wholesale. FIX: Enumerate only the runtime-required distilled surfaces.');
    for (const requiredPath of ['distilled/DESIGN.md', 'distilled/README.md', 'distilled/templates/', 'distilled/workflows/']) {
      assert.ok(pkg.files.includes(requiredPath),
        `package.json files must include ${requiredPath}. FIX: Keep the runtime-required distilled surfaces in the published package.`);
    }
  });

  test('security and repo-owner surfaces point to the current maintainer', () => {
    const security = fs.readFileSync(path.join(ROOT, 'SECURITY.md'), 'utf-8');
    const codeowners = fs.readFileSync(path.join(ROOT, '.github', 'CODEOWNERS'), 'utf-8');

    assert.match(security, /GitHub private vulnerability reporting/i,
      'SECURITY.md must preserve GitHub private vulnerability reporting as the preferred path. FIX: Keep the preferred reporting path explicit.');
    assert.match(security, /@PatrickSys|https:\/\/github\.com\/PatrickSys/i,
      'SECURITY.md must point the fallback path to the current maintainer. FIX: Replace vague or stale owner wording with the current maintainer handle.');
    assert.doesNotMatch(security, /security@gsd\.build|@glittercowboy/i,
      'SECURITY.md must not retain upstream owner/reporting residue. FIX: Remove stale upstream reporting details.');
    assert.match(codeowners, /^# All changes require review from project owner\r?\n\* @PatrickSys\r?$/m,
      '.github/CODEOWNERS must align with the current repository owner. FIX: Replace stale upstream ownership in CODEOWNERS.');
  });

  test('release workflow audits the tarball before semantic-release publishes', () => {
    const releaseWorkflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf-8');
    const releaseConfig = fs.readFileSync(path.join(ROOT, '.releaserc.json'), 'utf-8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

    assert.match(releaseWorkflow, /Run tests[\s\S]*npm run test:gsdd/i,
      'release.yml must run the full GSDD test suite before publishing. FIX: Keep npm run test:gsdd in the release workflow.');
    assert.match(releaseWorkflow, /Audit packed tarball surface[\s\S]*npm pack --dry-run --json/i,
      'release.yml must audit the packed tarball before publishing. FIX: Add an npm pack --dry-run --json step before release.');
    assert.match(releaseWorkflow, /id-token: write/i,
      'release.yml must grant OIDC id-token write permission for npm trusted publishing. FIX: Preserve id-token: write.');
    assert.match(releaseWorkflow, /node-version: 22\.14\.0/i,
      'release.yml must use Node 22.14.0+ for npm trusted publishing. FIX: Keep setup-node on 22.14.0 or newer.');
    assert.match(releaseWorkflow, /npm install -g npm@11/i,
      'release.yml must install npm 11 for trusted publishing. FIX: Keep the npm@11 setup step.');
    assert.match(releaseWorkflow, /Verify npm trusted publisher[\s\S]*oidc\/token\/exchange\/package\/gsdd-cli[\s\S]*before running semantic-release/i,
      'release.yml must fail fast before semantic-release when npm trusted publishing is not configured. FIX: Keep the trusted-publisher preflight before Release.');
    assert.match(releaseWorkflow, /\[\[ ! "\$\{STATUS\}" =~ \^2 \]\]/,
      'release.yml must accept successful 2xx npm OIDC token exchange responses. FIX: Do not require a single hardcoded status code.');
    assert.doesNotMatch(releaseWorkflow, /registry-url: https:\/\/registry\.npmjs\.org/i,
      'release.yml must not let setup-node create placeholder npm auth that masks NPM_TOKEN fallback. FIX: Remove setup-node registry-url.');
    assert.doesNotMatch(releaseWorkflow, /loginoauth|NPM_TOKEN/i,
      'release.yml must not hand-roll npm token exchange or fall back to OTP-prone tokens. FIX: Use trusted publishing only.');
    assert.match(releaseWorkflow, /NPM_CONFIG_PROVENANCE: "true"/i,
      'release.yml must keep npm provenance enabled for semantic-release. FIX: Preserve NPM_CONFIG_PROVENANCE in the release env.');
    assert.match(releaseWorkflow, /run: npx semantic-release/i,
      'release.yml must continue to publish via semantic-release. FIX: Keep semantic-release as the release entrypoint.');
    assert.match(releaseConfig, /@semantic-release\/npm/i,
      '.releaserc.json must publish through @semantic-release/npm. FIX: Do not publish via @semantic-release/exec npm publish.');
    assert.match(releaseConfig, /@semantic-release\/github/i,
      '.releaserc.json must create GitHub Releases through @semantic-release/github. FIX: Add the GitHub plugin.');
    assert.match(releaseConfig, /"failComment": false[\s\S]*"successComment": false[\s\S]*"labels": false/s,
      '.releaserc.json must not let failed releases create GitHub issues with missing labels. FIX: Disable github fail/success comments and labels.');
    assert.doesNotMatch(releaseConfig, /@semantic-release\/exec|npm version \$\{nextRelease\.version\}|npm publish --provenance/i,
      '.releaserc.json must not use the brittle exec-based npm version/publish path. FIX: Use @semantic-release/npm.');
    assert.match(releaseConfig, /package-lock\.json/i,
      '.releaserc.json must commit package-lock.json with release metadata. FIX: Include package-lock.json in @semantic-release/git assets.');
    assert.match(packageJson.scripts.prepublishOnly || '', /GITHUB_ACTIONS.*GITHUB_REF_NAME.*main.*GITHUB_WORKFLOW.*Release/,
      'package.json must block manual or feature-branch npm publish. FIX: Keep the prepublishOnly release-workflow guard.');
    assert.match(packageJson.devDependencies['semantic-release'] || '', /\^25\./,
      'package.json must keep semantic-release on v25+ so @semantic-release/npm supports OIDC trusted publishing. FIX: Upgrade semantic-release.');
  });
});

// ---------------------------------------------------------------------------
// G39 - Health Check ID Consistency
// Prevents silent W7 drift: if a developer adds a new check to health.mjs or
// health-truth.mjs and forgets to update healthCheckIds / TRUTH_CHECK_IDS,
// W7 silently skips the new ID when comparing against DESIGN.md.
// ---------------------------------------------------------------------------
describe('G39 - Health Check ID Consistency', () => {
  test('healthCheckIds array in health.mjs matches all implemented diagnostic IDs', () => {
    const healthSource = fs.readFileSync(HEALTH_MODULE, 'utf-8');
    const healthTruthSource = fs.readFileSync(HEALTH_TRUTH_MODULE, 'utf-8');

    // Extract TRUTH_CHECK_IDS literal from health-truth.mjs
    const truthMatch = healthTruthSource.match(/export const TRUTH_CHECK_IDS\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(truthMatch,
      'health-truth.mjs must export TRUTH_CHECK_IDS as an array literal. FIX: Check export declaration.');
    const truthIds = [...truthMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

    // Extract declared healthCheckIds from health.mjs, expanding the ...TRUTH_CHECK_IDS spread
    const declaredMatch = healthSource.match(/const healthCheckIds\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(declaredMatch,
      'health.mjs must declare healthCheckIds as an array literal. FIX: Check healthCheckIds declaration.');
    const rawDeclared = declaredMatch[1].replace('...TRUTH_CHECK_IDS', truthIds.map(id => `'${id}'`).join(', '));
    const declaredIds = new Set([...rawDeclared.matchAll(/'([^']+)'/g)].map(m => m[1]));

    // Extract all implemented diagnostic IDs from id: literals in both source files
    const implementedIds = new Set();
    for (const m of healthSource.matchAll(/\bid:\s*'([EWI]\d+)'/g)) implementedIds.add(m[1]);
    for (const m of healthTruthSource.matchAll(/\bid:\s*'([EWI]\d+)'/g)) implementedIds.add(m[1]);

    const missingFromDeclared = [...implementedIds].filter(id => !declaredIds.has(id));
    const extraInDeclared = [...declaredIds].filter(id => !implementedIds.has(id));

    assert.deepStrictEqual(missingFromDeclared, [],
      `healthCheckIds is missing IDs implemented in source: ${missingFromDeclared.join(', ')}. FIX: Add the missing IDs to the healthCheckIds array in health.mjs.`);
    assert.deepStrictEqual(extraInDeclared, [],
      `healthCheckIds declares IDs with no matching diagnostic push: ${extraInDeclared.join(', ')}. FIX: Remove the extra IDs or add the missing push call.`);
  });

  test('TRUTH_CHECK_IDS matches the diagnostic IDs implemented in health-truth.mjs', () => {
    const healthTruthSource = fs.readFileSync(HEALTH_TRUTH_MODULE, 'utf-8');

    const truthMatch = healthTruthSource.match(/export const TRUTH_CHECK_IDS\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(truthMatch,
      'health-truth.mjs must export TRUTH_CHECK_IDS as an array literal. FIX: Check export declaration.');
    const declaredTruthIds = new Set([...truthMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]));

    const implementedTruthIds = new Set(
      [...healthTruthSource.matchAll(/\bid:\s*'([EWI]\d+)'/g)].map(m => m[1])
    );

    const missing = [...implementedTruthIds].filter(id => !declaredTruthIds.has(id));
    const extra = [...declaredTruthIds].filter(id => !implementedTruthIds.has(id));

    assert.deepStrictEqual(missing, [],
      `TRUTH_CHECK_IDS is missing IDs implemented in health-truth.mjs: ${missing.join(', ')}. FIX: Add the missing IDs to the TRUTH_CHECK_IDS export in health-truth.mjs.`);
    assert.deepStrictEqual(extra, [],
      `TRUTH_CHECK_IDS declares IDs with no matching warning push in health-truth.mjs: ${extra.join(', ')}. FIX: Remove the extra IDs or add the missing push call.`);
  });

});

describe('G44 - Engine Contract Hardening', () => {
  test('lifecycle-state helper exists as the shared evaluator seam', () => {
    assert.ok(fs.existsSync(LIFECYCLE_STATE_MODULE),
      'bin/lib/lifecycle-state.mjs must exist. FIX: Add the shared lifecycle evaluator helper.');
  });

  test('lifecycle-preflight helper exists and reuses lifecycle-state', async () => {
    assert.ok(fs.existsSync(LIFECYCLE_PREFLIGHT_MODULE),
      'bin/lib/lifecycle-preflight.mjs must exist. FIX: Add the deterministic lifecycle preflight helper.');

    const preflightSource = fs.readFileSync(LIFECYCLE_PREFLIGHT_MODULE, 'utf-8');
    assert.match(preflightSource, /from '\.\/lifecycle-state\.mjs'/,
      'lifecycle-preflight.mjs must import lifecycle-state.mjs. FIX: Layer preflight decisions over the shared evaluator.');
    assert.match(preflightSource, /evaluateLifecycleState\(/,
      'lifecycle-preflight.mjs must evaluate lifecycle state via the shared helper. FIX: Do not reparse roadmap/spec state locally.');

    const mod = await import(`file://${LIFECYCLE_PREFLIGHT_MODULE.replace(/\\/g, '/')}`);
    assert.strictEqual(typeof mod.evaluateLifecyclePreflight, 'function',
      'lifecycle-preflight.mjs must export evaluateLifecyclePreflight. FIX: Export the shared preflight evaluator.');
    assert.strictEqual(typeof mod.cmdLifecyclePreflight, 'function',
      'lifecycle-preflight.mjs must export cmdLifecyclePreflight. FIX: Export the CLI handler.');
  });

  test('health and health-truth both consume the shared lifecycle evaluator', () => {
    const healthSource = fs.readFileSync(HEALTH_MODULE, 'utf-8');
    const truthSource = fs.readFileSync(HEALTH_TRUTH_MODULE, 'utf-8');

    assert.match(healthSource, /from '\.\/lifecycle-state\.mjs'/,
      'health.mjs must import lifecycle-state.mjs. FIX: Route lifecycle interpretation through the shared evaluator.');
    assert.match(healthSource, /evaluateLifecycleState\(\{ planningDir \}\)/,
      'health.mjs must evaluate lifecycle state once per run. FIX: Replace ad hoc lifecycle parsing with the shared helper.');
    assert.match(truthSource, /from '\.\/lifecycle-state\.mjs'/,
      'health-truth.mjs must import lifecycle-state.mjs. FIX: Route requirement/lifecycle truth checks through the shared evaluator.');
    assert.match(truthSource, /requirementAlignment\.mismatches/,
      'health-truth.mjs must consume requirementAlignment from the shared evaluator. FIX: Remove the duplicate ROADMAP/SPEC parser.');
  });

  test('internal truth surfaces preserve the dual-canonical runtime story and engine-only deferral boundary', () => {
    if (![PLANNING_SPEC_MD, PLANNING_ROADMAP_MD, INTERNAL_TODO_MD, path.join(ROOT, '.internal-research', 'gaps.md')].every(fs.existsSync)) {
      return;
    }
    const planningSpec = fs.readFileSync(PLANNING_SPEC_MD, 'utf-8');
    const roadmap = fs.readFileSync(PLANNING_ROADMAP_MD, 'utf-8');
    const todo = fs.readFileSync(INTERNAL_TODO_MD, 'utf-8');
    const gaps = fs.readFileSync(path.join(ROOT, '.internal-research', 'gaps.md'), 'utf-8');
    const design = fs.readFileSync(DESIGN_MD, 'utf-8');

    assert.match(planningSpec, /dual-canonical/i,
      '.planning/SPEC.md must describe the runtime contract as dual-canonical. FIX: Narrow ENGINE-05 and milestone wording to the authoring/runtime-consumed split.');
    assert.match(planningSpec, /owned artifacts.*distinct from lifecycle-state mutation|artifact ownership.*lifecycle-state mutation/i,
      '.planning/SPEC.md must distinguish owned artifact writes from lifecycle-state mutation. FIX: Tighten ENGINE-01 wording.');
    assert.match(roadmap, /dual-canonical/i,
      '.planning/ROADMAP.md must carry the dual-canonical runtime wording into the active runtime milestone. FIX: Update the phase success criteria.');
    assert.match(todo, /dual-canonical/i,
      '.internal-research/TODO.md must carry the dual-canonical runtime story into the next-session handoff. FIX: Update the active milestone notes.');
    assert.match(gaps, /claim contradiction narrowed|dual-canonical|freshness enforcement/i,
      '.internal-research/gaps.md must narrow I42 to the remaining freshness/enforcement seam. FIX: Re-scope I42 after claim narrowing.');
    assert.match(design, /dual-canonical/i,
      'distilled/DESIGN.md must record the Phase 29 dual-canonical/runtime contract decision. FIX: Add a durable design decision for the shared evaluator and runtime-story split.');
    assert.match(todo, /launch identity\/naming audit explicitly deferred|launch identity.*deferred/i,
      '.internal-research/TODO.md must keep the launch identity follow-up deferred. FIX: Preserve the engine-only milestone boundary in the handoff.');
  });

  test('transition-sensitive workflow contracts route through lifecycle-preflight while progress stays read-only', () => {
    const workflowsDir = path.join(ROOT, 'distilled', 'workflows');
    const checks = [
      ['plan.md', /node \.planning\/bin\/gsdd\.mjs lifecycle-preflight plan \{phase_num\}/],
      ['execute.md', /node \.planning\/bin\/gsdd\.mjs lifecycle-preflight execute \{phase_num\} --expects-mutation phase-status/],
      ['verify.md', /node \.planning\/bin\/gsdd\.mjs lifecycle-preflight verify \{phase_num\} --expects-mutation phase-status/],
      ['audit-milestone.md', /node \.planning\/bin\/gsdd\.mjs lifecycle-preflight audit-milestone/],
      ['complete-milestone.md', /node \.planning\/bin\/gsdd\.mjs lifecycle-preflight complete-milestone/],
      ['new-milestone.md', /node \.planning\/bin\/gsdd\.mjs lifecycle-preflight new-milestone/],
      ['resume.md', /node \.planning\/bin\/gsdd\.mjs lifecycle-preflight resume/],
    ];

    for (const [file, pattern] of checks) {
      const content = fs.readFileSync(path.join(workflowsDir, file), 'utf-8');
      assert.match(content, pattern,
        `${file} must route lifecycle eligibility through node .planning/bin/gsdd.mjs lifecycle-preflight. FIX: Restore the shared preflight invocation.`);
    }

    const progress = fs.readFileSync(path.join(workflowsDir, 'progress.md'), 'utf-8');
    assert.match(progress, /progress` stays read-only|progress stays read-only/i,
      'progress.md must preserve the read-only lifecycle boundary. FIX: Keep the lifecycle_boundary read-only language.');
    assert.match(progress, /Do not call `node \.planning\/bin\/gsdd\.mjs phase-status` here\./,
      'progress.md must forbid lifecycle mutation via node .planning/bin/gsdd.mjs phase-status. FIX: Keep the explicit mutation ban.');
    assert.match(progress, /downstream mutating workflow must rerun its own `node \.planning\/bin\/gsdd\.mjs lifecycle-preflight \.\.\.` gate before acting/i,
      'progress.md must push downstream lifecycle transitions back through the repo-local helper launcher. FIX: Keep the downstream rerun instruction.');
  });

  test('closure-sensitive workflows preserve the shared evidence-gated closure contract', () => {
    const verify = fs.readFileSync(path.join(ROOT, 'distilled', 'workflows', 'verify.md'), 'utf-8');
    const audit = fs.readFileSync(path.join(ROOT, 'distilled', 'workflows', 'audit-milestone.md'), 'utf-8');
    const complete = fs.readFileSync(path.join(ROOT, 'distilled', 'workflows', 'complete-milestone.md'), 'utf-8');

    for (const [label, content] of [
      ['verify.md', verify],
      ['audit-milestone.md', audit],
      ['complete-milestone.md', complete],
    ]) {
      assert.match(content, /code.*test.*runtime.*delivery.*human/s,
        `${label} must preserve the stable evidence-kind vocabulary. FIX: Add all five closure evidence kinds.`);
      assert.match(content, /repo_only/,
        `${label} must preserve repo_only delivery posture language. FIX: Add the shared repo_only posture.`);
      assert.match(content, /delivery_sensitive/,
        `${label} must preserve delivery_sensitive posture language. FIX: Add the shared delivery_sensitive posture.`);
    }

    assert.match(audit, /required_kinds.*observed_kinds.*missing_kinds/s,
      'audit-milestone.md must record evidence_contract.required_kinds|observed_kinds|missing_kinds in frontmatter. FIX: Add the shared audit evidence block.');
    assert.match(complete, /missing required kinds|missing_kinds/i,
      'complete-milestone.md must fail closed when the passed audit still lacks required closure evidence. FIX: Add the audit evidence gate.');
  });
});

describe('G45 - Runtime Surface Freshness Contract', () => {
  test('runtime-freshness helper exists and health truth includes W11', () => {
    const runtimeFreshnessModule = path.join(ROOT, 'bin', 'lib', 'runtime-freshness.mjs');
    assert.ok(fs.existsSync(runtimeFreshnessModule),
      'bin/lib/runtime-freshness.mjs must exist. FIX: Add the shared renderer-backed runtime freshness helper.');

    const runtimeFreshnessSource = fs.readFileSync(runtimeFreshnessModule, 'utf-8');
    const truthSource = fs.readFileSync(HEALTH_TRUTH_MODULE, 'utf-8');
    assert.match(truthSource, /W11/,
      'health-truth.mjs must register W11. FIX: Add the generated-surface freshness warning ID.');
    assert.match(truthSource, /getRuntimeFreshnessRepairGuidance/,
      'health-truth.mjs must route W11 repair text through the shared runtime-freshness helper. FIX: Use getRuntimeFreshnessRepairGuidance for the W11 fix field.');
    assert.match(runtimeFreshnessSource, /npx -y gsdd-cli update/i,
      'runtime-freshness.mjs must keep npx -y gsdd-cli update as the deterministic human repair path. FIX: Preserve the npx-first update guidance in getRuntimeFreshnessRepairGuidance.');
  });

  test('runtime-facing docs and help describe rendered freshness checks briefly and consistently', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const support = fs.readFileSync(path.join(ROOT, 'docs', 'RUNTIME-SUPPORT.md'), 'utf-8');
    const helpSource = fs.readFileSync(INIT_RUNTIME_MODULE, 'utf-8');
    const planWorkflow = fs.readFileSync(path.join(ROOT, 'distilled', 'workflows', 'plan.md'), 'utf-8');

    assert.match(readme, /gsdd health.*render output|current render output/i,
      'README.md must explain that generated runtime surfaces are checked against current render output. FIX: Add the runtime-surface freshness note.');
    assert.match(readme, /npx -y gsdd-cli update|gsdd update/i,
      'README.md must include deterministic repair guidance through npx -y gsdd-cli update or global gsdd update. FIX: Add the repair path.');
    assert.match(support, /Generated-surface freshness/i,
      'docs/RUNTIME-SUPPORT.md must have a generated-surface freshness section. FIX: Add the explicit runtime-boundary section.');
    assert.match(helpSource, /gsdd-cli health.*gsdd-cli update|gsdd health.*gsdd update/i,
      'bin/lib/init-runtime.mjs help text must mention health/update runtime-surface drift handling. FIX: Add the note to getHelpText().');
    assert.match(planWorkflow, /gsdd-cli health.*gsdd-cli update|gsdd health.*gsdd update/i,
      'distilled/workflows/plan.md must mention the renderer-backed freshness/repair path. FIX: Add the runtime-surface trust note to completion.');
  });
});

describe('G40 - Provenance And Write-Gate Contracts', () => {
  const workflowsDir = path.join(ROOT, 'distilled', 'workflows');

  test('pause.md enforces draft-first checkpointing with a three-question cap', () => {
    const content = fs.readFileSync(path.join(workflowsDir, 'pause.md'), 'utf-8');
    assert.match(content, /Build a draft checkpoint from artifact truth/i,
      'pause.md must require draft-first checkpointing. FIX: Add artifact-derived draft wording to <gather_state>.');
    assert.match(content, /Ask at most 3 high-signal questions total/i,
      'pause.md must cap checkpoint corrections at 3 questions. FIX: Add the three-question cap to <gather_state>.');
  });

  test('resume.md reconciles checkpoint, planning, and git/worktree truth with explicit mismatch acknowledgement', () => {
    const content = fs.readFileSync(path.join(workflowsDir, 'resume.md'), 'utf-8');
    assert.match(content, /checkpoint narrative truth/i,
      'resume.md must name checkpoint narrative truth. FIX: Add it to provenance reconciliation.');
    assert.match(content, /planning\/artifact truth/i,
      'resume.md must name planning/artifact truth. FIX: Add it to provenance reconciliation.');
    assert.match(content, /git\/worktree truth/i,
      'resume.md must name git/worktree truth. FIX: Add it to provenance reconciliation.');
    assert.match(content, /require explicit acknowledgement/i,
      'resume.md must require explicit acknowledgement on material mismatch. FIX: Add acknowledgement gating to determine_action/present_options.');
    assert.match(content, /bare "continue" skip the warning/i,
      'resume.md must forbid bare "continue" on material mismatch. FIX: Keep the mismatch acknowledgement warning in present_options.');
  });

  test('resume and progress share the generic-checkpoint ownership split', () => {
    const resume = fs.readFileSync(path.join(workflowsDir, 'resume.md'), 'utf-8');
    const progress = fs.readFileSync(path.join(workflowsDir, 'progress.md'), 'utf-8');

    assert.match(resume, /generic.*next_action.*user decide/i,
      'resume.md must keep generic checkpoints resume-readable instead of auto-consuming them. FIX: Preserve the generic next_action routing.');
    assert.match(resume, /downstream read-only `?progress`? routing.*informational context rather than an automatic blocker/i,
      'resume.md must state that post-resume generic checkpoints are informational to progress. FIX: Add the shared ownership split.');
    assert.match(progress, /`?generic`? checkpoints? (?:are|stay) informational-only/i,
      'progress.md must treat generic checkpoints as informational-only. FIX: Keep the explicit informational rule.');
    assert.match(progress, /do \*\*not\*\* route back through Branch A|keep evaluating Branch B-F/i,
      'progress.md must route past informational generic checkpoints instead of bouncing back to /gsdd-resume. FIX: Keep the non-looping routing note.');
    assert.match(progress, /`?phase`? and `?quick`?.*blocking resume-owned surfaces/i,
      'progress.md must preserve stronger routing for phase and quick checkpoints. FIX: Keep the blocking checkpoint wording.');
  });

  test('transition-sensitive workflows reuse stale-branch and mixed-scope warning language', () => {
    const checks = [
      ['plan.md', /stale\/spent|mixed-scope/i],
      ['quick.md', /stale\/spent|mixed-scope/i],
      ['new-milestone.md', /stale\/spent|mixed-scope/i],
      ['complete-milestone.md', /mixed-scope|stale branch/i],
      ['execute.md', /stale\/spent|mixed-scope/i],
    ];

    for (const [file, pattern] of checks) {
      const content = fs.readFileSync(path.join(workflowsDir, file), 'utf-8');
      assert.match(content, pattern,
        `${file} must preserve transition-safety warning language. FIX: Add stale/mixed integration-surface warnings.`);
    }
  });

  test('verify and audit-milestone fail closed on missing terminal artifacts', () => {
    const verify = fs.readFileSync(path.join(workflowsDir, 'verify.md'), 'utf-8');
    const audit = fs.readFileSync(path.join(workflowsDir, 'audit-milestone.md'), 'utf-8');

    assert.match(verify, /Before any ROADMAP closure.*SUMMARY\.md.*still exists on disk/i,
      'verify.md must confirm SUMMARY.md exists before ROADMAP closure. FIX: Add the fail-closed summary existence gate.');
    assert.match(audit, /Do NOT downgrade a write failure into "results shown inline anyway\."/i,
      'audit-milestone.md must not present durable results when the audit file was not written. FIX: Keep the fail-closed write gate wording.');
  });
});
