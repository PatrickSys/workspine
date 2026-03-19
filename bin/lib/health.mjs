// health.mjs — Workspace integrity diagnostics
//
// IMPORTANT: No module-scope process.cwd() — ESM caching means sub-modules
// evaluate once, so CWD must be computed inside function bodies.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { readManifest, detectModifications } from './manifest.mjs';
import { output } from './cli-utils.mjs';

/**
 * Factory function returning the health command.
 * ctx must provide: { frameworkVersion }
 */
export function createCmdHealth(ctx) {
  return async function cmdHealth(...healthArgs) {
    const jsonMode = healthArgs.includes('--json');
    const cwd = process.cwd();
    const planningDir = join(cwd, '.planning');

    // Pre-init guard
    if (!existsSync(join(planningDir, 'config.json'))) {
      if (jsonMode) {
        output({ status: 'broken', errors: [{ id: 'E1', severity: 'ERROR', message: '.planning/config.json missing', fix: 'Run `gsdd init`' }], warnings: [], info: [] });
      } else {
        console.log('Not initialized. Run `gsdd init`.');
      }
      process.exitCode = 1;
      return;
    }

    const errors = [];
    const warnings = [];
    const info = [];

    // --- ERROR checks ---

    // E1: config.json missing (already handled by pre-init guard, but keep for completeness)
    // E2: config.json missing required fields
    let config = null;
    try {
      config = JSON.parse(readFileSync(join(planningDir, 'config.json'), 'utf-8'));
      const requiredFields = ['researchDepth', 'modelProfile', 'initVersion'];
      const missing = requiredFields.filter((f) => !(f in config));
      if (missing.length > 0) {
        errors.push({ id: 'E2', severity: 'ERROR', message: `config.json missing required fields: ${missing.join(', ')}`, fix: 'Run `gsdd init` to regenerate' });
      }
    } catch {
      errors.push({ id: 'E1', severity: 'ERROR', message: '.planning/config.json is unparseable', fix: 'Run `gsdd init`' });
    }

    // E3: templates/ missing
    const templatesDir = join(planningDir, 'templates');
    const hasTemplatesDir = existsSync(templatesDir);
    const rolesDir = join(templatesDir, 'roles');
    const delegatesDir = join(templatesDir, 'delegates');
    const hasRolesDir = hasTemplatesDir && existsSync(rolesDir);
    const hasDelegatesDir = hasTemplatesDir && existsSync(delegatesDir);

    if (!hasTemplatesDir) {
      errors.push({ id: 'E3', severity: 'ERROR', message: '.planning/templates/ missing', fix: 'Run `gsdd update --templates`' });
    } else {
      // E4: roles/ missing or empty
      if (!hasRolesDir) {
        errors.push({ id: 'E4', severity: 'ERROR', message: '.planning/templates/roles/ missing', fix: 'Run `gsdd update --templates`' });
      } else {
        const roleFiles = readdirSync(rolesDir).filter((f) => f.endsWith('.md'));
        if (roleFiles.length === 0) {
          errors.push({ id: 'E4', severity: 'ERROR', message: '.planning/templates/roles/ has 0 role files', fix: 'Run `gsdd update --templates`' });
        }
      }

      // E5: delegates/ missing or empty
      if (!hasDelegatesDir) {
        errors.push({ id: 'E5', severity: 'ERROR', message: '.planning/templates/delegates/ missing', fix: 'Run `gsdd update --templates`' });
      } else {
        const delegateFiles = readdirSync(delegatesDir).filter((f) => f.endsWith('.md'));
        if (delegateFiles.length === 0) {
          errors.push({ id: 'E5', severity: 'ERROR', message: '.planning/templates/delegates/ has 0 delegate files', fix: 'Run `gsdd update --templates`' });
        }
      }
    }

    // --- WARNING checks ---

    // W1: generation-manifest.json missing
    const manifest = readManifest(planningDir);
    if (!manifest) {
      warnings.push({ id: 'W1', severity: 'WARN', message: 'generation-manifest.json missing', fix: 'Run `gsdd update --templates` to create' });
    }

    // W2 + W3: template/role hash mismatches and missing files
    if (manifest && hasTemplatesDir) {
      const allCategories = [
        { name: 'delegates', dir: delegatesDir, hashes: hasDelegatesDir ? manifest.templates?.delegates : null },
        { name: 'research', dir: join(templatesDir, 'research'), hashes: manifest.templates?.research },
        { name: 'codebase', dir: join(templatesDir, 'codebase'), hashes: manifest.templates?.codebase },
        { name: 'root templates', dir: templatesDir, hashes: manifest.templates?.root },
        { name: 'roles', dir: rolesDir, hashes: hasRolesDir ? manifest.roles : null },
      ];

      for (const cat of allCategories) {
        if (!cat.hashes) continue;
        const result = detectModifications(cat.dir, cat.hashes);
        if (result.modified.length > 0) {
          warnings.push({ id: 'W2', severity: 'WARN', message: `${cat.name}: ${result.modified.length} file(s) modified locally (${result.modified.join(', ')})`, fix: 'Intentional? Run `gsdd update --templates` to reset' });
        }
        if (result.missing.length > 0) {
          warnings.push({ id: 'W3', severity: 'WARN', message: `${cat.name}: ${result.missing.length} file(s) missing from disk (${result.missing.join(', ')})`, fix: 'Run `gsdd update --templates` to restore' });
        }
      }
    }

    // W4: ROADMAP.md references phases not found in .planning/phases/
    const roadmapPath = join(planningDir, 'ROADMAP.md');
    const phasesDir = join(planningDir, 'phases');
    const roadmap = existsSync(roadmapPath) ? readFileSync(roadmapPath, 'utf-8') : null;
    const phaseArtifacts = existsSync(phasesDir) ? listPhaseArtifacts(phasesDir) : [];

    if (roadmap && existsSync(phasesDir)) {
      const phaseNums = [];
      for (const line of roadmap.split('\n')) {
        const match = line.match(/^\s*[-*]\s*\[[ x-]\]\s*\*\*Phase\s+(\d+)/i);
        if (match) phaseNums.push(parseInt(match[1], 10));
      }
      for (const num of phaseNums) {
        const padded = String(num).padStart(2, '0');
        const hasFile = phaseArtifacts.some((artifact) => artifact.phasePrefix === padded || artifact.phasePrefix === String(num));
        if (!hasFile) {
          warnings.push({ id: 'W4', severity: 'WARN', message: `ROADMAP.md references Phase ${num} but no files found in .planning/phases/`, fix: 'Create missing phase dirs or update ROADMAP' });
        }
      }
    }

    // W5: Phase dir has PLAN but no SUMMARY (stale in-progress)
    if (phaseArtifacts.length > 0) {
      const plans = phaseArtifacts.filter((artifact) => artifact.name.includes('PLAN'));
      for (const plan of plans) {
        const prefix = plan.name.split('-PLAN')[0];
        const hasSummary = phaseArtifacts.some((artifact) =>
          artifact.dir === plan.dir &&
          artifact.name.startsWith(prefix) &&
          artifact.name.includes('SUMMARY')
        );
        if (!hasSummary) {
          warnings.push({ id: 'W5', severity: 'WARN', message: `${plan.displayPath} exists but no matching SUMMARY found (stale in-progress?)`, fix: 'Resume or complete the phase' });
        }
      }
    }

    // W6: No adapter surfaces detected
    const adapterPaths = [
      join(cwd, '.agents', 'skills'),
      join(cwd, '.claude'),
      join(cwd, '.opencode'),
      join(cwd, '.codex'),
    ];
    const hasAnyAdapter = adapterPaths.some((p) => existsSync(p));
    if (!hasAnyAdapter) {
      warnings.push({ id: 'W6', severity: 'WARN', message: 'No adapter surfaces detected', fix: 'Run `gsdd init --tools <platform>`' });
    }

    // --- INFO checks ---

    // I1: generation manifest was produced by a different framework version
    if (manifest && manifest.frameworkVersion && manifest.frameworkVersion !== ctx.frameworkVersion) {
      info.push({ id: 'I1', severity: 'INFO', message: `Generation manifest frameworkVersion (${manifest.frameworkVersion}) differs from current framework version (${ctx.frameworkVersion})`, fix: 'Run `gsdd update --templates`' });
    }

    // I2: Phase completion count
    if (roadmap) {
      const lines = roadmap.split('\n');
      let total = 0;
      let done = 0;
      for (const line of lines) {
        const match = line.match(/^\s*[-*]\s*\[([x ]|-)\]\s*\*\*Phase\s+\d+/i);
        if (match) {
          total++;
          if (match[1] === 'x') done++;
        }
      }
      if (total > 0) {
        info.push({ id: 'I2', severity: 'INFO', message: `Phases: ${done}/${total} completed` });
      }
    }

    // I3: Which adapters are installed
    const installedAdapters = [];
    if (existsSync(join(cwd, '.agents', 'skills'))) installedAdapters.push('open-standard-skills');
    if (existsSync(join(cwd, '.claude'))) installedAdapters.push('claude');
    if (existsSync(join(cwd, '.opencode'))) installedAdapters.push('opencode');
    if (existsSync(join(cwd, '.codex'))) installedAdapters.push('codex');
    if (existsSync(join(cwd, 'AGENTS.md'))) installedAdapters.push('agents');
    if (installedAdapters.length > 0) {
      info.push({ id: 'I3', severity: 'INFO', message: `Adapters installed: ${installedAdapters.join(', ')}` });
    }

    // --- Verdict ---
    const hasErrors = errors.length > 0;
    const hasWarnings = warnings.length > 0;
    const status = hasErrors ? 'broken' : hasWarnings ? 'degraded' : 'healthy';

    if (hasErrors) process.exitCode = 1;

    if (jsonMode) {
      output({ status, errors, warnings, info });
    } else {
      console.log(`\ngsdd health — workspace integrity check\n`);
      if (errors.length > 0) {
        for (const e of errors) console.log(`  ERROR: [${e.id}] ${e.message}\n    Fix: ${e.fix}`);
      }
      if (warnings.length > 0) {
        for (const w of warnings) console.log(`  WARN:  [${w.id}] ${w.message}\n    Fix: ${w.fix}`);
      }
      if (info.length > 0) {
        for (const i of info) console.log(`  INFO:  [${i.id}] ${i.message}${i.fix ? `\n    Fix: ${i.fix}` : ''}`);
      }
      console.log(`\n  Verdict: ${status.toUpperCase()}\n`);
    }
  };
}

function listPhaseArtifacts(phasesDir) {
  const artifacts = [];
  for (const entry of readdirSync(phasesDir, { withFileTypes: true })) {
    const entryPath = join(phasesDir, entry.name);
    if (entry.isFile()) {
      artifacts.push(createPhaseArtifact('', entry.name));
      continue;
    }
    if (!entry.isDirectory()) continue;
    for (const child of readdirSync(entryPath, { withFileTypes: true })) {
      if (child.isFile()) {
        artifacts.push(createPhaseArtifact(entry.name, child.name));
      }
    }
  }
  return artifacts;
}

function createPhaseArtifact(dir, name) {
  return {
    dir,
    name,
    displayPath: dir ? `${dir}/${name}` : name,
    phasePrefix: name.match(/^(\d+(?:\.\d+)?)-/)?.[1] || dir.match(/^(\d+(?:\.\d+)?)-/)?.[1] || null,
  };
}
