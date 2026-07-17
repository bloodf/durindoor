#!/usr/bin/env node
// migrate-from-9router.mjs - one-shot cutover from a 9router install to DurinDoor.
// Idempotent. NEVER rewrites API key strings (those are runtime-compatible as-is).
// Backups ~/.9router into a tar BEFORE any move, and backs up the existing
// ~/.durindoor directory BEFORE rewriting provider labels in merge mode.
//
// SAFETY PROPERTIES:
//   1. Idempotent: re-running on a migrated install prints "no migration needed" and exits.
//   2. Backup: ~/.9router is tarred into ~/.9router-backup-<iso-stamp>.tar BEFORE any move.
//      KEEP that tar file. Restore via `tar -xf <tarball>.tar -C /`.
//   3. Merge-mode backup: when both dirs exist, the pre-existing ~/.durindoor tree is
//      tarred before any config rewrite so the prior state can be restored.
//   4. No destructive overwrite: merge mode never overwrites files already in ~/.durindoor.
//   5. Database (API key) untouched: only TOML/JSON/JSON5 config files under the
//      durindoor data dir are rewritten (provider-section labels). SQLite files are NOT
//      iterated. Existing `sk_9router-*` API keys continue to work via runtime-compat
//      validators in src/shared/utils/apiKey.js.
//   6. Dry-run: `--dry-run` prints intended actions without renaming/copying/writing.
//   7. SIGINT / I/O failure mid-move: caught, backup tar restored (move mode only), exit 1.
//   8. Narrow rewrites: only `[providers.9router]`, `[model_providers.9router]`,
//      `[provider.9router]` TOML sections, the TOML `model_provider = "9router"` assignment,
//      and JSON/JSON5 keys under `provider`/`providers`/`model_providers` are renamed.
//      Provider-prefixed model ids (e.g. `9router/...`) are kept in sync within the same
//      provider object.
//
// FAILURE MODES:
//   - tar failure: script exits nonzero before any move; source unchanged.
//   - SIGINT or I/O failure after a move started: the partially-created target dir is
//     removed and ~/.9router is restored from the backup tar; exits nonzero.
//   - merge mode is purely additive (skip-on-collision) -- a failure mid-merge leaves
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
import { fileURLToPath } from 'node:url';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
function has(name) { return process.argv.includes(name); }

const PROVIDER_CONTAINER_KEYS = new Set(['provider', 'providers', 'model_providers']);

function parseQuotedString(s, i) {
  const quote = s[i];
  let raw = quote;
  let value = '';
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') {
      const esc = s[j + 1] || '';
      raw += c + esc;
      value += c + esc;
      j += 2;
      continue;
    }
    if (c === quote) {
      raw += c;
      j++;
      break;
    }
    raw += c;
    value += c;
    j++;
  }
  return { raw, value, end: j };
}

function buildRenamedScopes(s) {
  const providerContainerStarts = new Set();
  const parentOfRenamedStarts = new Set();
  const stack = [];
  let lastKey = null;
  let expectKey = true;
  let i = 0;

  function currentFrame() { return stack[stack.length - 1]; }

  while (i < s.length) {
    const c = s[i];

    if (/\s/.test(c)) { i++; continue; }

    if (c === '/' && s[i + 1] === '/') {
      const end = s.indexOf('\n', i);
      if (end === -1) break;
      i = end;
      continue;
    }

    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }

    if (c === '{' || c === '[') {
      const frame = currentFrame();
      const key = frame && frame.type === 'object' ? lastKey : null;
      stack.push({ type: c === '{' ? 'object' : 'array', start: i, key });
      expectKey = c === '{';
      lastKey = null;
      i++;
      continue;
    }

    if (c === '}' || c === ']') {
      stack.pop();
      expectKey = false;
      i++;
      continue;
    }

    if (c === ':') { expectKey = false; i++; continue; }

    if (c === ',') {
      const frame = currentFrame();
      if (frame && frame.type === 'object') expectKey = true;
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      const { value, end } = parseQuotedString(s, i);
      const frame = currentFrame();
      if (frame && frame.type === 'object' && expectKey) {
        lastKey = value;
        if (PROVIDER_CONTAINER_KEYS.has(frame.key) && value === '9router') {
          providerContainerStarts.add(frame.start);
          const parent = stack[stack.length - 2];
          if (parent) parentOfRenamedStarts.add(parent.start);
        }
        expectKey = false;
      }
      i = end;
      continue;
    }

    const frame = currentFrame();
    if (frame && frame.type === 'object' && expectKey) {
      const start = i;
      while (i < s.length && /[A-Za-z0-9_$]/.test(s[i])) i++;
      const rawKey = s.slice(start, i);
      if (rawKey) {
        lastKey = rawKey;
        if (PROVIDER_CONTAINER_KEYS.has(frame.key) && rawKey === '9router') {
          providerContainerStarts.add(frame.start);
          const parent = stack[stack.length - 2];
          if (parent) parentOfRenamedStarts.add(parent.start);
        }
        expectKey = false;
      }
      continue;
    }

    i++;
  }

  return { providerContainerStarts, parentOfRenamedStarts };
}

