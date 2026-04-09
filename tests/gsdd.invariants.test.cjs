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
    .filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'DISTILLATION.md' && !f.startsWith('_'))
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

  test('all 10 canonical roles exist', () => {
    assert.strictEqual(roles.length, 10, `Expected 10 roles, got ${roles.length}: ${roles.join(', ')}`);
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
      const hasXmlOutput = /<output>|<output_format>|<output_contract>|<report_format>/.test(content);
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

  test('exactly 11 delegates exist', () => {
    assert.strictEqual(delegates.length, 11, `Expected 11 delegates, got ${delegates.length}: ${delegates.join(', ')}`);
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

  test('exactly 14 workflows exist', () => {
    assert.strictEqual(workflows.length, 14, `Expected 14 workflows, got ${workflows.length}: ${workflows.join(', ')}`);
  });

  test('all 14 workflows exist by name', () => {
    const expected = [
      'audit-milestone.md',
      'complete-milestone.md',
      'execute.md',
      'map-codebase.md',
      'new-milestone.md',
      'new-project.md',
      'pause.md',
      'plan.md',
      'plan-milestone-gaps.md',
      'progress.md',
      'quick.md',
      'resume.md',
      'verify.md',
      'verify-work.md',
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
    'goal_achievement',
    'approach_alignment',
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

  describe('plan-checker.md documents all 9 dimensions', () => {
    for (const dim of PLAN_CHECKER_DIMENSIONS) {
      test(`plan-checker.md documents dimension: ${dim}`, () => {
        assert.ok(
          planCheckerContent.includes(dim),
          `plan-checker.md must document dimension ${dim}`
        );
      });
    }
  });

  describe('plan.md documents all 9 checker dimensions', () => {
    for (const dim of PLAN_CHECKER_DIMENSIONS) {
      test(`plan.md documents checker dimension: ${dim}`, () => {
        assert.ok(
          planWorkflowContent.includes(dim),
          `plan.md must document checker dimension ${dim}`
        );
      });
    }
  });

  describe('planner.md references all 9 checker dimensions', () => {
    // planner.md uses natural language labels (e.g. "requirement coverage") not underscored JSON keys
    const PLANNER_DIMENSION_LABELS = [
      'requirement coverage',
      'task completeness',
      'dependency correctness',
      'key-link completeness',
      'scope sanity',
      'must-have quality',
      'context compliance',
      'goal achievement',
      'approach alignment',
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

  test('plan.md documents runtime and assurance frontmatter', () => {
    assert.ok(planWorkflowContent.includes('runtime:'), 'plan.md must document runtime frontmatter');
    assert.ok(planWorkflowContent.includes('assurance:'), 'plan.md must document assurance frontmatter');
  });

  test('plan.md documents structured plan check block', () => {
    assert.ok(planWorkflowContent.includes('<plan_check>'), 'plan.md must document <plan_check> block');
    assert.ok(planWorkflowContent.includes('<checks>'), 'plan.md must document <checks> block');
  });

  test('plan.md documents max revision cycles and escalation', () => {
    assert.ok(
      planWorkflowContent.includes('escalate'),
      'plan.md must document escalation when blockers remain after max revision cycles'
    );
  });
});

describe('I6b — Cross-runtime artifact contract', () => {
  test('execute.md documents handoff and delta contract', () => {
    const content = readWorkflow('execute.md');
    assert.ok(content.includes('<handoff>'), 'execute.md must document <handoff> block');
    assert.ok(content.includes('<deltas>'), 'execute.md must document <deltas> block');
    assert.ok(content.includes('factual_discovery'), 'execute.md must document factual_discovery mismatch class');
    assert.ok(content.includes('intent_scope_change'), 'execute.md must document intent_scope_change mismatch class');
    assert.ok(content.includes('architecture_risk_conflict'), 'execute.md must document architecture_risk_conflict mismatch class');
  });

  test('verify.md documents runtime-aware verification basis', () => {
    const content = readWorkflow('verify.md');
    assert.ok(content.includes('## Verification Basis'), 'verify.md must document verification basis section');
    assert.ok(content.includes('runtime:'), 'verify.md must document runtime frontmatter');
    assert.ok(content.includes('assurance:'), 'verify.md must document assurance frontmatter');
    assert.ok(content.includes("SUMMARY `<handoff>` and `<deltas>`"), 'verify.md must require reviewing summary handoff and deltas');
  });
});

describe('I6c — Pause/Resume Runtime Provenance', () => {
  test('pause.md has <runtime_contract> block', () => {
    const content = readWorkflow('pause.md');
    assert.ok(content.includes('<runtime_contract>'), 'pause.md must have <runtime_contract> block');
  });

  test('pause.md checkpoint template has runtime: field', () => {
    const content = readWorkflow('pause.md');
    assert.ok(content.includes('runtime:'), 'pause.md checkpoint template must include runtime: field');
  });

  test('resume.md has <runtime_contract> block', () => {
    const content = readWorkflow('resume.md');
    assert.ok(content.includes('<runtime_contract>'), 'resume.md must have <runtime_contract> block');
  });

  test('resume.md load_artifacts references checkpoint runtime field', () => {
    const content = readWorkflow('resume.md');
    const loadArtifactsBlock = content.slice(
      content.indexOf('<load_artifacts>'),
      content.indexOf('</load_artifacts>') + '</load_artifacts>'.length
    );
    assert.ok(
      loadArtifactsBlock.includes('runtime'),
      'resume.md must reference runtime field extraction in <load_artifacts>'
    );
  });

  test('resume.md present_status surfaces Paused by runtime', () => {
    const content = readWorkflow('resume.md');
    assert.ok(
      content.includes('Paused by:'),
      'resume.md must surface "Paused by:" runtime in present_status'
    );
  });

  test('resume.md present_status surfaces Resuming in runtime', () => {
    const content = readWorkflow('resume.md');
    assert.ok(
      content.includes('Resuming in:'),
      'resume.md must surface "Resuming in:" runtime in present_status'
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

// =============================================================================
// G-SUITES: Mechanical Invariant Enforcement
//
// Suites G1-G7 enforce structural invariants across all framework files.
// Assertion messages include FIX: instructions so CI agents can self-remediate.
// Rationale: OpenAI Harness Engineering (Feb 2026) — error messages ARE the
// enforcement mechanism for agents. External audit rec #4.
// =============================================================================

// --- Helper: XML tag extraction (used by G4) ---

function extractXmlTags(content) {
  // Strip fenced code blocks
  let stripped = content.replace(/```[\s\S]*?```/g, '');
  // Strip inline code
  stripped = stripped.replace(/`[^`]+`/g, '');

  const opens = new Map();
  const closes = new Map();

  // Only match structural XML tags at line start (after optional whitespace).
  // This avoids false positives from tag references in prose text like
  // "Ignore <planning_process> Step 1".
  // Opening tags: <tag>, <tag attr="val">, <tag id="x">
  for (const m of stripped.matchAll(/^\s*<([a-z_]+)(?:\s[^>]*)?\s*>/gm)) {
    const tag = m[1];
    opens.set(tag, (opens.get(tag) || 0) + 1);
  }
  // Closing tags: </tag>
  for (const m of stripped.matchAll(/^\s*<\/([a-z_]+)>/gm)) {
    const tag = m[1];
    closes.set(tag, (closes.get(tag) || 0) + 1);
  }

  return { opens, closes };
}

// --- G4: XML Section Well-Formedness ---

describe('G4 — XML Section Well-Formedness', () => {
  const allFiles = [
    ...getRoleFiles().map(f => ({ name: f, type: 'role', read: () => readRole(f) })),
    ...getDelegateFiles().map(f => ({ name: f, type: 'delegate', read: () => readDelegate(f) })),
    ...getWorkflowFiles().map(f => ({ name: f, type: 'workflow', read: () => readWorkflow(f) })),
  ];

  for (const file of allFiles) {
    test(`${file.type}/${file.name} has balanced XML tags`, () => {
      const { opens, closes } = extractXmlTags(file.read());
      // Check all opened tags have matching closes
      for (const [tag, count] of opens) {
        const closeCount = closes.get(tag) || 0;
        assert.strictEqual(
          closeCount, count,
          `${file.name}: <${tag}> opened ${count}x but closed ${closeCount}x. FIX: Add missing </${tag}>.`
        );
      }
      // Check no orphan closing tags
      for (const [tag, count] of closes) {
        const openCount = opens.get(tag) || 0;
        assert.strictEqual(
          openCount, count,
          `${file.name}: </${tag}> closed ${count}x but opened ${openCount}x. FIX: Add missing <${tag}> or remove orphan </${tag}>.`
        );
      }
    });
  }
});

// --- G3: File Size Guards ---

describe('G3 — File Size Guards', () => {
  const SIZE_LIMITS = {
    role: 500,
    delegate: 100,
    workflow: 400,
  };

  for (const role of getRoleFiles()) {
    test(`role/${role} is under ${SIZE_LIMITS.role} lines`, () => {
      const lines = readRole(role).split('\n').length;
      assert.ok(
        lines <= SIZE_LIMITS.role,
        `${role} is ${lines} lines (max ${SIZE_LIMITS.role}). FIX: Extract content to delegate or sub-section.`
      );
    });
  }

  for (const delegate of getDelegateFiles()) {
    test(`delegate/${delegate} is under ${SIZE_LIMITS.delegate} lines`, () => {
      const lines = readDelegate(delegate).split('\n').length;
      assert.ok(
        lines <= SIZE_LIMITS.delegate,
        `${delegate} is ${lines} lines (max ${SIZE_LIMITS.delegate}). FIX: Extract content to the role contract it references.`
      );
    });
  }

  // new-project.md is the most complex workflow (auto_mode, questioning, research,
  // spec_creation, roadmap_creation, approval gates, STOP gates, completion) — D28
  // added mandatory completion routing + positional discipline gates that push it
  // past 400. Exempted with a higher limit rather than losing essential content.
  // plan.md ~453 lines after D29 approach exploration (research subagent prompt extracted to role contract)
  // plan.md ~478 lines after Phase 2 spec_quality_check section addition (D1 ambiguity gate)
  // Phase 9 adds cross-runtime assurance-chain contract details to plan/execute.
  // These workflows remain bounded but need a slightly higher ceiling to keep the
  // contract in the canonical portable surface instead of scattering it elsewhere.
  const WORKFLOW_EXEMPT = { 'new-project.md': 430, 'plan.md': 520, 'execute.md': 440 };

  for (const wf of getWorkflowFiles()) {
    const limit = WORKFLOW_EXEMPT[wf] || SIZE_LIMITS.workflow;
    test(`workflow/${wf} is under ${limit} lines`, () => {
      const lines = readWorkflow(wf).split('\n').length;
      assert.ok(
        lines <= limit,
        `${wf} is ${lines} lines (max ${limit}). FIX: Extract content to delegate or sub-section.`
      );
    });
  }
});

// --- G7: Delegate Thinness (non-empty line count) ---

describe('G7 — Delegate Thinness', () => {
  const MAX_NON_EMPTY = 50;
  const EXEMPT = ['plan-checker.md']; // plan-checker: 55 lines, justified in DESIGN.md D3

  for (const delegate of getDelegateFiles()) {
    if (EXEMPT.includes(delegate)) continue;

    test(`${delegate} has at most ${MAX_NON_EMPTY} non-empty lines`, () => {
      const content = readDelegate(delegate);
      const nonEmpty = content.split('\n').filter(l => /\S/.test(l)).length;
      assert.ok(
        nonEmpty <= MAX_NON_EMPTY,
        `${delegate} has ${nonEmpty} non-empty lines (max ${MAX_NON_EMPTY}). FIX: Move content to the role contract it references.`
      );
    });
  }
});

// --- G6: DESIGN.md Decision Registry ---

describe('G6 — DESIGN.md Decision Registry', () => {
  const designContent = fs.readFileSync(DESIGN_MD, 'utf-8');

  test('DESIGN.md has at least 14 numbered decision sections', () => {
    const sections = designContent.match(/^## \d+\./gm) || [];
    assert.ok(
      sections.length >= 14,
      `DESIGN.md has ${sections.length} numbered sections (need >= 14). FIX: Add missing decision records.`
    );
  });

  // Extract section boundaries
  const sectionHeaders = [...designContent.matchAll(/^## (\d+)\..*/gm)];
  for (const header of sectionHeaders) {
    const sectionNum = header[1];
    const startIdx = header.index + header[0].length;
    // Find the next ## header or end of file
    const nextHeader = designContent.indexOf('\n## ', startIdx);
    const sectionBody = nextHeader === -1
      ? designContent.slice(startIdx)
      : designContent.slice(startIdx, nextHeader);

    test(`DESIGN.md section ${sectionNum} has Evidence subsection`, () => {
      assert.ok(
        sectionBody.includes('Evidence'),
        `DESIGN.md section ${sectionNum} missing Evidence subsection. FIX: Add **Evidence:** with source citations.`
      );
    });
  }
});

// --- G1: Cross-Document Schema Consistency ---

describe('G1 — Cross-Document Schema Consistency', () => {
  const plannerContent = fs.readFileSync(path.join(AGENTS_DIR, 'planner.md'), 'utf-8');
  const executorContent = fs.readFileSync(path.join(AGENTS_DIR, 'executor.md'), 'utf-8');
  const roadmapperContent = fs.readFileSync(path.join(AGENTS_DIR, 'roadmapper.md'), 'utf-8');
  const verifierContent = fs.readFileSync(path.join(AGENTS_DIR, 'verifier.md'), 'utf-8');
  const planWorkflow = fs.readFileSync(path.join(WORKFLOWS_DIR, 'plan.md'), 'utf-8');
  const verifyWorkflow = fs.readFileSync(path.join(WORKFLOWS_DIR, 'verify.md'), 'utf-8');
  const progressWorkflow = fs.readFileSync(path.join(WORKFLOWS_DIR, 'progress.md'), 'utf-8');
  const resumeWorkflow = fs.readFileSync(path.join(WORKFLOWS_DIR, 'resume.md'), 'utf-8');

  // PLAN.md frontmatter must appear in both planner.md and plan.md
  describe('PLAN.md frontmatter in planner.md AND plan.md', () => {
    const PLAN_FIELDS = ['phase:', 'depends_on:', 'files-modified:', 'autonomous:', 'requirements:', 'must_haves:'];
    for (const field of PLAN_FIELDS) {
      test(`${field} appears in both planner.md and plan.md`, () => {
        assert.ok(plannerContent.includes(field),
          `planner.md missing ${field}. FIX: Document ${field} in planner.md output contract.`);
        assert.ok(planWorkflow.includes(field),
          `plan.md missing ${field}. FIX: Document ${field} in plan.md workflow.`);
      });
    }
  });

  // Task XML structure in both planner (author) and executor (consumer)
  // <files>, <action>, <verify> must appear literally; <done> may appear as "done criteria" in executor
  describe('Task XML in planner.md (author) and executor.md (consumer)', () => {
    const TASK_SECTIONS = ['<files>', '<action>', '<verify>'];
    for (const section of TASK_SECTIONS) {
      test(`${section} appears in both planner.md and executor.md`, () => {
        assert.ok(plannerContent.includes(section) || plannerContent.includes(section.replace('<', '`').replace('>', '`')),
          `planner.md missing ${section}. FIX: Document ${section} in planner.md task schema.`);
        assert.ok(executorContent.includes(section) || executorContent.includes(section.replace('<', '`').replace('>', '`')),
          `executor.md missing ${section}. FIX: Document ${section} in executor.md task consumption.`);
      });
    }

    test('<done> concept appears in both planner.md and executor.md', () => {
      assert.ok(plannerContent.includes('<done>') || plannerContent.includes('`done`'),
        'planner.md missing <done>. FIX: Document <done> in planner.md task schema.');
      assert.ok(executorContent.includes('<done>') || /\bdone\b/.test(executorContent),
        'executor.md missing done concept. FIX: Document done criteria in executor.md task consumption.');
    });
  });

  // ROADMAP status grammar in roadmapper, progress, and resume
  describe('ROADMAP status grammar consistency', () => {
    const STATUS_MARKERS = ['[ ]', '[-]', '[x]'];
    for (const marker of STATUS_MARKERS) {
      test(`${marker} appears in roadmapper.md, progress.md, and resume.md`, () => {
        assert.ok(roadmapperContent.includes(marker),
          `roadmapper.md missing ${marker}. FIX: Document ROADMAP status marker ${marker} in roadmapper.md.`);
        assert.ok(progressWorkflow.includes(marker),
          `progress.md missing ${marker}. FIX: Document ROADMAP status marker ${marker} in progress.md.`);
        assert.ok(resumeWorkflow.includes(marker),
          `resume.md missing ${marker}. FIX: Document ROADMAP status marker ${marker} in resume.md.`);
      });
    }
  });

  // VERIFICATION.md fields in verifier.md and verify.md
  describe('VERIFICATION.md fields in verifier.md and verify.md', () => {
    const VERIFICATION_FIELDS = ['verified', 'score'];
    for (const field of VERIFICATION_FIELDS) {
      test(`${field} appears in both verifier.md and verify.md`, () => {
        assert.ok(verifierContent.includes(field),
          `verifier.md missing ${field}. FIX: Document VERIFICATION.md ${field} field in verifier.md.`);
        assert.ok(verifyWorkflow.includes(field),
          `verify.md missing ${field}. FIX: Document VERIFICATION.md ${field} field in verify.md.`);
      });
    }

    test('status field appears in both verifier.md and verify.md', () => {
      assert.ok(/\bstatus\b/.test(verifierContent),
        'verifier.md missing status. FIX: Document VERIFICATION.md status field in verifier.md.');
      assert.ok(/\bstatus\b/.test(verifyWorkflow),
        'verify.md missing status. FIX: Document VERIFICATION.md status field in verify.md.');
    });
  });
});

// --- G5: Artifact Lifecycle Chain ---

describe('G5 — Artifact Lifecycle Chain', () => {
  const roadmapperContent = fs.readFileSync(path.join(AGENTS_DIR, 'roadmapper.md'), 'utf-8');
  const plannerContent = fs.readFileSync(path.join(AGENTS_DIR, 'planner.md'), 'utf-8');
  const executorContent = fs.readFileSync(path.join(AGENTS_DIR, 'executor.md'), 'utf-8');
  const verifierContent = fs.readFileSync(path.join(AGENTS_DIR, 'verifier.md'), 'utf-8');
  const integrationCheckerContent = fs.readFileSync(path.join(AGENTS_DIR, 'integration-checker.md'), 'utf-8');

  // roadmapper → produces ROADMAP.md
  test('roadmapper.md references output ROADMAP.md', () => {
    assert.ok(roadmapperContent.includes('ROADMAP.md'),
      'roadmapper.md must reference its output artifact ROADMAP.md. FIX: Add ROADMAP.md to roadmapper output contract.');
  });

  // planner → reads ROADMAP, produces PLAN.md
  test('planner.md references input ROADMAP', () => {
    assert.ok(/ROADMAP/i.test(plannerContent),
      'planner.md must reference its input ROADMAP. FIX: Add ROADMAP reference to planner.md input contract.');
  });

  test('planner.md references output PLAN.md', () => {
    assert.ok(plannerContent.includes('PLAN.md'),
      'planner.md must reference its output artifact PLAN.md. FIX: Add PLAN.md to planner output contract.');
  });

  // executor → reads PLAN.md, produces SUMMARY.md
  test('executor.md references input PLAN.md', () => {
    assert.ok(executorContent.includes('PLAN.md'),
      'executor.md must reference its input artifact PLAN.md. FIX: Add PLAN.md to executor input contract.');
  });

  test('executor.md references output SUMMARY.md', () => {
    assert.ok(executorContent.includes('SUMMARY.md'),
      'executor.md must reference its output artifact SUMMARY.md. FIX: Add SUMMARY.md to executor output contract.');
  });

  // verifier → reads PLAN.md + SUMMARY, produces VERIFICATION.md
  test('verifier.md references input PLAN.md', () => {
    assert.ok(verifierContent.includes('PLAN.md'),
      'verifier.md must reference its input artifact PLAN.md. FIX: Add PLAN.md to verifier input contract.');
  });

  test('verifier.md references input SUMMARY', () => {
    assert.ok(/SUMMARY/i.test(verifierContent),
      'verifier.md must reference its input SUMMARY. FIX: Add SUMMARY reference to verifier input contract.');
  });

  test('verifier.md references output VERIFICATION.md', () => {
    assert.ok(verifierContent.includes('VERIFICATION.md'),
      'verifier.md must reference its output artifact VERIFICATION.md. FIX: Add VERIFICATION.md to verifier output contract.');
  });

  // integration-checker → reads SUMMARY, produces audit report
  test('integration-checker.md references input SUMMARY', () => {
    assert.ok(/SUMMARY/i.test(integrationCheckerContent),
      'integration-checker.md must reference its input SUMMARY. FIX: Add SUMMARY reference to integration-checker input contract.');
  });

  test('integration-checker.md references audit report output', () => {
    assert.ok(/report|audit|findings/i.test(integrationCheckerContent),
      'integration-checker.md must reference its audit report output. FIX: Add report reference to integration-checker output contract.');
  });
});

// --- G8: Auto-Mode Contract ---

describe('G8 — Auto-Mode Contract', () => {
  const newProjectContent = fs.readFileSync(
    path.join(WORKFLOWS_DIR, 'new-project.md'), 'utf-8'
  );

  test('new-project.md contains <auto_mode> section', () => {
    assert.ok(
      newProjectContent.includes('<auto_mode>') && newProjectContent.includes('</auto_mode>'),
      'new-project.md must have <auto_mode> section. FIX: Add the auto-mode contract between <role> and <load_context>.'
    );
  });

  test('auto_mode references PROJECT_BRIEF.md', () => {
    const autoSection = newProjectContent.match(/<auto_mode>([\s\S]*?)<\/auto_mode>/);
    assert.ok(autoSection, 'new-project.md must have <auto_mode> section');
    assert.ok(
      autoSection[1].includes('PROJECT_BRIEF.md'),
      'auto_mode section must reference PROJECT_BRIEF.md as the input document. FIX: Document the brief-file input contract in <auto_mode>.'
    );
  });

  test('auto_mode references autoAdvance config key', () => {
    const autoSection = newProjectContent.match(/<auto_mode>([\s\S]*?)<\/auto_mode>/);
    assert.ok(autoSection, 'new-project.md must have <auto_mode> section');
    assert.ok(
      autoSection[1].includes('autoAdvance'),
      'auto_mode section must reference autoAdvance config key. FIX: Document the config detection in <auto_mode>.'
    );
  });

  test('auto_mode bypass list includes project_principles and capability_gates', () => {
    const autoSection = newProjectContent.match(/<auto_mode>([\s\S]*?)<\/auto_mode>/);
    assert.ok(autoSection, 'new-project.md must have <auto_mode> section');
    assert.ok(
      autoSection[1].includes('project_principles'),
      'auto_mode bypass list must name project_principles. FIX: Update the bypass enumeration in <auto_mode> to include project_principles.'
    );
    assert.ok(
      autoSection[1].includes('capability_gates'),
      'auto_mode bypass list must name capability_gates. FIX: Update the bypass enumeration in <auto_mode> to include capability_gates.'
    );
  });

  test('success_criteria interactive items are marked conditional', () => {
    const scSection = newProjectContent.match(/<success_criteria>([\s\S]*?)<\/success_criteria>/);
    assert.ok(scSection, 'new-project.md must have <success_criteria> section');
    const sc = scSection[1];
    const interactiveItems = [
      'questioned in depth',
      'SPEC.md was reviewed and approved',
      'ROADMAP.md was reviewed and approved',
    ];
    for (const item of interactiveItems) {
      const lineMatch = sc.split('\n').find(l => l.includes(item));
      assert.ok(lineMatch, `success_criteria must contain item: "${item}"`);
      assert.ok(
        lineMatch.includes('autoAdvance'),
        `success_criteria item "${item}" must be conditionally marked with autoAdvance. FIX: Add "— [interactive only; skip when autoAdvance: true]" to this item.`
      );
    }
  });

  test('project_principles and capability_gates include explicit autoAdvance guards', () => {
    const projectPrinciples = newProjectContent.match(/<project_principles>([\s\S]*?)<\/project_principles>/);
    const capabilityGates = newProjectContent.match(/<capability_gates>([\s\S]*?)<\/capability_gates>/);
    assert.ok(projectPrinciples, 'new-project.md must have <project_principles> section');
    assert.ok(capabilityGates, 'new-project.md must have <capability_gates> section');
    assert.ok(
      projectPrinciples[1].includes('autoAdvance'),
      'project_principles must include an autoAdvance guard. FIX: Add an explicit auto-mode branch before the interactive question.'
    );
    assert.ok(
      capabilityGates[1].includes('autoAdvance'),
      'capability_gates must include an autoAdvance guard. FIX: Add an explicit auto-mode branch before the interactive question.'
    );
    assert.ok(
      capabilityGates[1].includes('Deferred'),
      'capability_gates must document the deferred-review placeholder for auto mode. FIX: Add the explicit deferred gate-review placeholder text.'
    );
  });
});

// =============================================================================
// G12: Documentation Accuracy Guards
//
// Prevents documentation drift from recurring. Guards cross-document claims
// against implementation truth (DESIGN.md decision count, workflow count,
// CLI commands, ghost commands, implemented feature markers).
// =============================================================================

describe('G12 — Documentation Accuracy Guards', () => {
  const ROOT_README = path.join(__dirname, '..', 'README.md');
  const DISTILLED_README = path.join(__dirname, '..', 'distilled', 'README.md');
  const AGENTS_README = path.join(__dirname, '..', 'agents', 'README.md');
  const CLI_ENTRY = path.join(__dirname, '..', 'bin', 'gsdd.mjs');
  const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');

  const rootReadme = fs.readFileSync(ROOT_README, 'utf-8');
  const distilledReadme = fs.readFileSync(DISTILLED_README, 'utf-8');
  const agentsReadme = fs.readFileSync(AGENTS_README, 'utf-8');
  const designContent = fs.readFileSync(DESIGN_MD, 'utf-8');
  const cliContent = fs.readFileSync(CLI_ENTRY, 'utf-8');
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8'));

  // G12.1: DESIGN.md actual decision count matches README claims
  test('DESIGN.md decision count matches root README claim', () => {
    const actualSections = (designContent.match(/^## \d+\./gm) || []).length;
    assert.ok(
      rootReadme.includes(`${actualSections} documented design decisions`),
      `Root README claims wrong DESIGN.md decision count. Actual: ${actualSections}. FIX: Update root README to say "${actualSections} documented design decisions".`
    );
  });

  test('DESIGN.md decision count matches distilled/README claim', () => {
    const actualSections = (designContent.match(/^## \d+\./gm) || []).length;
    assert.ok(
      distilledReadme.includes(`${actualSections} decisions`),
      `distilled/README claims wrong DESIGN.md decision count. Actual: ${actualSections}. FIX: Update distilled/README DESIGN.md description to say "${actualSections} decisions".`
    );
  });

  // G12.2: Workflow count matches WORKFLOWS array length
  test('root README workflow count matches WORKFLOWS array length', () => {
    const workflowArrayMatch = cliContent.match(/const WORKFLOWS = \[/);
    assert.ok(workflowArrayMatch, 'bin/gsdd.mjs must define WORKFLOWS array');
    // Count workflow entries by counting `{ name:` lines
    const workflowEntries = (cliContent.match(/\{\s*name:\s*'/g) || []).length;
    assert.ok(
      rootReadme.includes(`${workflowEntries} workflows`),
      `Root README claims wrong workflow count. Actual: ${workflowEntries}. FIX: Update root README to say "${workflowEntries} workflows".`
    );
  });

  // G12.3: CLI commands completeness — README table includes all registered commands
  test('root README CLI commands table includes all registered commands', () => {
    // Extract command names from COMMANDS object in bin/gsdd.mjs
    const commandsMatch = cliContent.match(/const COMMANDS = \{([\s\S]*?)\};/);
    assert.ok(commandsMatch, 'bin/gsdd.mjs must define COMMANDS object');
    const commandNames = [...commandsMatch[1].matchAll(/'?([a-z-]+)'?\s*:/g)].map(m => m[1]);

    for (const cmd of commandNames) {
      assert.ok(
        rootReadme.includes(`gsdd ${cmd}`),
        `Root README CLI commands table missing "gsdd ${cmd}". FIX: Add "gsdd ${cmd}" row to the CLI Commands table.`
      );
    }
  });

  // G12.4: No ghost commands in distilled/README workflow diagram
  test('distilled/README workflow diagram has no ghost commands', () => {
    // Extract workflow diagram section (between "## The Workflow" and next "##")
    const diagramMatch = distilledReadme.match(/## The Workflow[\s\S]*?```([\s\S]*?)```/);
    assert.ok(diagramMatch, 'distilled/README must have a workflow diagram code block');
    const diagram = diagramMatch[1];

    // Extract /gsdd-* references from the diagram (canonical hyphen form)
    const diagramCommands = [...diagram.matchAll(/\/gsdd-([a-z-]+)/g)].map(m => m[1]);

    // Get valid workflow names (strip 'gsdd-' prefix to get the command part)
    const workflowNames = (cliContent.match(/name:\s*'gsdd-([a-z-]+)'/g) || [])
      .map(m => m.match(/name:\s*'gsdd-([a-z-]+)'/)[1]);

    for (const cmd of diagramCommands) {
      assert.ok(
        workflowNames.includes(cmd),
        `distilled/README workflow diagram references "/gsdd-${cmd}" which is not in WORKFLOWS array. FIX: Remove ghost command or add the workflow.`
      );
    }
  });

  // G12.5: No "(planned)" for implemented features
  test('agents/README.md does not say "(planned)" for gsdd update --templates', () => {
    assert.ok(
      !agentsReadme.includes('(planned)'),
      'agents/README.md still says "(planned)" for an implemented feature. FIX: Remove "(planned)" and describe current behavior.'
    );
  });

  // G12.6: Update command documentation mentions --templates
  test('root README update command mentions --templates', () => {
    assert.ok(
      rootReadme.includes('--templates'),
      'Root README update command documentation does not mention --templates. FIX: Add --templates to the update command description.'
    );
  });

  test('package.json description matches the repo-native kernel launch framing', () => {
    assert.match(pkg.description, /repo-native workflow kernel/i,
      'package.json description must use the repo-native workflow kernel framing. FIX: Update the package description.');
    assert.match(pkg.description, /Claude Code.*Codex CLI.*OpenCode/i,
      'package.json description must name only the directly validated runtimes. FIX: Limit the description to the current proof set.');
  });

  test('package.json exposes npm test alias for README test command', () => {
    assert.strictEqual(pkg.scripts.test, 'npm run test:gsdd',
      'package.json must expose "npm test" as an alias to test:gsdd. FIX: Add a test script alias.');
  });
});

// G35b - Role and Delegate Reference Integrity
describe('G35b - Role and Delegate Reference Integrity', () => {
  const workflowFiles = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.md'));

  // G35b.1: Every .planning/templates/roles/*.md reference has a matching source in agents/
  test('all roles/ references in workflow files resolve to agents/ source files', () => {
    const roleRefs = new Set();
    for (const file of workflowFiles) {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8');
      const matches = [...content.matchAll(/templates\/roles\/([a-z-]+\.md)/g)].map(m => m[1]);
      for (const m of matches) roleRefs.add(m);
    }
    for (const ref of roleRefs) {
      assert.ok(
        fs.existsSync(path.join(AGENTS_DIR, ref)),
        `Workflow references templates/roles/${ref} but agents/${ref} does not exist. FIX: Add the role contract file to agents/.`
      );
    }
  });

  // G35b.2: Every templates/delegates/*.md reference has a matching source in distilled/templates/delegates/
  test('all delegates/ references in workflow files resolve to distilled/templates/delegates/ source files', () => {
    const delegateRefs = new Set();
    for (const file of workflowFiles) {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8');
      const matches = [...content.matchAll(/templates\/delegates\/([a-z-]+\.md)/g)].map(m => m[1]);
      for (const m of matches) delegateRefs.add(m);
    }
    for (const ref of delegateRefs) {
      assert.ok(
        fs.existsSync(path.join(DELEGATES_DIR, ref)),
        `Workflow references templates/delegates/${ref} but distilled/templates/delegates/${ref} does not exist. FIX: Add the delegate file.`
      );
    }
  });
});

// G34 - Command Naming Invariants
describe('G34 - Command Naming Invariants', () => {
  const workflowFiles = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.md'));

  // G34.1: No colon-separated /gsdd: in workflow files (canonical form is /gsdd-)
  for (const file of workflowFiles) {
    test(`${file} uses hyphen-separated /gsdd- syntax (not /gsdd:)`, () => {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8');
      const colonMatches = [...content.matchAll(/\/gsdd:[a-z-]+/g)].map(m => m[0]);
      assert.strictEqual(
        colonMatches.length,
        0,
        `${file} contains colon-separated command refs: ${colonMatches.join(', ')}. FIX: Replace /gsdd: with /gsdd- throughout.`
      );
    });
  }

  // G34.2: Legacy commands/gsd/ directory must not exist
  test('commands/gsd/ legacy directory does not exist', () => {
    const legacyDir = path.join(__dirname, '..', 'commands', 'gsd');
    assert.ok(
      !fs.existsSync(legacyDir),
      'commands/gsd/ legacy directory exists. FIX: Delete it — these are dead GSD upstream commands that reference non-existent GSDD artifacts.'
    );
  });

  // G34.3: --tools all includes all 7 runtimes
  test('parseToolsFlag("all") returns all 7 runtime adapters', () => {
    const { parseToolsFlag } = require('../bin/lib/cli-utils.mjs');
    const result = parseToolsFlag(['--tools', 'all']);
    const expected = ['claude', 'opencode', 'codex', 'agents', 'cursor', 'copilot', 'gemini'];
    for (const runtime of expected) {
      assert.ok(result.includes(runtime), `parseToolsFlag("all") missing "${runtime}". FIX: Add "${runtime}" to the "all" expansion in cli-utils.mjs.`);
    }
  });
});
