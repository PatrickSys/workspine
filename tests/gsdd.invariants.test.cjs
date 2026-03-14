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
const DESIGN_MD = path.join(__dirname, '..', 'distilled', 'DESIGN.md');

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

  test('exactly 10 workflows exist', () => {
    assert.strictEqual(workflows.length, 10, `Expected 10 workflows, got ${workflows.length}: ${workflows.join(', ')}`);
  });

  test('all 10 workflows exist by name', () => {
    const expected = [
      'audit-milestone.md',
      'execute.md',
      'map-codebase.md',
      'new-project.md',
      'pause.md',
      'plan.md',
      'progress.md',
      'quick.md',
      'resume.md',
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

// --- I5: Session Management Workflows ---

describe('I5 — Session Management Workflows', () => {
  const SESSION_WORKFLOWS = ['pause.md', 'resume.md', 'progress.md'];

  for (const wf of SESSION_WORKFLOWS) {
    test(`${wf} has no vendor API references (Task(), AskUserQuestion)`, () => {
      const content = readWorkflow(wf);
      assert.ok(!content.includes('Task('), `${wf} must not reference Task() vendor API`);
      assert.ok(!content.includes('AskUserQuestion'), `${wf} must not reference AskUserQuestion vendor API`);
    });

    test(`${wf} has no gsd-tools.cjs references`, () => {
      const content = readWorkflow(wf);
      assert.ok(!content.includes('gsd-tools.cjs'), `${wf} must not reference gsd-tools.cjs`);
    });

    test(`${wf} has no STATE.md references (D7 compliance)`, () => {
      const content = readWorkflow(wf);
      assert.ok(!content.includes('STATE.md'), `${wf} must not reference STATE.md (GSDD derives state from primary artifacts)`);
    });

    test(`${wf} has <success_criteria> section`, () => {
      const content = readWorkflow(wf);
      assert.ok(content.includes('<success_criteria>'), `${wf} must have <success_criteria> section`);
    });

    test(`${wf} has <role> section`, () => {
      const content = readWorkflow(wf);
      assert.ok(content.includes('<role>'), `${wf} must have <role> section`);
    });

    test(`${wf} has <process> section`, () => {
      const content = readWorkflow(wf);
      assert.ok(content.includes('<process>'), `${wf} must have <process> section`);
    });

    test(`${wf} references .continue-here.md checkpoint`, () => {
      const content = readWorkflow(wf);
      assert.ok(content.includes('.continue-here.md'), `${wf} must reference .continue-here.md checkpoint file`);
    });
  }

  test('resume.md references ROADMAP.md for state derivation', () => {
    const content = readWorkflow('resume.md');
    assert.ok(content.includes('ROADMAP.md'), 'resume.md must reference ROADMAP.md for state derivation');
  });

  test('pause.md has <prerequisites> section', () => {
    const content = readWorkflow('pause.md');
    assert.ok(content.includes('<prerequisites>'), 'pause.md must have <prerequisites> section');
  });

  test('resume.md references SPEC.md for project context', () => {
    const content = readWorkflow('resume.md');
    assert.ok(content.includes('SPEC.md'), 'resume.md must reference SPEC.md for project context');
  });

  test('pause.md has no ~/.claude/ vendor paths', () => {
    const content = readWorkflow('pause.md');
    assert.ok(!content.includes('~/.claude/'), 'pause.md must not contain ~/.claude/ vendor paths');
  });

  test('resume.md has no ~/.claude/ vendor paths', () => {
    const content = readWorkflow('resume.md');
    assert.ok(!content.includes('~/.claude/'), 'resume.md must not contain ~/.claude/ vendor paths');
  });

  test('progress.md has <prerequisites> section', () => {
    const content = readWorkflow('progress.md');
    assert.ok(content.includes('<prerequisites>'), 'progress.md must have <prerequisites> section');
  });

  test('progress.md references ROADMAP.md for state derivation', () => {
    const content = readWorkflow('progress.md');
    assert.ok(content.includes('ROADMAP.md'), 'progress.md must reference ROADMAP.md for state derivation');
  });

  test('progress.md references SPEC.md for project context', () => {
    const content = readWorkflow('progress.md');
    assert.ok(content.includes('SPEC.md'), 'progress.md must reference SPEC.md for project context');
  });

  test('progress.md is read-only (no file creation instructions)', () => {
    const content = readWorkflow('progress.md');
    // Check that process sections don't contain action verbs for file creation
    const processMatch = content.match(/<process>([\s\S]*?)<\/process>/);
    if (processMatch) {
      const processContent = processMatch[1];
      // These patterns indicate file-writing instructions, not references to existing files
      assert.ok(!processContent.includes('Write `.planning/'), 'progress.md process must not instruct writing to .planning/');
      assert.ok(!processContent.includes('Create `.planning/'), 'progress.md process must not instruct creating in .planning/');
      assert.ok(!processContent.includes('Delete `.planning/'), 'progress.md process must not instruct deleting from .planning/');
    }
  });
});

// --- I5b: Session Workflow Scope Boundaries ---

describe('I5b — Session Workflow Scope Boundaries', () => {
  test('progress.md has scope boundary distinguishing from resume.md', () => {
    const content = readWorkflow('progress.md');
    assert.ok(
      content.includes('NOT resume.md') || content.includes('not resume.md'),
      'progress.md must have scope boundary distinguishing it from resume.md'
    );
  });

  test('pause.md has scope boundary in <role>', () => {
    const content = readWorkflow('pause.md');
    assert.ok(
      content.includes('Scope boundary'),
      'pause.md must have scope boundary text in <role>'
    );
  });

  test('resume.md has scope boundary in <role>', () => {
    const content = readWorkflow('resume.md');
    assert.ok(
      content.includes('Scope boundary') || content.includes('unlike progress.md'),
      'resume.md must have scope boundary text in <role>'
    );
  });

  test('all 3 session workflows use named XML sections inside <process>', () => {
    for (const wf of ['pause.md', 'resume.md', 'progress.md']) {
      const content = readWorkflow(wf);
      const hasNamedSections = /<(?!process|\/process|role|\/role|prerequisites|\/prerequisites|success_criteria|\/success_criteria)[a-z_]+>/.test(content);
      assert.ok(
        hasNamedSections,
        `${wf} must use named XML sections inside <process> (not flat ## Step N: headings)`
      );
    }
  });
});

// --- I6: Artifact Schema Definitions ---

describe('I6 — Artifact Schema Definitions', () => {
  // --- PLAN.md frontmatter in plan.md (workflow) ---
  describe('PLAN.md schema in plan.md workflow', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'plan.md'), 'utf-8');

    test('plan.md documents phase frontmatter key', () => {
      assert.ok(content.includes('phase:'), 'plan.md must document phase frontmatter key');
    });

    test('plan.md documents plan frontmatter key', () => {
      assert.ok(/\bplan:/.test(content), 'plan.md must document plan frontmatter key');
    });

    test('plan.md documents type frontmatter key', () => {
      assert.ok(/\btype:/.test(content), 'plan.md must document type frontmatter key');
    });

    test('plan.md documents wave frontmatter key', () => {
      assert.ok(content.includes('wave:'), 'plan.md must document wave frontmatter key');
    });

    test('plan.md documents depends_on frontmatter key', () => {
      assert.ok(content.includes('depends_on:'), 'plan.md must document depends_on frontmatter key');
    });

    test('plan.md documents files-modified frontmatter key', () => {
      assert.ok(content.includes('files-modified:'), 'plan.md must document files-modified frontmatter key');
    });

    test('plan.md documents autonomous frontmatter key', () => {
      assert.ok(content.includes('autonomous:'), 'plan.md must document autonomous frontmatter key');
    });

    test('plan.md documents requirements frontmatter key', () => {
      assert.ok(content.includes('requirements:'), 'plan.md must document requirements frontmatter key');
    });

    test('plan.md documents must_haves frontmatter key', () => {
      assert.ok(content.includes('must_haves:'), 'plan.md must document must_haves frontmatter key');
    });

    test('plan.md documents <task XML structure', () => {
      assert.ok(content.includes('<task'), 'plan.md must document <task XML structure');
    });

    test('plan.md documents <files> task section', () => {
      assert.ok(content.includes('<files>'), 'plan.md must document <files> task section');
    });

    test('plan.md documents <action> task section', () => {
      assert.ok(content.includes('<action>'), 'plan.md must document <action> task section');
    });

    test('plan.md documents <verify> task section', () => {
      assert.ok(content.includes('<verify>'), 'plan.md must document <verify> task section');
    });

    test('plan.md documents <done> task section', () => {
      assert.ok(content.includes('<done>'), 'plan.md must document <done> task section');
    });
  });

  // --- PLAN.md frontmatter in planner.md (role contract) ---
  describe('PLAN.md schema in planner.md role contract', () => {
    const content = fs.readFileSync(path.join(AGENTS_DIR, 'planner.md'), 'utf-8');

    test('planner.md documents phase frontmatter key', () => {
      assert.ok(content.includes('phase:'), 'planner.md must document phase frontmatter key');
    });

    test('planner.md documents plan frontmatter key', () => {
      assert.ok(/\bplan:/.test(content), 'planner.md must document plan frontmatter key');
    });

    test('planner.md documents wave frontmatter key', () => {
      assert.ok(content.includes('wave:'), 'planner.md must document wave frontmatter key');
    });

    test('planner.md documents depends_on frontmatter key', () => {
      assert.ok(content.includes('depends_on:'), 'planner.md must document depends_on frontmatter key');
    });

    test('planner.md documents files-modified frontmatter key', () => {
      assert.ok(content.includes('files-modified:'), 'planner.md must document files-modified frontmatter key');
    });

    test('planner.md documents autonomous frontmatter key', () => {
      assert.ok(content.includes('autonomous:'), 'planner.md must document autonomous frontmatter key');
    });

    test('planner.md documents requirements frontmatter key', () => {
      assert.ok(content.includes('requirements:'), 'planner.md must document requirements frontmatter key');
    });

    test('planner.md documents must_haves frontmatter key', () => {
      assert.ok(content.includes('must_haves:'), 'planner.md must document must_haves frontmatter key');
    });

    test('planner.md documents files task field', () => {
      assert.ok(/`files`|<files>/.test(content), 'planner.md must document files task field');
    });

    test('planner.md documents action task field', () => {
      assert.ok(/`action`|<action>/.test(content), 'planner.md must document action task field');
    });

    test('planner.md documents verify task field', () => {
      assert.ok(/`verify`|<verify>/.test(content), 'planner.md must document verify task field');
    });

    test('planner.md documents done task field', () => {
      assert.ok(/`done`|<done>/.test(content), 'planner.md must document done task field');
    });
  });

  // --- Plan sizing consistency ---
  describe('Plan sizing consistency', () => {
    const plannerContent = fs.readFileSync(path.join(AGENTS_DIR, 'planner.md'), 'utf-8');
    const planWorkflow = fs.readFileSync(path.join(WORKFLOWS_DIR, 'plan.md'), 'utf-8');

    test('planner.md mentions 2-5 task sizing', () => {
      assert.ok(
        /2[-–]5/.test(plannerContent),
        'planner.md must mention 2-5 task sizing'
      );
    });

    test('plan.md workflow mentions 2-5 task sizing', () => {
      assert.ok(
        /2[-–]5/.test(planWorkflow),
        'plan.md workflow must mention 2-5 task sizing'
      );
    });
  });

  // --- ROADMAP.md grammar in roadmapper.md ---
  describe('ROADMAP.md grammar in roadmapper.md', () => {
    const content = fs.readFileSync(path.join(AGENTS_DIR, 'roadmapper.md'), 'utf-8');

    test('roadmapper.md documents [ ] status marker', () => {
      assert.ok(content.includes('[ ]'), 'roadmapper.md must document [ ] status marker');
    });

    test('roadmapper.md documents [-] status marker', () => {
      assert.ok(content.includes('[-]'), 'roadmapper.md must document [-] status marker');
    });

    test('roadmapper.md documents [x] status marker', () => {
      assert.ok(content.includes('[x]'), 'roadmapper.md must document [x] status marker');
    });

    test('roadmapper.md documents **Status** field', () => {
      assert.ok(content.includes('**Status**'), 'roadmapper.md must document **Status** parse-critical field');
    });

    test('roadmapper.md documents **Requirements** field', () => {
      assert.ok(content.includes('**Requirements**'), 'roadmapper.md must document **Requirements** parse-critical field');
    });
  });

  // --- VERIFICATION.md schema in verifier.md ---
  describe('VERIFICATION.md schema in verifier.md', () => {
    const content = fs.readFileSync(path.join(AGENTS_DIR, 'verifier.md'), 'utf-8');

    test('verifier.md documents phase frontmatter key', () => {
      assert.ok(content.includes('phase:'), 'verifier.md must document phase frontmatter key');
    });

    test('verifier.md documents verified frontmatter key', () => {
      assert.ok(content.includes('verified:'), 'verifier.md must document verified frontmatter key');
    });

    test('verifier.md documents status frontmatter key', () => {
      assert.ok(/\bstatus:/.test(content), 'verifier.md must document status frontmatter key');
    });

    test('verifier.md documents score frontmatter key', () => {
      assert.ok(content.includes('score:'), 'verifier.md must document score frontmatter key');
    });

    test('verifier.md documents passed status value', () => {
      assert.ok(content.includes('passed'), 'verifier.md must document passed status value');
    });

    test('verifier.md documents gaps_found status value', () => {
      assert.ok(content.includes('gaps_found'), 'verifier.md must document gaps_found status value');
    });

    test('verifier.md documents human_needed status value', () => {
      assert.ok(content.includes('human_needed'), 'verifier.md must document human_needed status value');
    });

    test('verifier.md documents L1 artifact level', () => {
      assert.ok(content.includes('L1'), 'verifier.md must document L1 artifact level');
    });

    test('verifier.md documents L2 artifact level', () => {
      assert.ok(content.includes('L2'), 'verifier.md must document L2 artifact level');
    });

    test('verifier.md documents L3 artifact level', () => {
      assert.ok(content.includes('L3'), 'verifier.md must document L3 artifact level');
    });

    test('verifier.md has Verification Basis section', () => {
      assert.ok(content.includes('Verification Basis'), 'verifier.md must have Verification Basis section');
    });

    test('verifier.md has Must-Haves Checked section', () => {
      assert.ok(content.includes('Must-Haves Checked'), 'verifier.md must have Must-Haves Checked section');
    });

    test('verifier.md has Findings section', () => {
      assert.ok(content.includes('Findings'), 'verifier.md must have Findings section');
    });

    test('verifier.md has Requirement Coverage section', () => {
      assert.ok(content.includes('Requirement Coverage'), 'verifier.md must have Requirement Coverage section');
    });
  });

  // --- SUMMARY.md schema in executor.md ---
  describe('SUMMARY.md schema in executor.md', () => {
    const content = fs.readFileSync(path.join(AGENTS_DIR, 'executor.md'), 'utf-8');

    test('executor.md documents phase frontmatter key', () => {
      assert.ok(content.includes('phase:'), 'executor.md must document phase frontmatter key');
    });

    test('executor.md documents completed frontmatter key', () => {
      assert.ok(content.includes('completed:'), 'executor.md must document completed frontmatter key');
    });

    test('executor.md documents tasks frontmatter key', () => {
      assert.ok(/\btasks:/.test(content), 'executor.md must document tasks frontmatter key');
    });

    test('executor.md documents deviations frontmatter key', () => {
      assert.ok(content.includes('deviations:'), 'executor.md must document deviations frontmatter key');
    });

    test('executor.md documents decisions frontmatter key', () => {
      assert.ok(content.includes('decisions:'), 'executor.md must document decisions frontmatter key');
    });

    test('executor.md documents key_files frontmatter key', () => {
      assert.ok(content.includes('key_files:'), 'executor.md must document key_files frontmatter key');
    });

    test('executor.md documents SUMMARY.md output', () => {
      assert.ok(content.includes('SUMMARY.md'), 'executor.md must document SUMMARY.md output');
    });
  });

  // --- MILESTONE-AUDIT.md schema in audit-milestone.md ---
  describe('MILESTONE-AUDIT.md schema in audit-milestone.md', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'audit-milestone.md'), 'utf-8');

    test('audit-milestone.md documents milestone frontmatter key', () => {
      assert.ok(content.includes('milestone:'), 'audit-milestone.md must document milestone frontmatter key');
    });

    test('audit-milestone.md documents audited frontmatter key', () => {
      assert.ok(content.includes('audited:'), 'audit-milestone.md must document audited frontmatter key');
    });

    test('audit-milestone.md documents status frontmatter key', () => {
      assert.ok(/\bstatus:/.test(content), 'audit-milestone.md must document status frontmatter key');
    });

    test('audit-milestone.md documents reduced_assurance frontmatter key', () => {
      assert.ok(content.includes('reduced_assurance:'), 'audit-milestone.md must document reduced_assurance frontmatter key');
    });

    test('audit-milestone.md documents scores frontmatter key', () => {
      assert.ok(content.includes('scores:'), 'audit-milestone.md must document scores frontmatter key');
    });

    test('audit-milestone.md documents gaps frontmatter key', () => {
      assert.ok(content.includes('gaps:'), 'audit-milestone.md must document gaps frontmatter key');
    });

    test('audit-milestone.md documents passed status value', () => {
      assert.ok(content.includes('passed'), 'audit-milestone.md must document passed status value');
    });

    test('audit-milestone.md documents gaps_found status value', () => {
      assert.ok(content.includes('gaps_found'), 'audit-milestone.md must document gaps_found status value');
    });

    test('audit-milestone.md documents tech_debt status value', () => {
      assert.ok(content.includes('tech_debt'), 'audit-milestone.md must document tech_debt status value');
    });
  });

  // --- Executor consumes planner output ---
  describe('Executor consumes planner output', () => {
    const content = fs.readFileSync(path.join(AGENTS_DIR, 'executor.md'), 'utf-8');

    test('executor.md references PLAN.md', () => {
      assert.ok(content.includes('PLAN.md'), 'executor.md must reference PLAN.md as its input');
    });

    test('executor.md documents autonomous task type', () => {
      assert.ok(content.includes('autonomous'), 'executor.md must document autonomous plan field');
    });

    test('executor.md documents checkpoint task types', () => {
      assert.ok(content.includes('checkpoint'), 'executor.md must document checkpoint task types');
    });
  });
});

