// templates.mjs - Project template and role installation/refresh helpers

import { existsSync, mkdirSync, readdirSync, cpSync, unlinkSync } from 'fs';
import { join } from 'path';
import { fileHash, readManifest } from './manifest.mjs';

export function installProjectTemplates({ planningDir, distilledDir, agentsDir }) {
  const localTemplatesDir = join(planningDir, 'templates');
  const globalTemplatesDir = join(distilledDir, 'templates');

  if (!existsSync(localTemplatesDir)) {
    if (existsSync(globalTemplatesDir)) {
      cpSync(globalTemplatesDir, localTemplatesDir, { recursive: true });
      console.log('  - copied templates to .planning/templates/');
    } else {
      console.log('  - WARN: missing distilled/templates/; cannot copy templates');
    }
  } else {
    console.log('  - .planning/templates/ already exists');
  }

  const localRolesDir = join(localTemplatesDir, 'roles');
  if (!existsSync(localRolesDir)) {
    if (existsSync(agentsDir)) {
      mkdirSync(localRolesDir, { recursive: true });
      for (const file of listRoleFiles(agentsDir)) {
        cpSync(join(agentsDir, file), join(localRolesDir, file));
      }
      console.log('  - copied role contracts to .planning/templates/roles/');
    } else {
      console.log('  - WARN: missing agents/; cannot copy role contracts');
    }
  } else {
    console.log('  - .planning/templates/roles/ already exists');
  }
}

export function refreshTemplates({ planningDir, distilledDir, agentsDir, isDry = false }) {
  const existingManifest = readManifest(planningDir);
  const globalTemplatesDir = join(distilledDir, 'templates');
  const localTemplatesDir = join(planningDir, 'templates');

  const categories = [
    { name: 'delegates', src: join(globalTemplatesDir, 'delegates'), dest: join(localTemplatesDir, 'delegates'), manifestKey: 'delegates' },
    { name: 'research', src: join(globalTemplatesDir, 'research'), dest: join(localTemplatesDir, 'research'), manifestKey: 'research' },
    { name: 'codebase', src: join(globalTemplatesDir, 'codebase'), dest: join(localTemplatesDir, 'codebase'), manifestKey: 'codebase' },
  ];

  for (const category of categories) {
    refreshCategory(category, existingManifest, isDry);
  }

  refreshRootTemplates(globalTemplatesDir, localTemplatesDir, existingManifest, isDry);
  refreshRoles(agentsDir, join(localTemplatesDir, 'roles'), existingManifest, isDry);
}

function listRoleFiles(agentsDir) {
  return readdirSync(agentsDir).filter(
    (file) => file.endsWith('.md') && file !== 'README.md' && !file.startsWith('_')
  );
}

function refreshCategory({ name, src, dest, manifestKey }, existingManifest, isDry) {
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
    const srcHash = fileHash(srcPath);

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
      cpSync(srcPath, destPath);
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

function refreshRootTemplates(globalTemplatesDir, localTemplatesDir, existingManifest, isDry) {
  if (!existsSync(globalTemplatesDir)) return;

  const manifestHashes = existingManifest?.templates?.root || null;
  const sourceFiles = readdirSync(globalTemplatesDir).filter((file) => file.endsWith('.md'));

  for (const file of sourceFiles) {
    const srcPath = join(globalTemplatesDir, file);
    const destPath = join(localTemplatesDir, file);
    const srcHash = fileHash(srcPath);

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
      cpSync(srcPath, destPath);
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

function refreshRoles(agentsDir, localRolesDir, existingManifest, isDry) {
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
    const srcHash = fileHash(srcPath);

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
      cpSync(srcPath, destPath);
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
