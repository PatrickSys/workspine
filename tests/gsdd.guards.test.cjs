/**
 * GSDD Code-Structure Guards
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GSDD_PATH = path.join(ROOT, 'bin', 'gsdd.mjs');
const MODELS_MODULE = path.join(ROOT, 'bin', 'lib', 'models.mjs');
const MANIFEST_MODULE = path.join(ROOT, 'bin', 'lib', 'manifest.mjs');
const HEALTH_MODULE = path.join(ROOT, 'bin', 'lib', 'health.mjs');
const INIT_MODULE = path.join(ROOT, 'bin', 'lib', 'init.mjs');
const TEMPLATES_MODULE = path.join(ROOT, 'bin', 'lib', 'templates.mjs');
const README_MD = path.join(ROOT, 'README.md');
const DISTILLED_README_MD = path.join(ROOT, 'distilled', 'README.md');

function lineCount(filePath) {
  return fs.readFileSync(filePath, 'utf-8').split('\n').length;
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

  test('help text mentions health command', () => {
    const initSource = fs.readFileSync(path.join(ROOT, 'bin', 'lib', 'init.mjs'), 'utf-8');
    assert.match(initSource, /health/,
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

  test('DISTILLATION.md contains all 9 canonical role names', () => {
    const content = fs.readFileSync(DISTILLATION_PATH, 'utf-8');
    const roles = ['mapper', 'researcher', 'synthesizer', 'planner', 'roadmapper', 'executor', 'verifier', 'integration-checker', 'debugger'];
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
    assert.match(content, /10 delegates/,
      'D22 must document delegate count. FIX: Add delegate count to D22.');
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
    assert.strictEqual(actualFiles.length, 10,
      `Expected 10 delegate files, found ${actualFiles.length}. FIX: Update delegate count.`);
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

  // G18.1: agents.block.md lists all workflow skills
  test('agents.block.md lists all WORKFLOWS entries as skill paths', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    for (const name of workflowNames) {
      assert.ok(
        content.includes(`.agents/skills/${name}/SKILL.md`),
        `agents.block.md missing skill path for ${name}. FIX: Add ".agents/skills/${name}/SKILL.md" to the "Where The Workflows Live" section.`
      );
    }
  });

  test('agents.block.md workflow skill count matches WORKFLOWS array length', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    // Count only in the "Where The Workflows Live" section
    const section = content.slice(content.indexOf('Where The Workflows Live'));
    const skillPaths = [...section.matchAll(/\.agents\/skills\/gsdd-[a-z-]+\/SKILL\.md/g)];
    assert.strictEqual(skillPaths.length, workflowNames.length,
      `agents.block.md "Where The Workflows Live" has ${skillPaths.length} skill paths but WORKFLOWS has ${workflowNames.length}. FIX: Sync agents.block.md to match WORKFLOWS array.`);
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

  test('README invocation table includes "open SKILL.md" guidance for non-native platforms', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.match(readme, /Cursor.*Copilot.*Gemini.*Open.*SKILL\.md/i,
      'README invocation table must tell non-native platforms to open SKILL.md. FIX: Add SKILL.md guidance for governance-only platforms.');
  });

  test('README contains a Quickstart section', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.match(readme, /### Quickstart/,
      'README.md must contain a Quickstart section. FIX: Add ### Quickstart section after Getting Started.');
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

  test('agents.block.md contains "How To Invoke Workflows" section', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    assert.match(content, /### How To Invoke Workflows/,
      'agents.block.md must have "How To Invoke Workflows" section. FIX: Add ### How To Invoke Workflows section.');
  });

  test('agents.block.md invocation section mentions Claude/OpenCode slash commands', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    assert.match(content, /Claude Code.*OpenCode.*slash command|slash command.*\/gsdd-/i,
      'agents.block.md invocation must mention slash commands for Claude/OpenCode. FIX: Add slash command guidance.');
  });

  test('agents.block.md invocation section mentions Codex skill references', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    assert.match(content, /Codex.*skill reference|\$gsdd-/,
      'agents.block.md invocation must mention Codex skill references. FIX: Add skill reference guidance for Codex.');
  });

  test('agents.block.md invocation section mentions opening SKILL.md for other tools', () => {
    const content = fs.readFileSync(AGENTS_BLOCK, 'utf-8');
    assert.match(content, /[Oo]pen the SKILL\.md file/,
      'agents.block.md invocation must mention opening SKILL.md for other tools. FIX: Add SKILL.md guidance for non-native tools.');
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

  test('DESIGN.md ToC lists 28 entries', () => {
    const content = fs.readFileSync(DESIGN_PATH, 'utf-8');
    const tocEntries = (content.match(/^\d+\. \[/gm) || []);
    assert.strictEqual(tocEntries.length, 28,
      `DESIGN.md ToC has ${tocEntries.length} entries, expected 28. FIX: Update DESIGN.md ToC to list all 28 decisions.`);
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
    assert.match(section, /\/gsdd:plan|needs planning/i, 'determine_action must route to plan. FIX: Add planning branch.');
    assert.match(section, /\/gsdd:verify|needs verification/i, 'determine_action must route to verify. FIX: Add verification branch.');
    assert.match(section, /\/gsdd:audit-milestone|All phases complete/i, 'determine_action must route to audit-milestone. FIX: Add all-phases-complete branch.');
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
    assert.match(section, /Branch F/i, 'route_action must have Branch F (between milestones). FIX: Add Branch F.');
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

  test('resume <determine_action> routes to workflows that exist in the 10-workflow set', () => {
    const content = fs.readFileSync(RESUME_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<determine_action>'), content.indexOf('</determine_action>'));
    const workflows = section.match(/\/gsdd:[\w-]+/g) || [];
    const validWorkflows = [
      '/gsdd:new-project', '/gsdd:plan', '/gsdd:execute', '/gsdd:verify',
      '/gsdd:audit-milestone', '/gsdd:quick', '/gsdd:pause', '/gsdd:resume',
      '/gsdd:progress', '/gsdd:map-codebase'
    ];
    for (const wf of workflows) {
      assert.ok(validWorkflows.includes(wf),
        `resume.md references unknown workflow ${wf}. FIX: Use only valid workflow references.`);
    }
    assert.ok(workflows.length >= 3,
      `resume.md determine_action must route to at least 3 workflows, found ${workflows.length}. FIX: Add routing branches.`);
  });

  test('progress <route_action> routes to workflows that exist in the 10-workflow set', () => {
    const content = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    const section = content.slice(content.indexOf('<route_action>'), content.indexOf('</route_action>'));
    const workflows = section.match(/\/gsdd:\w[\w-]*/g) || [];
    const validWorkflows = [
      '/gsdd:new-project', '/gsdd:plan', '/gsdd:execute', '/gsdd:verify',
      '/gsdd:audit-milestone', '/gsdd:quick', '/gsdd:pause', '/gsdd:resume',
      '/gsdd:progress', '/gsdd:map-codebase'
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

  test('Troubleshooting mentions gsdd health as first step', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    const tsStart = readme.indexOf('## Troubleshooting');
    const tsEnd = readme.indexOf('\n## ', tsStart + 1);
    const section = readme.slice(tsStart, tsEnd > -1 ? tsEnd : tsStart + 1000);
    assert.match(section, /gsdd health/,
      'Troubleshooting must mention gsdd health as first step. FIX: Add gsdd health as first troubleshooting step.');
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
      assert.match(section, /\/gsdd:/,
        `${wf} completion must reference at least one /gsdd: command. FIX: Add next-step routing to <completion>.`);
    });
  }

  // Specific routing correctness: each lifecycle workflow routes to the right next step
  test('new-project.md completion routes to /gsdd:plan', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-project.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    assert.match(section, /\/gsdd:plan/,
      'new-project completion must route to /gsdd:plan. FIX: Add /gsdd:plan as next step in completion.');
  });

  test('plan.md completion routes to /gsdd:execute', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'plan.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    assert.match(section, /\/gsdd:execute/,
      'plan completion must route to /gsdd:execute. FIX: Add /gsdd:execute as next step in completion.');
  });

  test('execute.md completion routes to /gsdd:verify or /gsdd:progress', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'execute.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    const hasVerify = /\/gsdd:verify/.test(section);
    const hasProgress = /\/gsdd:progress/.test(section);
    assert.ok(hasVerify || hasProgress,
      'execute completion must route to /gsdd:verify or /gsdd:progress. FIX: Add next-step routing to execute completion.');
  });

  test('verify.md completion routes to /gsdd:progress or /gsdd:plan', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'verify.md'), 'utf-8');
    const section = content.slice(content.indexOf('<completion>'), content.indexOf('</completion>'));
    const hasProgress = /\/gsdd:progress/.test(section);
    const hasPlan = /\/gsdd:plan/.test(section);
    assert.ok(hasProgress || hasPlan,
      'verify completion must route to /gsdd:progress or /gsdd:plan. FIX: Add next-step routing to verify completion.');
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