// --- S13: STATE.md Elimination (D7 Compliance) ---

describe('S13 — STATE.md Elimination (D7 Compliance)', () => {
  // No workflow references STATE.md
  for (const wf of getWorkflowFiles()) {
    test(`workflow ${wf} has no STATE.md references`, () => {
      const content = readWorkflow(wf);
      assert.ok(
        !content.includes('STATE.md'),
        `${wf} must not reference STATE.md (D7: state derived from primary artifacts)`
      );
    });
  }

  // No role contract references STATE.md (except negation)
  const NEGATION_WORDS = ['not', 'does not', 'replaces', 'eliminated', 'dropped', 'no longer'];

  for (const role of getRoleFiles()) {
    test(`role ${role} has no STATE.md references (or only negation)`, () => {
      const content = readRole(role);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('STATE.md')) {
          const lower = line.toLowerCase();
          const hasNegation = NEGATION_WORDS.some(neg => lower.includes(neg));
          assert.ok(
            hasNegation,
            `${role} line ${i + 1} references STATE.md without negation: "${line.trim()}"`
          );
        }
      }
    });
  }

  // No delegate references STATE.md
  for (const delegate of getDelegateFiles()) {
    test(`delegate ${delegate} has no STATE.md references`, () => {
      const content = readDelegate(delegate);
      assert.ok(
        !content.includes('STATE.md'),
        `${delegate} must not reference STATE.md`
      );
    });
  }

  // DESIGN.md D7 documents elimination
  test('DESIGN.md documents STATE.md elimination', () => {
    const content = fs.readFileSync(DESIGN_MD, 'utf-8');
    assert.ok(
      content.includes('STATE.md'),
      'DESIGN.md must mention STATE.md in context of its elimination'
    );
    const hasElimination = /STATE\.md.*(?:replac|drop|eliminat|no longer|merged|inline status)/is.test(content);
    assert.ok(
      hasElimination,
      'DESIGN.md must document STATE.md as replaced/eliminated'
    );
  });
});

