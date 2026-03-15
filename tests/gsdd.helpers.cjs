/**
 * GSDD CLI Test Helpers
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const CLI_PATH = path.join(BIN_DIR, 'gsdd.mjs');

async function loadGsdd(cwd) {
  const previousCwd = process.cwd();
  process.chdir(cwd);

  try {
    return await import(`${pathToFileURL(CLI_PATH).href}?t=${Date.now()}-${Math.random()}`);
  } finally {
    process.chdir(previousCwd);
  }
}

async function runCliAsMain(cwd, args, entryPath = CLI_PATH) {
  const previousCwd = process.cwd();
  const previousArgv = process.argv.slice();
  const previousExitCode = process.exitCode;
  const previousLog = console.log;
  const previousError = console.error;
  const lines = [];

  process.chdir(cwd);
  process.argv = [process.execPath, entryPath, ...args];
  process.exitCode = undefined;
  console.log = (...parts) => lines.push(parts.join(' '));
  console.error = (...parts) => lines.push(parts.join(' '));

  try {
    await import(`${pathToFileURL(CLI_PATH).href}?t=${Date.now()}-${Math.random()}`);
    return {
      exitCode: process.exitCode ?? 0,
      output: lines.join('\n'),
    };
  } finally {
    console.log = previousLog;
    console.error = previousError;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
    process.chdir(previousCwd);
  }
}

async function runCliViaJunction(cwd, args) {
  const aliasDir = path.join(cwd, 'bin-alias');
  fs.symlinkSync(BIN_DIR, aliasDir, 'junction');
  return runCliAsMain(cwd, args, path.join(aliasDir, 'gsdd.mjs'));
}

function createTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-test-'));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function setNonInteractiveStdin() {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: false,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(process.stdin, 'isTTY', descriptor);
    } else {
      delete process.stdin.isTTY;
    }
  };
}

async function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const restore = () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    return await fn();
  } finally {
    restore();
  }
}

module.exports = {
  cleanup,
  createTempProject,
  loadGsdd,
  readJson,
  runCliAsMain,
  runCliViaJunction,
  setNonInteractiveStdin,
  withEnv,
};
