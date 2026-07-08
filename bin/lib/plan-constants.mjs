export const PLAN_CHECK_DIMENSIONS = [
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

export const MAX_CHECKER_CYCLES = 3;

export const CHECKER_STATUSES = ['passed', 'issues_found'];

export const CHECKER_JSON_SCHEMA = {
  status: 'passed | issues_found',
  summary: 'string',
  issues: [
    {
      dimension: 'string',
      severity: 'blocker | warning',
      description: 'string',
      plan: 'string',
      task: 'string',
      fix_hint: 'string',
    },
  ],
};
