function defineWorkflow({ mutatesArtifacts = true, ...workflow }) {
  return {
    ...workflow,
    mutatesArtifacts,
    agent: mutatesArtifacts ? 'Code' : 'Plan',
    opencodeType: mutatesArtifacts ? 'edit' : 'plan',
  };
}

export const WORKFLOWS = [
  defineWorkflow({ name: 'work-new-project', workflow: 'new-project.md', description: 'Define a new product, or clarify fuzzy or broad scope from scratch into a spec and roadmap' }),
  defineWorkflow({ name: 'work-map-codebase', workflow: 'map-codebase.md', description: 'Map or refresh codebase - 4 parallel mappers, staleness check, secrets scan' }),
  defineWorkflow({ name: 'work-plan', workflow: 'plan.md', description: 'Plan a multi-step change to an existing codebase with or without a roadmap, or any work needing an owner-approved plan or continuity across a session break' }),
  defineWorkflow({ name: 'work-execute', workflow: 'execute.md', description: 'Execute an approved plan for a bounded change or roadmap phase, implement its tasks, and check the results' }),
  defineWorkflow({ name: 'work-verify', workflow: 'verify.md', description: 'Verify completed work against an approved plan for a bounded change or roadmap phase' }),
  defineWorkflow({ name: 'work-verify-work', workflow: 'verify-work.md', description: 'Conversational UAT testing - validate user-facing behavior with structured gap tracking' }),
  defineWorkflow({ name: 'work-audit-milestone', workflow: 'audit-milestone.md', description: 'Audit a completed milestone - cross-phase integration, requirements coverage, E2E flows' }),
  defineWorkflow({ name: 'work-complete-milestone', workflow: 'complete-milestone.md', description: 'Complete milestone - archive, evolve spec, collapse roadmap' }),
  defineWorkflow({ name: 'work-new-milestone', workflow: 'new-milestone.md', description: 'Start the next milestone of a project that already has SPEC and ROADMAP and a completed milestone in MILESTONES' }),
  defineWorkflow({ name: 'work-quick', workflow: 'quick.md', description: 'Finish one small self-contained task with at most 3 tasks in one sitting and no owner decision that must survive a break; otherwise, or if an owner-approved plan is needed, use work-plan' }),
  defineWorkflow({ name: 'work-pause', workflow: 'pause.md', description: 'Pause work - save session context for seamless resumption' }),
  defineWorkflow({ name: 'work-resume', workflow: 'resume.md', description: 'Resume work - restore context and route to next action' }),
  defineWorkflow({ name: 'work-progress', workflow: 'progress.md', description: 'Check progress - show project status and route to next action', mutatesArtifacts: false }),
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
