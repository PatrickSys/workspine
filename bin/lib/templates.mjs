// templates.mjs - Project template and role installation/refresh helpers

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, cpSync, unlinkSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { fileHash, readManifest } from './manifest.mjs';
import { localizeStateDirReferences } from './rendering.mjs';

export function installProjectTemplates({ planningDir, distilledDir, agentsDir, stateDirName = '.work' }) {
  const localTemplatesDir = join(planningDir, 'templates');
  const globalTemplatesDir = join(distilledDir, 'templates');
  const stateName = basename(planningDir);

  if (!existsSync(localTemplatesDir)) {
    if (existsSync(globalTemplatesDir)) {
      copyTemplateTree(globalTemplatesDir, localTemplatesDir, { stateDirName });
      console.log(`  - copied templates to ${stateName}/templates/`);
      // Warn-only by design: init should not fail on missing templates because
      // the user may still proceed and fix later. The hard gate lives in
      // `gsdd health` (E6/E7/E8) which reports these as errors. This is the
      // first layer of the 3-layer scaffold defense (warn at init, error at
      // health, regression tests in manifest suite).
      const expectedSubdirs = ['delegates', 'research', 'codebase', 'brownfield-change'];
      for (const subdir of expectedSubdirs) {
        if (!existsSync(join(localTemplatesDir, subdir))) {
          console.log(`  - WARN: missing expected template subdir: ${subdir}/`);
        }
      }
      const expectedRootFiles = ['spec.md', 'roadmap.md', 'auth-matrix.md', 'ui-proof.md'];
      for (const file of expectedRootFiles) {
        if (!existsSync(join(localTemplatesDir, file))) {
          console.log(`  - WARN: missing expected root template file: ${file}`);
        }
      }
    } else {
      console.log('  - WARN: missing distilled/templates/; cannot copy templates');
    }
  } else {
    console.log(`  - ${stateName}/templates/ already exists`);
  }

  const localRolesDir = join(localTemplatesDir, 'roles');
  if (!existsSync(localRolesDir)) {
    if (existsSync(agentsDir)) {
      mkdirSync(localRolesDir, { recursive: true });
      for (const file of listRoleFiles(agentsDir)) {
        copyTemplateFile(join(agentsDir, file), join(localRolesDir, file), { stateDirName });
      }
      console.log(`  - copied role contracts to ${stateName}/templates/roles/`);
    } else {
      console.log('  - WARN: missing agents/; cannot copy role contracts');
    }
  } else {
    console.log(`  - ${stateName}/templates/roles/ already exists`);
  }
}

export function refreshTemplates({ planningDir, distilledDir, agentsDir, isDry = false, stateDirName = '.work' }) {
  const existingManifest = readManifest(planningDir);
  const globalTemplatesDir = join(distilledDir, 'templates');
  const localTemplatesDir = join(planningDir, 'templates');

  const categories = [
    { name: 'delegates', src: join(globalTemplatesDir, 'delegates'), dest: join(localTemplatesDir, 'delegates'), manifestKey: 'delegates' },
    { name: 'research', src: join(globalTemplatesDir, 'research'), dest: join(localTemplatesDir, 'research'), manifestKey: 'research' },
    { name: 'codebase', src: join(globalTemplatesDir, 'codebase'), dest: join(localTemplatesDir, 'codebase'), manifestKey: 'codebase' },
    { name: 'brownfield-change', src: join(globalTemplatesDir, 'brownfield-change'), dest: join(localTemplatesDir, 'brownfield-change'), manifestKey: 'brownfieldChange' },
  ];

  for (const category of categories) {
    refreshCategory(category, existingManifest, isDry, { stateDirName });
  }

  refreshRootTemplates(globalTemplatesDir, localTemplatesDir, existingManifest, isDry, { stateDirName });
  refreshRoles(agentsDir, join(localTemplatesDir, 'roles'), existingManifest, isDry, { stateDirName });
}

function contentHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function localizedTemplateContent(srcPath, { stateDirName = '.work' } = {}) {
  return localizeStateDirReferences(readFileSync(srcPath, 'utf-8'), { stateDirName });
}

function sourceTemplateHash(srcPath, { stateDirName = '.work' } = {}) {
  if (!srcPath.endsWith('.md')) return fileHash(srcPath);
  return contentHash(localizedTemplateContent(srcPath, { stateDirName }));
}

function copyTemplateFile(srcPath, destPath, { stateDirName = '.work' } = {}) {
  if (!srcPath.endsWith('.md')) {
    cpSync(srcPath, destPath);
    return;
  }
  writeFileSync(destPath, localizedTemplateContent(srcPath, { stateDirName }));
}

function copyTemplateTree(srcDir, destDir, { stateDirName = '.work' } = {}) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    if (statSync(srcPath).isDirectory()) {
      copyTemplateTree(srcPath, destPath, { stateDirName });
    } else {
      copyTemplateFile(srcPath, destPath, { stateDirName });
    }
  }
}

function listRoleFiles(agentsDir) {
  return readdirSync(agentsDir).filter(
    (file) => file.endsWith('.md') && file !== 'README.md' && !file.startsWith('_')
  );
}