function rewriteJsonLike(s) {
  const { providerContainerStarts, parentOfRenamedStarts } = buildRenamedScopes(s);
  const stack = [];
  let lastKey = null;
  let expectKey = true;
  let out = '';
  let i = 0;

  function currentFrame() { return stack[stack.length - 1]; }

  while (i < s.length) {
    const c = s[i];

    if (/\s/.test(c)) {
      out += c;
      i++;
      continue;
    }

    if (c === '/' && s[i + 1] === '/') {
      const end = s.indexOf('\n', i);
      if (end === -1) { out += s.slice(i); break; }
      out += s.slice(i, end);
      i = end;
      continue;
    }

    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end === -1) { out += s.slice(i); break; }
      out += s.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    if (c === '"' || c === "'") {
      const { raw, value, end } = parseQuotedString(s, i);
      const frame = currentFrame();
      const isKey = frame && frame.type === 'object' && expectKey;
      if (isKey) {
        lastKey = value;
        if (PROVIDER_CONTAINER_KEYS.has(frame.key) && value === '9router') {
          out += raw.replace('9router', 'durindoor');
        } else {
          out += raw;
        }
        expectKey = false;
      } else {
        if (value.startsWith('9router/') && frame && (frame.renamed || frame.anyProviderRenamed)) {
          out += raw.replace('9router/', 'durindoor/');
        } else {
          out += raw;
        }
      }
      i = end;
      continue;
    }

    if (c === '{') {
      const parent = currentFrame();
      const inherited = parent ? (parent.renamed || parent.anyProviderRenamed) : false;
      const start = i;
      const key = parent && parent.type === 'object' ? lastKey : null;
      stack.push({
        type: 'object',
        start,
        key,
        renamed: providerContainerStarts.has(start),
        anyProviderRenamed: parentOfRenamedStarts.has(start) || inherited,
      });
      expectKey = true;
      lastKey = null;
      out += c;
      i++;
      continue;
    }

    if (c === '}') {
      stack.pop();
      expectKey = false;
      out += c;
      i++;
      continue;
    }

    if (c === '[') {
      const parent = currentFrame();
      const inherited = parent ? (parent.renamed || parent.anyProviderRenamed) : false;
      stack.push({
        type: 'array',
        start: i,
        key: parent && parent.type === 'object' ? lastKey : null,
        renamed: false,
        anyProviderRenamed: inherited,
      });
      expectKey = false;
      out += c;
      i++;
      continue;
    }

    if (c === ']') {
      stack.pop();
      expectKey = false;
      out += c;
      i++;
      continue;
    }

    if (c === ':') {
      expectKey = false;
      out += c;
      i++;
      continue;
    }

    if (c === ',') {
      const frame = currentFrame();
      if (frame && frame.type === 'object') expectKey = true;
      out += c;
      i++;
      continue;
    }

    const frame = currentFrame();
    if (frame && frame.type === 'object' && expectKey) {
      const start = i;
      while (i < s.length && /[A-Za-z0-9_$]/.test(s[i])) i++;
      const rawKey = s.slice(start, i);
      if (rawKey) {
        lastKey = rawKey;
        if (PROVIDER_CONTAINER_KEYS.has(frame.key) && rawKey === '9router') {
          out += rawKey.replace('9router', 'durindoor');
        } else {
          out += rawKey;
        }
      }
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

function rewriteToml(s) {
  return s
    // Known provider TOML section headers only.
    .replace(/^(\s*)\[(providers|model_providers|provider)\.9router\]/gm, '$1[$2.durindoor]')
    // TOML model_provider = "9router" assignment (Codex config.toml)
    .replace(/(^\s*model_provider\s*=\s*)(["'])9router\2/gm, '$1$2durindoor$2');
}

export function rewriteProviderLabels(s, ext) {
  if (ext === 'toml') return rewriteToml(s);
  if (ext === 'json' || ext === 'json5') return rewriteJsonLike(s);
  return s;
}

function walk(dir, fn) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, fn);
    else fn(p);
  }
}

export class Migrator {
  constructor({ targetDir, legacyDir, dryRun, backupRoot, targetBackupRoot }) {
    this.targetDir = targetDir;
    this.legacyDir = legacyDir;
    this.dryRun = dryRun;
    this.backupRoot = backupRoot;
    this.targetBackupRoot = targetBackupRoot ?? backupRoot.replace(/\.9router-backup-/, '.durindoor-backup-');
    this.backupMade = false;
    this.lastBackupPath = null;
    this.targetBackupPath = null;
    this.mode = null;
  }

  log(s) { console.error('[migrate-from-9router] ' + s); }

  backup(srcDir, root = this.backupRoot) {
    if (!existsSync(srcDir)) return null;
    mkdirSync(dirname(root), { recursive: true });
    let dest = root;
    let n = 1;
    while (existsSync(dest)) dest = root.replace(/\.tar$/, '-' + (++n) + '.tar');
    this.log('backup ' + srcDir + ' -> ' + dest);
    if (this.dryRun) return null;
    const result = spawnSync('tar', ['-cf', dest, '-C', dirname(srcDir), '--', basename(srcDir)], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('tar backup failed for ' + srcDir);
    this.backupMade = true;
    return dest;
  }

  // Undo a partially-completed move: drop any half-written targetDir and re-extract
  // the pristine legacyDir from the backup tar. Merge mode is purely additive
  // (skip-on-collision) so legacyDir is never mutated -- nothing to undo there.
  restoreFromBackup() {
    if (!this.backupMade || !this.lastBackupPath || !existsSync(this.lastBackupPath)) return;
    if (this.mode !== 'move') return;
    this.log('restoring from backup: ' + this.lastBackupPath);
    if (existsSync(this.targetDir) && !existsSync(this.legacyDir)) {
      rmSync(this.targetDir, { recursive: true, force: true });
    }
    spawnSync('tar', ['-xf', this.lastBackupPath, '-C', dirname(this.legacyDir)], { stdio: 'inherit' });
  }

  fail(err) {
    this.log('ERROR: ' + (err && err.message ? err.message : err));
    this.restoreFromBackup();
    process.exit(1);
  }

  rewriter(targetPath) {
    const ext = basename(targetPath).split('.').pop();
    if (!['toml', 'json', 'json5'].includes(ext)) return false;
    const orig = readFileSync(targetPath, 'utf8');
    const next = rewriteProviderLabels(orig, ext);
    if (next === orig) return false;
    if (this.dryRun) this.log('would rewrite ' + targetPath);
    else writeFileSync(targetPath, next);
    return true;
  }

  run() {
    process.on('SIGINT', () => this.fail(new Error('interrupted (SIGINT)')));

    let rewriteRoot = null;
    try {
      if (!existsSync(this.targetDir) && existsSync(this.legacyDir)) {
        this.mode = 'move';
        this.log('move: ' + this.legacyDir + ' -> ' + this.targetDir);
        this.lastBackupPath = this.backup(this.legacyDir);
        if (!this.dryRun) renameSync(this.legacyDir, this.targetDir);
        rewriteRoot = this.dryRun ? this.legacyDir : this.targetDir;
      } else if (existsSync(this.legacyDir) && existsSync(this.targetDir)) {
        this.mode = 'merge';
        this.log('merge: copy unique files from ' + this.legacyDir + ' into ' + this.targetDir);
        this.lastBackupPath = this.backup(this.legacyDir);
        // Back up the pre-existing target tree BEFORE adding legacy files or rewriting.
        if (existsSync(this.targetDir)) {
          this.targetBackupPath = this.backup(this.targetDir, this.targetBackupRoot);
        }
        walk(this.legacyDir, (p) => {
          const rel = p.slice(this.legacyDir.length + 1);
          const dest = join(this.targetDir, rel);
          if (existsSync(dest)) return;
          const dir = dirname(dest);
          if (!this.dryRun) mkdirSync(dir, { recursive: true });
          if (!this.dryRun) copyFileSync(p, dest);
          this.log('merge ' + rel);
        });
        rewriteRoot = this.targetDir;
      } else {
        this.log('no migration needed (one or both dirs missing)');
      }

      let rewrote = 0;
      if (rewriteRoot) {
        walk(rewriteRoot, (p) => { if (this.rewriter(p)) rewrote++; });
      }
      this.log('rewrote provider-section labels in ' + rewrote + ' file(s)');
    } catch (err) {
      this.fail(err);
    }

    if (this.dryRun) this.log('--dry-run; no files changed');
    this.log('done');
  }

  // Test accessors
  getMode() { return this.mode; }
  setMode(mode) { this.mode = mode; }
  getBackupPath() { return this.lastBackupPath; }
  setBackupPath(p) { this.lastBackupPath = p; this.backupMade = true; }
  getTargetBackupPath() { return this.targetBackupPath; }
}

if (import.meta.url && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const targetDir = arg('--target-dir', join(homedir(), '.durindoor'));
  const legacyDir = arg('--legacy-dir',  join(homedir(), '.9router'));
  const dryRun = has('--dry-run');
  const backupRoot = join(homedir(), '.9router-backup-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16) + '.tar');
  new Migrator({ targetDir, legacyDir, dryRun, backupRoot }).run();
}
