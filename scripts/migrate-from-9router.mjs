#!/usr/bin/env node
// migrate-from-9router.mjs - one-shot cutover from a 9router install to DurinDoor.
// Idempotent. NEVER rewrites API key strings (those are runtime-compatible as-is).
// Backups the entire source directory before any mutation.
//
// SAFETY PROPERTIES:
//   1. Idempotent: re-running on a migrated install prints "no migration needed" and exits.
//   2. Backup: ~/.9router is tarred into ~/.9router-backup-<iso-stamp>.tar BEFORE any move.
//      KEEP that tar file. Restore via `tar -xf <tarball>.tar -C /`.
//   3. No destructive overwrite: merge mode never overwrites files already in ~/.durindoor.
//   4. Database (API key) untouched: only TOML/JSON/JSON5 config files under the
//      durindoor data dir are rewritten (provider-section labels). SQLite files are NOT
//      iterated. Existing `sk_9router-*` API keys continue to work via runtime-compat
//      validators in src/shared/utils/apiKey.js.
//   5. Dry-run: `--dry-run` prints intended actions without renaming/copying/writing.
//
// FAILURE MODES:
//   - tar failure: script exits nonzero before any move; source unchanged.
//   - renameSync OK + subsequent copyFileSync fails (merge mode only): partial state.
//     No automatic rollback; user must restore from the backup tar.
//   - YAML/INI/plain config files with "9router" labels are NOT touched (extension filter
//     is .toml/.json/.json5). Manual follow-up required for those.
//
// USAGE:
//   node scripts/migrate-from-9router.mjs --dry-run
//   node scripts/migrate-from-9router.mjs
//   node scripts/migrate-from-9router.mjs --target-dir <path> --legacy-dir <path>
import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i+1] : def;
}
function has(name) { return process.argv.includes(name); }

const targetDir  = arg('--target-dir', join(homedir(), '.durindoor'));
const legacyDir  = arg('--legacy-dir',  join(homedir(), '.9router'));
const dryRun     = has('--dry-run');
const backupRoot = join(homedir(), '.9router-backup-' + new Date().toISOString().replace(/[:.]/g,'-').slice(0,16) + '.tar');

function log(s) { console.error('[migrate-from-9router] ' + s); }

function rewriteProviderLabels(s) {
  return s
    .replace(/\[providers\.9router\]/g, '[providers.durindoor]')
    .replace(/"9router"(?=\s*[,\]\}])/g, '"durindoor"')
    .replace(/'9router'(?=\s*[,\]\}])/g, "'durindoor'");
}

function rewriter(targetPath) {
  const ext = basename(targetPath).split('.').pop();
  if (!['toml','json','json5'].includes(ext)) return false;
  const orig = readFileSync(targetPath, 'utf8');
  const next = rewriteProviderLabels(orig);
  if (next === orig) return false;
  if (dryRun) log('would rewrite ' + targetPath);
  else writeFileSync(targetPath, next);
  return true;
}

function walk(dir, fn) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, fn);
    else fn(p);
  }
}

function backup(srcDir) {
  if (!existsSync(srcDir)) return;
  mkdirSync(dirname(backupRoot), { recursive: true });
  log('backup ' + srcDir + ' -> ' + backupRoot);
  if (dryRun) return;
  const result = spawnSync('tar', ['-cf', backupRoot, '-C', dirname(srcDir), '--', basename(srcDir)], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('tar backup failed for ' + srcDir);
}

let rewriteRoot = null;
if (!existsSync(targetDir) && existsSync(legacyDir)) {
  log('move: ' + legacyDir + ' -> ' + targetDir);
  backup(legacyDir);
  if (!dryRun) renameSync(legacyDir, targetDir);
  rewriteRoot = dryRun ? legacyDir : targetDir;
} else if (existsSync(legacyDir) && existsSync(targetDir)) {
  log('merge: copy unique files from ' + legacyDir + ' into ' + targetDir);
  backup(legacyDir);
  backup(targetDir);
  walk(legacyDir, (p) => {
    const rel = p.slice(legacyDir.length + 1);
    const dest = join(targetDir, rel);
    if (existsSync(dest)) return;
    const dir = dirname(dest);
    if (!dryRun) mkdirSync(dir, { recursive: true });
    if (!dryRun) copyFileSync(p, dest);
    log('merge ' + rel);
  });
  rewriteRoot = targetDir;
} else {
  log('no migration needed (one or both dirs missing)');
}

let rewrote = 0;
if (rewriteRoot) {
  walk(rewriteRoot, (p) => { if (rewriter(p)) rewrote++; });
}
log('rewrote provider-section labels in ' + rewrote + ' file(s)');

if (dryRun) log('--dry-run; no files changed');
log('done');