function refreshCategory({ name, src, dest, manifestKey }, existingManifest, isDry, { stateDirName = '.work' } = {}) {
  if (!existsSync(src)) return;
  if (!existsSync(dest) && !isDry) {
    mkdirSync(dest, { recursive: true });
  }

  const manifestHashes = existingManifest?.templates?.[manifestKey] || null;
  const sourceFiles = readdirSync(src).filter((file) => file.endsWith('.md'));
  const installedFiles = existsSync(dest) ? readdirSync(dest).filter((file) => file.endsWith('.md')) : [];

  for (const file of sourceFiles) {
    const srcPath = join(src, file);
    const destPath = join(dest, file);
    const srcHash = sourceTemplateHash(srcPath, { stateDirName });

    if (existsSync(destPath)) {
      const destHash = fileHash(destPath);
      if (destHash === srcHash) continue;

      const manifestHash = manifestHashes?.[file];
      if (manifestHash && destHash !== manifestHash) {
        console.log(`  - WARN: ${name}/${file} was modified locally; overwriting with framework source`);
      }
    }

    if (isDry) {
      console.log(`  - would refresh ${name}/${file}`);
    } else {
      copyTemplateFile(srcPath, destPath, { stateDirName });
      console.log(`  - refreshed ${name}/${file}`);
    }
  }

  for (const file of installedFiles) {
    if (!sourceFiles.includes(file)) {
      if (isDry) {
        console.log(`  - would remove orphan ${name}/${file}`);
      } else {
        const orphanPath = join(dest, file);
        if (existsSync(orphanPath)) {
          unlinkSync(orphanPath);
        }
        console.log(`  - removed orphan ${name}/${file}`);
      }
    }
  }
}

function refreshRootTemplates(globalTemplatesDir, localTemplatesDir, existingManifest, isDry, { stateDirName = '.work' } = {}) {
  if (!existsSync(globalTemplatesDir)) return;

  const manifestHashes = existingManifest?.templates?.root || null;
  const sourceFiles = readdirSync(globalTemplatesDir).filter((file) => file.endsWith('.md'));

  for (const file of sourceFiles) {
    const srcPath = join(globalTemplatesDir, file);
    const destPath = join(localTemplatesDir, file);
    const srcHash = sourceTemplateHash(srcPath, { stateDirName });

    if (existsSync(destPath)) {
      const destHash = fileHash(destPath);
      if (destHash === srcHash) continue;

      const manifestHash = manifestHashes?.[file];
      if (manifestHash && destHash !== manifestHash) {
        console.log(`  - WARN: templates/${file} was modified locally; overwriting with framework source`);
      }
    }

    if (isDry) {
      console.log(`  - would refresh templates/${file}`);
    } else {
      copyTemplateFile(srcPath, destPath, { stateDirName });
      console.log(`  - refreshed templates/${file}`);
    }
  }

  const installedRootFiles = existsSync(localTemplatesDir)
    ? readdirSync(localTemplatesDir).filter((file) => file.endsWith('.md'))
    : [];

  for (const file of installedRootFiles) {
    if (!sourceFiles.includes(file)) {
      if (isDry) {
        console.log(`  - would remove orphan templates/${file}`);
      } else {
        const orphanPath = join(localTemplatesDir, file);
        if (existsSync(orphanPath)) {
          unlinkSync(orphanPath);
        }
        console.log(`  - removed orphan templates/${file}`);
      }
    }
  }
}

function refreshRoles(agentsDir, localRolesDir, existingManifest, isDry, { stateDirName = '.work' } = {}) {
  if (!existsSync(agentsDir)) return;
  if (!existsSync(localRolesDir) && !isDry) {
    mkdirSync(localRolesDir, { recursive: true });
  }

  const manifestHashes = existingManifest?.roles || null;
  const sourceFiles = listRoleFiles(agentsDir);
  const installedFiles = existsSync(localRolesDir)
    ? readdirSync(localRolesDir).filter((file) => file.endsWith('.md'))
    : [];

  for (const file of sourceFiles) {
    const srcPath = join(agentsDir, file);
    const destPath = join(localRolesDir, file);
    const srcHash = sourceTemplateHash(srcPath, { stateDirName });

    if (existsSync(destPath)) {
      const destHash = fileHash(destPath);
      if (destHash === srcHash) continue;

      const manifestHash = manifestHashes?.[file];
      if (manifestHash && destHash !== manifestHash) {
        console.log(`  - WARN: roles/${file} was modified locally; overwriting with framework source`);
      }
    }

    if (isDry) {
      console.log(`  - would refresh roles/${file}`);
    } else {
      copyTemplateFile(srcPath, destPath, { stateDirName });
      console.log(`  - refreshed roles/${file}`);
    }
  }

  for (const file of installedFiles) {
    if (!sourceFiles.includes(file)) {
      if (isDry) {
        console.log(`  - would remove orphan roles/${file}`);
      } else {
        const orphanPath = join(localRolesDir, file);
        if (existsSync(orphanPath)) {
          unlinkSync(orphanPath);
        }
        console.log(`  - removed orphan roles/${file}`);
      }
    }
  }
}