// --- I7: Plan-Checker Dimension Integrity ---

describe('I7 — Plan-Checker Dimension Integrity', () => {
  const PLAN_CHECKER_DIMENSIONS = [
    'requirement_coverage',
    'task_completeness',
    'dependency_correctness',
    'key_link_completeness',
    'scope_sanity',
    'must_have_quality',
    'context_compliance',
  ];

  const planCheckerContent = fs.readFileSync(
    path.join(DELEGATES_DIR, 'plan-checker.md'), 'utf-8'
  );
  const planWorkflowContent = fs.readFileSync(
    path.join(WORKFLOWS_DIR, 'plan.md'), 'utf-8'
  );
  const plannerContent = fs.readFileSync(
    path.join(AGENTS_DIR, 'planner.md'), 'utf-8'
  );

  describe('plan-checker.md documents all 7 dimensions', () => {
    for (const dim of PLAN_CHECKER_DIMENSIONS) {
      test(`plan-checker.md documents dimension: ${dim}`, () => {
        assert.ok(
          planCheckerContent.includes(dim),
          `plan-checker.md must document dimension ${dim}`
        );
      });
    }
  });

  describe('plan.md documents all 7 checker dimensions', () => {
    for (const dim of PLAN_CHECKER_DIMENSIONS) {
      test(`plan.md documents checker dimension: ${dim}`, () => {
        assert.ok(
          planWorkflowContent.includes(dim),
          `plan.md must document checker dimension ${dim}`
        );
      });
    }
  });

  describe('planner.md references all 7 checker dimensions', () => {
    // planner.md uses natural language labels (e.g. "requirement coverage") not underscored JSON keys
    const PLANNER_DIMENSION_LABELS = [
      'requirement coverage',
      'task completeness',
      'dependency correctness',
      'key-link completeness',
      'scope sanity',
      'must-have quality',
      'context compliance',
    ];

    for (const label of PLANNER_DIMENSION_LABELS) {
      test(`planner.md references dimension: ${label}`, () => {
        assert.ok(
          plannerContent.includes(label),
          `planner.md must reference checker dimension "${label}" in its internal_quality_gate`
        );
      });
    }
  });

  describe('plan-checker.md JSON output schema', () => {
    test('plan-checker.md documents "passed" status value', () => {
      assert.ok(planCheckerContent.includes('"passed"'), 'plan-checker.md must document "passed" JSON status');
    });

    test('plan-checker.md documents "issues_found" status value', () => {
      assert.ok(planCheckerContent.includes('"issues_found"'), 'plan-checker.md must document "issues_found" JSON status');
    });

    test('plan-checker.md documents "status" JSON field', () => {
      assert.ok(planCheckerContent.includes('"status"'), 'plan-checker.md must document "status" JSON field');
    });

    test('plan-checker.md documents "summary" JSON field', () => {
      assert.ok(planCheckerContent.includes('"summary"'), 'plan-checker.md must document "summary" JSON field');
    });

    test('plan-checker.md documents "issues" JSON field', () => {
      assert.ok(planCheckerContent.includes('"issues"'), 'plan-checker.md must document "issues" JSON field');
    });

    test('plan-checker.md documents "severity" field in issue schema', () => {
      assert.ok(planCheckerContent.includes('"severity"'), 'plan-checker.md must document "severity" in issue schema');
    });

    test('plan-checker.md documents "fix_hint" field in issue schema', () => {
      assert.ok(planCheckerContent.includes('"fix_hint"'), 'plan-checker.md must document "fix_hint" in issue schema');
    });

    test('plan-checker.md documents "blocker" severity value', () => {
      assert.ok(planCheckerContent.includes('blocker'), 'plan-checker.md must document "blocker" severity');
    });
  });

  test('plan.md documents reduced_assurance fallback', () => {
    assert.ok(
      planWorkflowContent.includes('reduced_assurance'),
      'plan.md must document reduced_assurance fallback for runtimes without independent checker'
    );
  });

  test('plan.md documents max revision cycles and escalation', () => {
    assert.ok(
      planWorkflowContent.includes('escalate'),
      'plan.md must document escalation when blockers remain after max revision cycles'
    );
  });
});

