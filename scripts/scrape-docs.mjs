#!/usr/bin/env node
// scrape-docs.mjs - produce a docs scaffold from the in-repo source files.
//
// Behaviour (READ-ONLY on doc content):
//   - Discovers every locale listed under public/i18n/literals/<locale>.json
//     in this repository.
//   - Discovers every locale README.md in i18n/README.<locale>.md.
//   - Writes docs/i18n/<locale>/status.json with translation status fields
//     (totalPages, translated, reviewed, lastSyncIso, sources).
//   - Writes docs/site/index.md with a locale index (English source first).
//   - NO remote network requests. NO translations produced. --dry-run prints
//     actions without writing.
//
// USAGE:
//   node scripts/scrape-docs.mjs --dry-run
//   node scripts/scrape-docs.mjs
//
// LOCALE LIST: derived at runtime from `public/i18n/literals/`.

import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i+1] : def;
}
function has(name) { return process.argv.includes(name); }
const dryRun = has('--dry-run');

function log(...a) { console.error('[scrape-docs]', ...a); }

function listLocaleDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => basename(e.name, '.json'))
    .sort();
}
function listI18nReadmes(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /^README\.[^.]+\.md$/.test(e.name))
    .map((e) => e.name.replace(/^README\.|\.md$/g, ''))
    .sort();
}

const literalsDir = join(repoRoot, 'public/i18n/literals');
const i18nDir     = join(repoRoot, 'i18n');

const locales     = listLocaleDirs(literalsDir);   // 32 locales
const readmes     = listI18nReadmes(i18nDir);      // a subset
const repoRootDocs = join(repoRoot, 'docs');
const outI18n     = join(repoRootDocs, 'i18n');
const outSite     = join(repoRootDocs, 'site');

const totalPages = locales.length + readmes.length;

log('discovered', { locales: locales.length, readmes: readmes.length });

const written = [];
function writeMaybe(relPath, content) {
  if (dryRun) { written.push(`[dry] ${relPath}`); return; }
  mkdirSync(dirname(relPath), { recursive: true });
  writeFileSync(relPath, content);
  written.push(relPath);
}

// Per-locale status files
for (const loc of locales) {
  const hasReadme = readmes.includes(loc) || readmes.includes(loc.replace(/-/g, '-'));
  const status = {
    locale: loc,
    totalPages,
    translated: hasReadme ? 1 : 0,
    reviewed:   0,
    lastSyncIso: new Date().toISOString(),
    sources:    [
      `public/i18n/literals/${loc}.json`,
      hasReadme ? `i18n/README.${loc}.md` : null,
    ].filter(Boolean),
    notes: hasReadme
      ? 'i18n literals + README present; per-page review still required.'
      : 'i18n literals present; README.md MISSING. Open a tracking issue for this locale.',
  };
  writeMaybe(
    join(outI18n, loc, 'status.json'),
    JSON.stringify(status, null, 2) + '\n',
  );
}

// English source index (no translations produced)
const readmesPresent = readmes.filter((l) => existsSync(join(i18nDir, `README.${l}.md`)));

const indexBody = [
  '# DurinDoor Documentation Index',
  '',
  '> Scaffold-only. Per-locale content files (`docs/i18n/<locale>/...`) are placeholders pending human review per the user mandate: "we can scrape the website docs for now and keep only in the repository as .md files, until we have a 100% stable documentation ready before going with the website."',
  '',
  '## English source',
  '',
  '- [`README.md`](../README.md) — top-level entry point',
  '- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — system architecture overview',
  '- [`docs/pr-mcp-gateway.md`](pr-mcp-gateway.md) — MCP gateway internals',
  '',
  '## Locales (snapshot from `public/i18n/literals/`)',
  '',
  'Each entry links to a `status.json` (translation progress) and any in-repo `i18n/README.<locale>.md` if present.',
  '',
  ...locales.map((loc) => {
    const hasRm = readmesPresent.includes(loc);
    const link = hasRm ? `[i18n/README.${loc}.md](../i18n/README.${loc}.md)` : '_(README missing)_';
    return `- **${loc}** — ${link} · [status.json](i18n/${loc}/status.json)`;
  }),
  '',
  '## How to add or update a locale',
  '',
  '1. Edit `i18n/README.<locale>.md` directly in-repo.',
  '2. Keep the source English content stable in `docs/ARCHITECTURE.md` / `README.md`.',
  '3. After updating, re-run `node scripts/scrape-docs.mjs` to refresh per-locale `status.json`.',
  '4. Open a PR per locale; reviewers per the brand-sweep-internal AGENTS.md contract must verify both docs and tests where applicable.',
  '',
  '## Pending follow-ups',
  '',
  '- Per-locale README translations for locales WITHOUT one yet (e.g. many of the 32 locale codes listed).',
  '- Per-page translation matching public/i18n/literals entries to a structured `docs/site/en/` mirror.',
  '- Removal of fallback 9router reads in `i18n/README.<locale>.md` originals during the larger brand-sweep.',
  '',
].join('\n');

writeMaybe(join(outSite, 'index.md'), indexBody);

// Decide whether docs/i18n/<locale>/<locale>.md stubs should be written.
// Per user instruction, NO fake translated content. Only status.json per locale.

const summary = { totalLocales: locales.length, localesWithReadme: readmesPresent.length };
if (dryRun) {
  log('dry-run summary:', summary);
  log('would write', written.length, 'files');
} else {
  log('summary:', summary);
  log('wrote', written.length, 'files');
}
