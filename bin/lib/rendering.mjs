import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DISTILLED_DIR = join(__dirname, '..', '..', 'distilled');

function getWorkflowContent(workflowFile) {
  const filePath = join(DISTILLED_DIR, 'workflows', workflowFile);
  if (existsSync(filePath)) return readFileSync(filePath, 'utf-8');
  return `<!-- Workflow file not found: ${workflowFile} -->\n`;
}

function getDelegateContent(delegateFile) {
  const filePath = join(DISTILLED_DIR, 'templates', 'delegates', delegateFile);
  if (existsSync(filePath)) return readFileSync(filePath, 'utf-8');
  return `<!-- Delegate file not found: ${delegateFile} -->\n`;
}

function renderSkillContent(workflow) {
  const workflowContent = getWorkflowContent(workflow.workflow);
  return `---
name: ${workflow.name}
description: ${workflow.description}
context: fork
agent: ${workflow.agent}
---

${workflowContent}`;
}

function buildPortableSkillEntries(workflows) {
  return workflows.map((workflow) => ({
    relativePath: `.agents/skills/${workflow.name}/SKILL.md`,
    content: renderSkillContent(workflow),
  }));
}

function renderOpenCodeCommandContent(workflow) {
  const workflowContent = getWorkflowContent(workflow.workflow);
  return `---
description: ${workflow.description}
---

${workflowContent}`;
}

function renderAgentsBoundedBlock() {
  const blockPath = join(DISTILLED_DIR, 'templates', 'agents.block.md');
  if (existsSync(blockPath)) return readFileSync(blockPath, 'utf-8').trim();
  return '## GSDD Governance (Generated)\n\n- Framework: GSDD\n- Planning: .planning/\n- Workflows: .agents/skills/gsdd-*/SKILL.md';
}

function renderAgentsFileContent() {
  const templatePath = join(DISTILLED_DIR, 'templates', 'agents.md');
  if (existsSync(templatePath)) {
    const template = readFileSync(templatePath, 'utf-8');
    return template.replace('{{GSDD_BLOCK}}', renderAgentsBoundedBlock()).trimEnd() + '\n';
  }
  const block = renderAgentsBoundedBlock();
  return `# AGENTS.md - GSDD Governance\n\n<!-- BEGIN GSDD -->\n${block}\n<!-- END GSDD -->\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertBoundedBlock(existing, blockContent) {
  const begin = '<!-- BEGIN GSDD -->';
  const end = '<!-- END GSDD -->';
  const bounded = `${begin}\n${blockContent.trimEnd()}\n${end}`;

  const re = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
  if (re.test(existing)) return existing.replace(re, bounded);

  const lines = existing.split(/\r?\n/);
  const h1Idx = lines.findIndex((line) => /^#\s+/.test(line));
  if (h1Idx !== -1) {
    const insertAt = h1Idx + 1;
    const out = [
      ...lines.slice(0, insertAt),
      '',
      bounded,
      '',
      ...lines.slice(insertAt),
    ];
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  return `${bounded}\n\n${existing}`.replace(/\n{3,}/g, '\n\n');
}

export {
  buildPortableSkillEntries,
  getDelegateContent,
  getWorkflowContent,
  renderAgentsBoundedBlock,
  renderAgentsFileContent,
  renderOpenCodeCommandContent,
  renderSkillContent,
  upsertBoundedBlock,
};