// --- I8: Workflow Vendor API Cleanliness ---

describe('I8 — Workflow Vendor API Cleanliness', () => {
  // All 10 portable workflows must be free of vendor-specific APIs that
  // would break the agent-agnostic portability guarantee.
  const VENDOR_APIS = [
    { name: 'AskUserQuestion', pattern: 'AskUserQuestion' },
    { name: 'Task() vendor API', pattern: 'Task(' },
    { name: 'SlashCommand()', pattern: 'SlashCommand(' },
    { name: '~/.claude/ vendor paths', pattern: '~/.claude/' },
    { name: 'gsd-tools.cjs', pattern: 'gsd-tools.cjs' },
  ];

  for (const wf of getWorkflowFiles()) {
    for (const { name, pattern } of VENDOR_APIS) {
      test(`${wf} has no ${name}`, () => {
        const content = readWorkflow(wf);
        assert.ok(
          !content.includes(pattern),
          `${wf} must not contain vendor-specific ${name} (breaks portability)`
        );
      });
    }
  }
});

// --- I3-gate: New-project.md Approval Gates ---

describe('I3-gate — New-project.md Approval Gates', () => {
  const newProjectContent = fs.readFileSync(
    path.join(WORKFLOWS_DIR, 'new-project.md'), 'utf-8'
  );

  test('new-project.md has spec approval gate', () => {
    assert.ok(
      newProjectContent.includes('<approval_gate id="spec">'),
      'new-project.md must have an explicit <approval_gate id="spec"> anchor before roadmap creation'
    );
  });

  test('new-project.md has roadmap approval gate', () => {
    assert.ok(
      newProjectContent.includes('<approval_gate id="roadmap">'),
      'new-project.md must have an explicit <approval_gate id="roadmap"> anchor before planning'
    );
  });

  test('new-project.md spec approval gate instructs agent to stop', () => {
    assert.ok(
      newProjectContent.includes('Do NOT proceed to roadmap creation'),
      'new-project.md spec approval gate must instruct agent not to proceed to roadmap creation until approved'
    );
  });

  test('new-project.md roadmap approval gate instructs agent to stop', () => {
    assert.ok(
      newProjectContent.includes('Do NOT proceed to planning'),
      'new-project.md roadmap approval gate must instruct agent not to proceed to planning until approved'
    );
  });

  test('new-project.md success_criteria references SPEC.md approval', () => {
    assert.ok(
      /SPEC\.md.*reviewed and approved/s.test(newProjectContent),
      'new-project.md success_criteria must require SPEC.md approval by developer'
    );
  });

  test('new-project.md success_criteria references ROADMAP.md approval', () => {
    assert.ok(
      /ROADMAP\.md.*reviewed and approved/s.test(newProjectContent),
      'new-project.md success_criteria must require ROADMAP.md approval by developer'
    );
  });
});
