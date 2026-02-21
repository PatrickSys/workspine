const fs = require('fs');
const path = require('path');

async function run(args) {
  const goal = args.join(' ');
  const planFile = 'PLAN.md';

  if (!goal && !fs.existsSync(planFile)) {
    console.error("Error: Please provide a goal.");
    console.error("Usage: gsd-lite plan <goal>");
    process.exit(1);
  }

  if (fs.existsSync(planFile)) {
    console.log(`Updating existing plan in ${planFile}...`);
    let content = fs.readFileSync(planFile, 'utf8');

    // If goal provided, update it? Or just append?
    // For now, let's just say we don't overwrite the goal if it exists, unless user forces it.
    // simpler: Just print a message that it exists.
    console.log("Plan file already exists. Please edit it manually to update tasks.");
    console.log("Current content:");
    console.log(content);
  } else {
    console.log(`Creating new plan for goal: "${goal}"`);

    const template = `# Plan

Goal: ${goal}

## Tasks
- [ ] [Task 1: Describe the first step]
- [ ] [Task 2: Describe the second step]

## Notes
- Add any relevant notes here.
`;
    fs.writeFileSync(planFile, template);
    console.log(`Plan created at ${planFile}`);
    console.log("Edit this file to define your specific tasks.");
  }
}

module.exports = { run };
