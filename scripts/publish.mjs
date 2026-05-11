#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import webStore from 'chrome-webstore-upload';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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

const REQUIRED_ENV = [
  'CHROME_EXTENSION_ID',
  'CHROME_CLIENT_ID',
  'CHROME_CLIENT_SECRET',
  'CHROME_REFRESH_TOKEN',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Parse bump type from first argument (default: patch)
  const bumpType = ['major', 'minor', 'patch'].includes(process.argv[2])
    ? process.argv[2]
    : 'patch';

  // Guard: require clean working tree so the tag points to a clean state
  const dirty = out('git status --porcelain');
  if (dirty) {
    console.error('Error: working tree is not clean. Commit or stash changes first.\n' + dirty);
    process.exit(1);
  }

  // Guard: required environment variables
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(
      'Error: missing environment variables:\n' +
        missing.map((k) => `  ${k}`).join('\n') +
        '\n\nSee .env.example — copy to .env and fill in the values.'
    );
    process.exit(1);
  }

  // Bump version in manifest.json
  const manifestPath = path.join(ROOT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const oldVersion = manifest.version;
  const newVersion = bumpVersion(oldVersion, bumpType);
  manifest.version = newVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Version: ${oldVersion} → ${newVersion}`);

  // Commit version bump
  run('git add manifest.json');
  run(`git commit -m "chore: release v${newVersion}"`);

  // Build ZIP
  console.log('Building ZIP…');
  const zipPath = await createZip(newVersion);
  console.log(`  ${path.basename(zipPath)} (${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB)`);

  // Upload to Chrome Web Store
  const store = webStore({
    extensionId: process.env.CHROME_EXTENSION_ID,
    clientId: process.env.CHROME_CLIENT_ID,
    clientSecret: process.env.CHROME_CLIENT_SECRET,
    refreshToken: process.env.CHROME_REFRESH_TOKEN,
  });

  console.log('Uploading to Chrome Web Store…');
  const uploadResult = await store.uploadExisting(fs.createReadStream(zipPath));
  if (uploadResult.uploadState !== 'SUCCESS') {
    console.error('Upload failed:', JSON.stringify(uploadResult, null, 2));
    process.exit(1);
  }
  console.log('  Upload successful.');

  console.log('Publishing…');
  const publishResult = await store.publish();
  // Acceptable statuses: OK (live) or IN_REVIEW (goes to review queue)
  const status = publishResult.status?.[0];
  if (status !== 'OK' && status !== 'IN_REVIEW') {
    console.error('Publish failed:', JSON.stringify(publishResult, null, 2));
    process.exit(1);
  }
  console.log(`  ${status === 'IN_REVIEW' ? 'Submitted for review.' : 'Published.'}`);

  // Git tag + push
  const tag = `v${newVersion}`;
  run(`git tag ${tag}`);
  run('git push');
  run(`git push origin ${tag}`);
  console.log(`  Git tag ${tag} created and pushed.`);

  // Clean up ZIP
  fs.unlinkSync(zipPath);
  console.log(`\nDone — v${newVersion} is live.`);
}

main().catch((err) => {
  console.error('\nPublish failed:', err.message);
  process.exit(1);
});
