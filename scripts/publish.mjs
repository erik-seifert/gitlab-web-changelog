#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

const EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'options.html',
  'options.css',
  'options.js',
  'popup.html',
  'popup.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
const out = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();

const bumpVersion = (version, type) => {
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

const createZip = (version) =>
  new Promise((resolve, reject) => {
    const zipPath = path.join(ROOT, `extension-v${version}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    archive.pipe(output);

    for (const file of EXTENSION_FILES) {
      archive.file(path.join(ROOT, file), { name: file });
    }

    archive.finalize();
  });

async function main() {
  const bumpType = ['major', 'minor', 'patch'].includes(process.argv[2])
    ? process.argv[2]
    : 'patch';

  const dirty = out('git status --porcelain');
  if (dirty) {
    console.error('Error: working tree is not clean. Commit or stash changes first.\n' + dirty);
    process.exit(1);
  }

  // Bump version in manifest.json and package.json
  const manifestPath = path.join(ROOT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const oldVersion = manifest.version;
  const newVersion = bumpVersion(oldVersion, bumpType);

  manifest.version = newVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  console.log(`Version: ${oldVersion} → ${newVersion}`);

  // Commit and tag
  run('git add manifest.json package.json');
  run(`git commit -m "chore: release v${newVersion}"`);

  const tag = `v${newVersion}`;
  run(`git tag ${tag}`);
  run('git push');
  run(`git push origin ${tag}`);
  console.log(`Git tag ${tag} created and pushed.`);

  // Build ZIP
  console.log('Building ZIP…');
  const zipPath = await createZip(newVersion);
  console.log(`Done — ${path.basename(zipPath)} (${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error('\nPublish failed:', err.message);
  process.exit(1);
});
