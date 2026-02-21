const fs = require('fs');
const path = require('path');

async function run(args) {
  const planFile = 'PLAN.md';
  if (!fs.existsSync(planFile)) {
    console.error("Error: PLAN.md not found. Run 'gsd-lite plan' first.");
    process.exit(1);
  }

  let content = fs.readFileSync(planFile, 'utf8');
  const lines = content.split('\n');
  let currentTaskIndex = -1;
  let currentTaskLine = -1;

  // Find first unchecked task
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)- \[ \] (.*)$/);
    if (match) {
      currentTaskIndex = i;
      currentTaskLine = line;
      break;
    }
  }

  if (currentTaskIndex === -1) {
    console.log("All tasks completed! Run 'gsd-lite review' to verify.");
    return;
  }

  const taskDescription = lines[currentTaskIndex].match(/^(\s*)- \[ \] (.*)$/)[2];

  if (args.includes('--done')) {
    // Mark as done
    lines[currentTaskIndex] = lines[currentTaskIndex].replace('- [ ]', '- [x]');
    fs.writeFileSync(planFile, lines.join('\n'));
    console.log(`Marked task as done: ${taskDescription}`);

    // Check for next task
    let nextTaskIndex = -1;
    for (let i = currentTaskIndex + 1; i < lines.length; i++) {
        if (lines[i].match(/^(\s*)- \[ \] (.*)$/)) {
            nextTaskIndex = i;
            break;
        }
    }

    if (nextTaskIndex !== -1) {
        const nextTask = lines[nextTaskIndex].match(/^(\s*)- \[ \] (.*)$/)[2];
        console.log(`Next task: ${nextTask}`);
    } else {
        console.log("All tasks completed!");
    }
  } else {
    // Show current task
    console.log(`Current Task: ${taskDescription}`);
    console.log(`\nTo mark as done, run: gsd-lite execute --done`);
  }
}

module.exports = { run };
