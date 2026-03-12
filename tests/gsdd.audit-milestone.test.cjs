/**
 * GSDD CLI Tests - Audit Milestone
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  cleanup,
  createTempProject,
  loadGsdd,
  setNonInteractiveStdin,
} = require('./gsdd.helpers.cjs');

describe('gsdd audit-milestone', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('init generates audit-milestone skill', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const skillPath = path.join(tmpDir, '.agents', 'skills', 'gsdd-audit-milestone', 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), 'audit-milestone skill must exist');

    const content = fs.readFileSync(skillPath, 'utf-8');
    assert.match(content, /MILESTONE-AUDIT\.md/i, 'must reference MILESTONE-AUDIT.md output');
    assert.match(content, /gaps_found/, 'must include gaps_found status');
    assert.match(content, /orphan/i, 'must include orphan detection');
    assert.match(content, /integration.checker/i, 'must reference integration checker');
    assert.match(content, /3-source|three.*source/i, 'must reference 3-source cross-reference');
    assert.match(content, /Status Determination Matrix|VERIFICATION.*Status.*SUMMARY.*Frontmatter/i, 'must include status determination matrix');
    assert.doesNotMatch(content, /â|ðŸ|âœ|â†/, 'must not contain mojibake');
  });

  test('integration-checker role distributed to consumers', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const rolePath = path.join(tmpDir, '.planning', 'templates', 'roles', 'integration-checker.md');
    assert.ok(fs.existsSync(rolePath), 'integration-checker role must be distributed');

    const content = fs.readFileSync(rolePath, 'utf-8');
    assert.match(content, /Existence/i, 'must contain core principle keyword "Existence"');
    assert.match(content, /Integration/i, 'must contain core principle keyword "Integration"');
    assert.match(content, /Export.*Import/i, 'must contain Export->Import semantic check pattern');
    assert.match(content, /API.*Consumer/i, 'must contain API->Consumer semantic check pattern');
    assert.doesNotMatch(content, /find src\/app\/api/, 'must not contain framework-specific bash');
    assert.doesNotMatch(content, /grep -r "useAuth"/, 'must not contain framework-specific grep');
    assert.doesNotMatch(content, /--include="\*\.tsx"/, 'must not contain file-type-specific flags');
  });

  test('FAIL gate and cross-reference preserved', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const skillPath = path.join(tmpDir, '.agents', 'skills', 'gsdd-audit-milestone', 'SKILL.md');
    const content = fs.readFileSync(skillPath, 'utf-8');

    assert.match(content, /unsatisfied/, 'must include unsatisfied requirement language');
    assert.match(content, /orphan/i, 'must include orphan detection language');
    assert.match(content, /passed/, 'must include passed status');
    assert.match(content, /gaps_found/, 'must include gaps_found status');
    assert.match(content, /tech_debt/, 'must include tech_debt status');
    assert.match(content, /SPEC\.md/, 'must reference SPEC.md as requirements source');
    assert.doesNotMatch(content, /REQUIREMENTS\.md/, 'must NOT reference REQUIREMENTS.md (GSD-specific)');
  });

  test('verifier scope boundary updated', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const verifySkillPath = path.join(tmpDir, '.agents', 'skills', 'gsdd-verify', 'SKILL.md');
    const content = fs.readFileSync(verifySkillPath, 'utf-8');

    assert.match(content, /does not claim milestone-wide integration completeness/i, 'verifier must still disclaim milestone scope');
    assert.match(content, /audit-milestone|milestone-audit/i, 'verifier must reference the audit surface');
    assert.doesNotMatch(content, /deferred.*milestone.*audit/i, 'verifier must no longer call the audit surface "deferred"');
  });

  test('role count is 9', async () => {
    const agentsDir = path.join(__dirname, '..', 'agents');
    const roleFiles = fs.readdirSync(agentsDir).filter(
      f => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_')
    );

    assert.strictEqual(roleFiles.length, 9, `Expected 9 role files, found ${roleFiles.length}: ${roleFiles.join(', ')}`);
    assert.ok(roleFiles.includes('integration-checker.md'), 'integration-checker.md must exist in agents/');
  });
});
