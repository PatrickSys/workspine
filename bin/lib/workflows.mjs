function defineWorkflow({ mutatesArtifacts = true, ...workflow }) {
  return {
    ...workflow,
    mutatesArtifacts,
    agent: mutatesArtifacts ? 'Code' : 'Plan',
    opencodeType: mutatesArtifacts ? 'edit' : 'plan',
  };
}

export const WORKFLOWS = [
  defineWorkflow({ name: 'gsdd-new-project', workflow: 'new-project.md', description: 'New project - questioning, codebase audit, research, spec, roadmap' }),
  defineWorkflow({ name: 'gsdd-map-codebase', workflow: 'map-codebase.md', description: 'Map or refresh codebase - 4 parallel mappers, staleness check, secrets scan' }),
  defineWorkflow({ name: 'gsdd-plan', workflow: 'plan.md', description: 'Plan a phase - research check, backward planning, task creation' }),
  defineWorkflow({ name: 'gsdd-execute', workflow: 'execute.md', description: 'Execute a phase plan - implement tasks, verify changes, follow repo git conventions' }),
  defineWorkflow({ name: 'gsdd-verify', workflow: 'verify.md', description: 'Verify a completed phase - 3-level checks, anti-pattern scan' }),
  defineWorkflow({ name: 'gsdd-verify-work', workflow: 'verify-work.md', description: 'Conversational UAT testing - validate user-facing behavior with structured gap tracking' }),
  defineWorkflow({ name: 'gsdd-audit-milestone', workflow: 'audit-milestone.md', description: 'Audit a completed milestone - cross-phase integration, requirements coverage, E2E flows' }),
  defineWorkflow({ name: 'gsdd-complete-milestone', workflow: 'complete-milestone.md', description: 'Complete milestone - archive, evolve spec, collapse roadmap' }),
  defineWorkflow({ name: 'gsdd-new-milestone', workflow: 'new-milestone.md', description: 'New milestone - gather goals, define requirements, create roadmap phases' }),
  defineWorkflow({ name: 'gsdd-quick', workflow: 'quick.md', description: 'Quick task - plan and execute a sub-hour task outside the phase cycle' }),
  defineWorkflow({ name: 'gsdd-pause', workflow: 'pause.md', description: 'Pause work - save session context for seamless resumption' }),
  defineWorkflow({ name: 'gsdd-resume', workflow: 'resume.md', description: 'Resume work - restore context and route to next action' }),
  defineWorkflow({ name: 'gsdd-progress', workflow: 'progress.md', description: 'Check progress - show project status and route to next action', mutatesArtifacts: false }),
];

// Every shipped command id carries the same prefix. Deriving it from the manifest
// keeps the health scan and the rendering skill glob from drifting off the ids above.
const [firstWorkflow] = WORKFLOWS;
export const WORKFLOW_ID_PREFIX = firstWorkflow.name.slice(0, firstWorkflow.name.indexOf('-') + 1);

if (!WORKFLOWS.every((entry) => entry.name.startsWith(WORKFLOW_ID_PREFIX))) {
  throw new Error(`Workflow manifest ids must all start with '${WORKFLOW_ID_PREFIX}'`);
}

// The two native subagents are not shipped slash commands, so they are absent from
// the manifest above - but they carry the same prefix and every adapter, the global
// installer and the freshness manifest must spell them identically. Naming them once
// here keeps the generated agent files, their frontmatter and the expected-content
// checks from drifting apart.
export const SUBAGENT_IDS = Object.freeze({
  planChecker: `${WORKFLOW_ID_PREFIX}plan-checker`,
  approachExplorer: `${WORKFLOW_ID_PREFIX}approach-explorer`,
});

const WORKFLOW_ID_BY_SLUG = Object.freeze(Object.fromEntries(
  WORKFLOWS.map((entry) => [entry.workflow.replace(/\.md$/, ''), entry.name]),
));

// Routing surfaces address workflows by slug ('plan', 'execute') so the manifest
// above stays the single source of truth for the shipped command ids.
export function workflowId(slug) {
  const id = WORKFLOW_ID_BY_SLUG[slug];
  if (!id) {
    throw new Error(`Unknown workflow slug: ${slug}`);
  }
  return id;
}

export const FRAMEWORK_VERSION = 'v1.4';
