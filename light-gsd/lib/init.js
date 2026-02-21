const fs = require('fs');
const path = require('path');

async function run(args) {
  const gsdDir = '.gsd-lite';

  if (!fs.existsSync(gsdDir)) {
    fs.mkdirSync(gsdDir);
    console.log(`Initialized Light GSD project in ${gsdDir}`);

    // Create default config if needed
    const configPath = path.join(gsdDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      const defaultConfig = {
        mode: "auto",
        files: {
          plan: "PLAN.md"
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log(`Created default config at ${configPath}`);
    }
  } else {
    console.log(`Light GSD project already initialized in ${gsdDir}`);
  }
}

module.exports = { run };
