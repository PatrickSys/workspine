const fs = require('fs');

async function run(args) {
  const planFile = 'PLAN.md';
  if (!fs.existsSync(planFile)) {
    console.error("Error: PLAN.md not found. Run 'gsd-lite plan' first.");
    process.exit(1);
  }

  const content = fs.readFileSync(planFile, 'utf8');
  const lines = content.split('\n');
  const pendingTasks = [];
  const completedTasks = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)- \[([ x])\] (.*)$/);
    if (match) {
      if (match[2] === ' ') {
        pendingTasks.push(match[3]);
      } else {
        completedTasks.push(match[3]);
      }
    }
  }

  if (pendingTasks.length === 0) {
    console.log("All tasks marked as complete!");
    console.log(`Verified ${completedTasks.length} tasks.`);

    // Suggest running tests
    console.log("\nSuggested next step: Run tests manually to confirm.");
    console.log("e.g., npm test");
  } else {
    console.log(`Review incomplete. ${pendingTasks.length} pending tasks:`);
    pendingTasks.forEach(task => console.log(`- ${task}`));
    console.log(`\n${completedTasks.length} tasks completed.`);
  }
}

module.exports = { run };
