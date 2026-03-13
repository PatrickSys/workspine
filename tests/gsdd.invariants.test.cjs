/**
 * GSDD Framework Invariant Tests
 *
 * Guards structural properties that must hold across all roles, delegates,
 * and workflows. Catches drift that PRs #12-17 repeatedly fixed manually.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const AGENTS_DIR = path.join(__dirname, '..', 'agents');
const DELEGATES_DIR = path.join(__dirname, '..', 'distilled', 'templates', 'delegates');
const WORKFLOWS_DIR = path.join(__dirname, '..', 'distilled', 'workflows');

// --- Helpers ---

function getRoleFiles() {
  return fs.readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_'))
    .sort();
}

function getDelegateFiles() {
  return fs.readdirSync(DELEGATES_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();
}

function getWorkflowFiles() {
  return fs.readdirSync(WORKFLOWS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();
}

function readRole(filename) {
  return fs.readFileSync(path.join(AGENTS_DIR, filename), 'utf-8');
}

function readDelegate(filename) {
  return fs.readFileSync(path.join(DELEGATES_DIR, filename), 'utf-8');
}

function readWorkflow(filename) {
  return fs.readFileSync(path.join(WORKFLOWS_DIR, filename), 'utf-8');
}

// Roles that received S12 hardening (XML-bounded sections)
const HARDENED_ROLES = [
  'executor.md',
  'integration-checker.md',
  'planner.md',
  'roadmapper.md',
  'synthesizer.md',
  'verifier.md',
];

// --- I2: Role Section Structure ---

describe('I2 — Role Section Structure', () => {
  const roles = getRoleFiles();

  test('all 9 canonical roles exist', () => {
    assert.strictEqual(roles.length, 9, `Expected 9 roles, got ${roles.length}: ${roles.join(', ')}`);
  });

  for (const role of getRoleFiles()) {
    test(`${role} has role definition`, () => {
      const content = readRole(role);
      const hasXmlRole = content.includes('<role>');
      const hasResponsibility = /^## Responsibility/m.test(content);
      assert.ok(
        hasXmlRole || hasResponsibility,
        `${role} must have <role> XML section or ## Responsibility header`
      );
    });

    test(`${role} has scope boundary`, () => {
      const content = readRole(role);
      const hasScopeBoundary = content.includes('<scope_boundary>');
      const hasXmlRole = content.includes('<role>'); // <role> implicitly bounds scope
      const hasScopeHeader = /^## Scope\b/m.test(content);
      const hasResponsibility = /^## Responsibility/m.test(content);
      const isUtility = content.includes('utility role');
      assert.ok(
        hasScopeBoundary || hasXmlRole || hasScopeHeader || hasResponsibility || isUtility,
        `${role} must define its scope via <scope_boundary>, <role>, ## Scope, ## Responsibility, or utility role marker`
      );
    });

    test(`${role} has output format`, () => {
      const content = readRole(role);
      const hasXmlOutput = /<output>|<output_format>|<report_format>/.test(content);
      const hasOutputHeader = /^## Output Contract|^## Output\b/m.test(content);
      assert.ok(
        hasXmlOutput || hasOutputHeader,
        `${role} must define output format`
      );
    });
  }

  // success_criteria only checked for hardened lifecycle roles
  for (const role of HARDENED_ROLES) {
    test(`${role} has <success_criteria>`, () => {
      const content = readRole(role);
      assert.ok(
        content.includes('<success_criteria>'),
        `${role} must have <success_criteria> section`
      );
    });
  }
});

// --- I10: Mandatory Initial-Read ---

describe('I10 — Mandatory Initial-Read', () => {
  for (const role of HARDENED_ROLES) {
    test(`${role} enforces mandatory initial-read`, () => {
      const content = readRole(role);
      const hasInitialRead = /[Mm]andatory initial.read/i.test(content);
      assert.ok(
        hasInitialRead,
        `${role} must enforce mandatory initial-read discipline`
      );
    });
  }

  test('debugger is exempt from mandatory initial-read', () => {
    const content = readRole('debugger.md');
    assert.ok(
      content.includes('utility role'),
      'debugger.md must be marked as utility role (exempt from lifecycle requirements)'
    );
  });
});

// --- I1: Delegate-Role References ---

describe('I1 — Delegate-Role References', () => {
  const delegates = getDelegateFiles();

  test('exactly 10 delegates exist', () => {
    assert.strictEqual(delegates.length, 10, `Expected 10 delegates, got ${delegates.length}: ${delegates.join(', ')}`);
  });

  for (const delegate of getDelegateFiles()) {
    test(`${delegate} references a role contract path`, () => {
      const content = readDelegate(delegate);
      const roleRef = content.match(/\.planning\/templates\/roles\/(\S+\.md)/);
      assert.ok(
        roleRef,
        `${delegate} must reference a .planning/templates/roles/<role>.md path`
      );
    });

    test(`${delegate} references an existing role`, () => {
      const content = readDelegate(delegate);
      const roleRef = content.match(/\.planning\/templates\/roles\/(\S+\.md)/);
      if (!roleRef) {
        assert.fail(`${delegate} has no role reference to validate`);
        return;
      }
      const roleName = roleRef[1];
      const roleExists = fs.existsSync(path.join(AGENTS_DIR, roleName));
      assert.ok(
        roleExists,
        `${delegate} references role ${roleName} which must exist in agents/`
      );
    });
  }
});

// --- I9: No Deprecated Content ---

describe('I9 — No Deprecated Content', () => {
  const allFiles = [
    ...getRoleFiles().map(f => ({ name: f, dir: 'roles', read: () => readRole(f) })),
    ...getDelegateFiles().map(f => ({ name: f, dir: 'delegates', read: () => readDelegate(f) })),
    ...getWorkflowFiles().map(f => ({ name: f, dir: 'workflows', read: () => readWorkflow(f) })),
  ];

  for (const file of allFiles) {
    test(`${file.dir}/${file.name} has no ~/.claude/ vendor paths`, () => {
      const content = file.read();
      assert.ok(
        !content.includes('~/.claude/'),
        `${file.name} must not contain ~/.claude/ vendor paths`
      );
    });

    test(`${file.dir}/${file.name} has no gsd-tools.cjs references`, () => {
      const content = file.read();
      assert.ok(
        !content.includes('gsd-tools.cjs'),
        `${file.name} must not reference gsd-tools.cjs`
      );
    });

    test(`${file.dir}/${file.name} has no STRUCTURE.md references`, () => {
      const content = file.read();
      assert.ok(
        !content.includes('STRUCTURE.md'),
        `${file.name} must not reference dropped file STRUCTURE.md`
      );
    });

    test(`${file.dir}/${file.name} has no INTEGRATIONS.md references`, () => {
      const content = file.read();
      assert.ok(
        !content.includes('INTEGRATIONS.md'),
        `${file.name} must not reference dropped file INTEGRATIONS.md`
      );
    });
  }
});

// --- I3: Delegate Thinness ---

describe('I3 — Delegate Thinness', () => {
  const FORBIDDEN_SECTIONS = [
    '<deviation_rules>',
    '<authentication_gates>',
    '<tdd_execution>',
    '<forbidden_files>',
  ];

  for (const delegate of getDelegateFiles()) {
    for (const section of FORBIDDEN_SECTIONS) {
      test(`${delegate} has no ${section}`, () => {
        const content = readDelegate(delegate);
        assert.ok(
          !content.includes(section),
          `${delegate} must not contain ${section} (belongs in role contract)`
        );
      });
    }

    // anti_patterns is forbidden in all delegates EXCEPT plan-checker.md
    if (delegate !== 'plan-checker.md') {
      test(`${delegate} has no <anti_patterns>`, () => {
        const content = readDelegate(delegate);
        assert.ok(
          !content.includes('<anti_patterns>'),
          `${delegate} must not contain <anti_patterns> (belongs in role contract)`
        );
      });
    }
  }
});

// --- I4: Workflow References ---

describe('I4 — Workflow References', () => {
  const workflows = getWorkflowFiles();

  test('exactly 7 workflows exist', () => {
    assert.strictEqual(workflows.length, 7, `Expected 7 workflows, got ${workflows.length}: ${workflows.join(', ')}`);
  });

  test('all 7 workflows exist by name', () => {
    const expected = [
      'audit-milestone.md',
      'execute.md',
      'map-codebase.md',
      'new-project.md',
      'plan.md',
      'quick.md',
      'verify.md',
    ];
    for (const wf of expected) {
      assert.ok(
        workflows.includes(wf),
        `Workflow ${wf} must exist in distilled/workflows/`
      );
    }
  });

  for (const wf of getWorkflowFiles()) {
    test(`${wf} delegate references point to existing delegates`, () => {
      const content = readWorkflow(wf);
      const delegateRefs = [...content.matchAll(/templates\/delegates\/(\S+\.md)/g)];
      for (const ref of delegateRefs) {
        const delegateName = ref[1];
        const delegateExists = fs.existsSync(path.join(DELEGATES_DIR, delegateName));
        assert.ok(
          delegateExists,
          `${wf} references delegate ${delegateName} which must exist`
        );
      }
    });

    test(`${wf} role references point to existing roles`, () => {
      const content = readWorkflow(wf);
      const roleRefs = [...content.matchAll(/templates\/roles\/(\S+\.md)/g)];
      for (const ref of roleRefs) {
        const roleName = ref[1];
        const roleExists = fs.existsSync(path.join(AGENTS_DIR, roleName));
        assert.ok(
          roleExists,
          `${wf} references role ${roleName} which must exist in agents/`
        );
      }
    });
  }
});
