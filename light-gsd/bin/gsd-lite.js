#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const command = process.argv[2];
const args = process.argv.slice(3);

function printHelp() {
  console.log(`
Light GSD (Get-Shit-Done) - A distilled framework for AI agents.

Usage:
  gsd-lite <command> [options]

Commands:
  init      Initialize a new GSD project (creates .gsd-lite directory).
  plan      Create or update a plan based on a goal.
  execute   Execute the next task in the plan.
  review    Review the work done.
  help      Show this help message.

Examples:
  gsd-lite init
  gsd-lite plan "Add a login feature"
  gsd-lite execute
  gsd-lite review
`);
}

async function main() {
  switch (command) {
    case 'init':
      try {
        const init = require('../lib/init');
        await init.run(args);
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
           console.log("Initializing... (Mock)");
           // Fallback until lib is implemented
           if (!fs.existsSync('.gsd-lite')) {
             fs.mkdirSync('.gsd-lite');
             console.log("Created .gsd-lite directory.");
           } else {
             console.log(".gsd-lite already exists.");
           }
        } else {
          throw e;
        }
      }
      break;
    case 'plan':
      try {
        const plan = require('../lib/plan');
        await plan.run(args);
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
            console.log("Planning... (Mock)");
            console.log("Would create PLAN.md for: " + args.join(' '));
        } else {
            throw e;
        }
      }
      break;
    case 'execute':
      try {
        const execute = require('../lib/execute');
        await execute.run(args);
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
            console.log("Executing... (Mock)");
            console.log("Would execute next task in PLAN.md");
        } else {
            throw e;
        }
      }
      break;
    case 'review':
      try {
        const review = require('../lib/review');
        await review.run(args);
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
            console.log("Reviewing... (Mock)");
            console.log("Would verify work.");
        } else {
            throw e;
        }
      }
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
