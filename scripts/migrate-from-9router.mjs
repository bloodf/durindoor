#!/usr/bin/env node
// migrate-from-9router.mjs - one-shot cutover from a 9router install to DurinDoor.
// Idempotent. NEVER rewrites API key strings (those are runtime-compatible as-is).
// Backups ~/.9router into a tar BEFORE any move.
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
//   6. SIGINT / I/O failure mid-move: caught, backup tar restored (move mode only), exit 1.
//
// FAILURE MODES:
//   - tar failure: script exits nonzero before any move; source unchanged.
//   - SIGINT or I/O failure after a move started: the partially-created target dir is
//     removed and ~/.9router is restored from the backup tar; exits nonzero.
//   - merge mode is purely additive (skip on collision) — a failure mid-merge leaves
//     ~/.9router untouched and ~/.durindoor with whatever files copied so far; re-run
//     to resume (idempotent).
//   - YAML/INI/plain config files with "9router" labels are NOT touched (extension filter
//     is .toml/.json/.json5). Manual follow-up required for those.
//
// USAGE:
//   node scripts/migrate-from-9router.mjs --dry-run
//   node scripts/migrate-from-9router.mjs
//   node scripts/migrate-from-9router.mjs --target-dir <path> --legacy-dir <path>
import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
function has(name) { return process.argv.includes(name); }

const targetDir  = arg('--target-dir', join(homedir(), '.durindoor'));
const legacyDir  = arg('--legacy-dir',  join(homedir(), '.9router'));
const dryRun     = has('--dry-run');
const backupRoot = join(homedir(), '.9router-backup-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16) + '.tar');

function log(s) { console.error('[migrate-from-9router] ' + s); }

function rewriteProviderLabels(s) {
  return s
    // TOML section headers: [providers.9router], [model_providers.9router] -> durindoor
    .replace(/\[([\w.]*\.)?9router\]/g, (_, prefix) => '[' + (prefix || '') + 'durindoor]')
    // JSON/JS object key acting as a provider-section label: "9router": { ... } / '9router': { ... }
    .replace(/(["'])9router\1(?=\s*:)/g, '$1durindoor$1')
    // TOML model_provider = "9router" assignment (Codex config.toml)
    .replace(/(^\s*model_provider\s*=\s*)(["'])9router\2/gm, '$1$2durindoor$2');
}

function rewriter(targetPath) {
  const ext = basename(targetPath).split('.').pop();
  if (!['toml', 'json', 'json5'].includes(ext)) return false;
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

let backupMade = false;
let lastBackupPath = null;
let mode = null; // 'move' | 'merge' | null

function backup(srcDir) {
  if (!existsSync(srcDir)) return;
  mkdirSync(dirname(backupRoot), { recursive: true });
  // Never clobber a prior backup made in the same minute (e.g. re-run after a failure).
  let dest = backupRoot;
  let n = 1;
  while (existsSync(dest)) dest = backupRoot.replace(/\.tar$/, '-' + (++n) + '.tar');
  log('backup ' + srcDir + ' -> ' + dest);
  if (dryRun) return;
  const result = spawnSync('tar', ['-cf', dest, '-C', dirname(srcDir), '--', basename(srcDir)], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('tar backup failed for ' + srcDir);
  backupMade = true;
  lastBackupPath = dest;
}

// Undo a partially-completed move: drop any half-written targetDir and re-extract
// the pristine legacyDir from the backup tar. Merge mode is purely additive
// (skip-on-collision) so legacyDir is never mutated — nothing to undo there.
function restoreFromBackup() {
  if (!backupMade || !lastBackupPath || !existsSync(lastBackupPath)) return;
  if (mode !== 'move') return;
  log('restoring from backup: ' + lastBackupPath);
  if (existsSync(targetDir) && !existsSync(legacyDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  spawnSync('tar', ['-xf', lastBackupPath, '-C', dirname(legacyDir)], { stdio: 'inherit' });
}

function fail(err) {
  log('ERROR: ' + (err && err.message ? err.message : err));
  restoreFromBackup();
  process.exit(1);
}

process.on('SIGINT', () => fail(new Error('interrupted (SIGINT)')));

let rewriteRoot = null;
try {
  if (!existsSync(targetDir) && existsSync(legacyDir)) {
    mode = 'move';
    log('move: ' + legacyDir + ' -> ' + targetDir);
    backup(legacyDir);
    if (!dryRun) renameSync(legacyDir, targetDir);
    rewriteRoot = dryRun ? legacyDir : targetDir;
  } else if (existsSync(legacyDir) && existsSync(targetDir)) {
    mode = 'merge';
    log('merge: copy unique files from ' + legacyDir + ' into ' + targetDir);
    backup(legacyDir);
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
} catch (err) {
  fail(err);
}

if (dryRun) log('--dry-run; no files changed');
log('done');
