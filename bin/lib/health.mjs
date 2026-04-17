// health.mjs — Workspace integrity diagnostics
//
// IMPORTANT: No module-scope process.cwd() — ESM caching means sub-modules
// evaluate once, so CWD must be computed inside function bodies.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { readManifest, detectModifications } from './manifest.mjs';
import { output } from './cli-utils.mjs';
import { runTruthChecks, TRUTH_CHECK_IDS } from './health-truth.mjs';
import { evaluateLifecycleState } from './lifecycle-state.mjs';
import { evaluateRuntimeFreshness } from './runtime-freshness.mjs';

/**
 * Factory function returning the health command.
 * ctx should provide: { frameworkVersion, workflows }
 */
export function createCmdHealth(ctx) {
  return async function cmdHealth(...healthArgs) {
    const jsonMode = healthArgs.includes('--json');
    const cwd = process.cwd();
    const planningDir = join(cwd, '.planning');
    const frameworkSourceMode = isFrameworkSourceRepo(cwd);
    const healthCheckIds = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6', ...TRUTH_CHECK_IDS, 'I1', 'I2', 'I3'];

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
    let configOk = false;
    try {
      config = JSON.parse(readFileSync(join(planningDir, 'config.json'), 'utf-8'));
      configOk = true;
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
    const skipInstalledTemplateChecks = !hasTemplatesDir && frameworkSourceMode;

    if (!hasTemplatesDir && !skipInstalledTemplateChecks) {
      errors.push({ id: 'E3', severity: 'ERROR', message: '.planning/templates/ missing', fix: 'Run `gsdd update --templates`' });
    } else if (hasTemplatesDir) {
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

      // E6: research/ missing or empty
      const researchDir = join(templatesDir, 'research');
      if (!existsSync(researchDir)) {
        errors.push({ id: 'E6', severity: 'ERROR', message: '.planning/templates/research/ missing', fix: 'Run `gsdd update --templates`' });
      } else {
        const researchFiles = readdirSync(researchDir).filter((f) => f.endsWith('.md'));
        if (researchFiles.length === 0) {
          errors.push({ id: 'E6', severity: 'ERROR', message: '.planning/templates/research/ has 0 template files', fix: 'Run `gsdd update --templates`' });
        }
      }

      // E7: codebase/ missing or empty
      const codebaseDir = join(templatesDir, 'codebase');
      if (!existsSync(codebaseDir)) {
        errors.push({ id: 'E7', severity: 'ERROR', message: '.planning/templates/codebase/ missing', fix: 'Run `gsdd update --templates`' });
      } else {
        const codebaseFiles = readdirSync(codebaseDir).filter((f) => f.endsWith('.md'));
        if (codebaseFiles.length === 0) {
          errors.push({ id: 'E7', severity: 'ERROR', message: '.planning/templates/codebase/ has 0 template files', fix: 'Run `gsdd update --templates`' });
        }
      }

      // E8: critical root template files missing
      const requiredRootFiles = ['spec.md', 'roadmap.md', 'auth-matrix.md'];
      const missingRoot = requiredRootFiles.filter((f) => !existsSync(join(templatesDir, f)));
      if (missingRoot.length > 0) {
        errors.push({ id: 'E8', severity: 'ERROR', message: `.planning/templates/ missing critical root files: ${missingRoot.join(', ')}`, fix: 'Run `gsdd update --templates`' });
      }
    }

    // --- WARNING checks ---

    // W1: generation-manifest.json missing
    const manifest = skipInstalledTemplateChecks ? null : readManifest(planningDir);
    if (!manifest && !skipInstalledTemplateChecks) {
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
    const lifecycle = evaluateLifecycleState({ planningDir });

    if (roadmap && existsSync(phasesDir)) {
      for (const phase of lifecycle.phases.filter((entry) => entry.status !== 'not_started' && !entry.hasArtifacts)) {
        warnings.push({
          id: 'W4',
          severity: 'WARN',
          message: `ROADMAP.md references active Phase ${phase.number} but no files found in .planning/phases/`,
          fix: 'Create missing phase dirs or update ROADMAP',
        });
      }
    }

    // W5: Phase dir has PLAN but no SUMMARY (stale in-progress)
    if (lifecycle.incompletePlans.length > 0) {
      for (const plan of lifecycle.incompletePlans) {
        warnings.push({
          id: 'W5',
          severity: 'WARN',
          message: `${plan.displayPath} exists but no matching SUMMARY found (stale in-progress?)`,
          fix: 'Resume or complete the phase',
        });
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

    const runtimeFreshnessReport = configOk && Array.isArray(ctx.workflows)
      ? evaluateRuntimeFreshness({ cwd, workflows: ctx.workflows })
      : null;

    warnings.push(...runTruthChecks(planningDir, cwd, healthCheckIds, { runtimeFreshnessReport }));

    // --- INFO checks ---

    // I1: generation manifest was produced by a different framework version
    if (manifest && manifest.frameworkVersion && manifest.frameworkVersion !== ctx.frameworkVersion) {
      info.push({ id: 'I1', severity: 'INFO', message: `Generation manifest frameworkVersion (${manifest.frameworkVersion}) differs from current framework version (${ctx.frameworkVersion})`, fix: 'Run `gsdd update --templates`' });
    }

    // I2: Phase completion count
    if (lifecycle.counts.total > 0) {
      info.push({
        id: 'I2',
        severity: 'INFO',
        message: `Phases: ${lifecycle.counts.completed}/${lifecycle.counts.total} completed`,
      });
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

function isFrameworkSourceRepo(cwd) {
  return existsSync(join(cwd, 'distilled', 'templates')) && existsSync(join(cwd, 'distilled', 'workflows'));
}

