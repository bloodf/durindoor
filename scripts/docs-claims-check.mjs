#!/usr/bin/env node
/**
 * Gate G1: every `claim → file:line` row must show the claim's literal token
 * at that line ±10, and every env / `npm run x` / `/v1/...` token in the docs
 * dir must have a citation row.
 *
 * Usage:
 *   node scripts/docs-claims-check.mjs <notes-file> <docs-dir>
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, "..");

const ENV_RE = /\b[A-Z][A-Z0-9_]{3,}\b/g;
const NPM_RE = /\bnpm run ([a-z:][a-zA-Z0-9:-]*)/g;
const ROUTE_RE = /\/v1\/[A-Za-z0-9_/{}.-]+/g;
const PORT_RE = /(?:port\s*:?\s*|:)(20127|20128|11434|\d{4,5})\b/gi;
const CLAIM_RE = /^(?:[-*]\s+)?(.+?)\s*(?:→|->)\s*(\S+):(\d+)\s*$/;

export function parseClaimRows(notesText) {
  const rows = [];
  for (const line of notesText.split("\n")) {
    const m = line.match(CLAIM_RE);
    if (!m) continue;
    rows.push({
      claim: m[1].trim(),
      file: m[2],
      line: Number(m[3]),
      raw: line.trim(),
    });
  }
  return rows;
}

export function tokensIn(text) {
  const tokens = new Set();
  for (const m of text.matchAll(ENV_RE)) tokens.add(m[0]);
  for (const m of text.matchAll(NPM_RE)) tokens.add(`npm run ${m[1]}`);
  for (const m of text.matchAll(ROUTE_RE)) tokens.add(m[0].replace(/[.,;:]+$/, ""));
  for (const m of text.matchAll(PORT_RE)) tokens.add(m[1]);
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const id = m[1].trim();
    if (id) tokens.add(id);
  }
  return tokens;
}

/** Tokens G1 requires a citation for when they appear in a page. */
export function pageCitationTokens(text) {
  const tokens = new Set();
  for (const m of text.matchAll(ENV_RE)) tokens.add(m[0]);
  for (const m of text.matchAll(NPM_RE)) tokens.add(`npm run ${m[1]}`);
  for (const m of text.matchAll(ROUTE_RE)) tokens.add(m[0].replace(/[.,;:]+$/, ""));
  return tokens;
}

export function windowAround(text, line, radius = 10) {
  const lines = text.split("\n");
  const idx = Math.max(0, line - 1);
  const from = Math.max(0, idx - radius);
  const to = Math.min(lines.length, idx + radius + 1);
  return lines.slice(from, to).join("\n");
}

async function listPages(docsDir) {
  let names;
  try {
    names = await readdir(docsDir, { recursive: true });
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".mdx") || n.endsWith(".md"))
    .map((n) => path.join(docsDir, n))
    .sort();
}

export async function checkClaims({ notesPath, docsDir, cwd = root, read }) {
  const readUtf8 = read || ((p) => readFile(p, "utf8"));
  const issues = [];
  const notesText = await readUtf8(path.resolve(cwd, notesPath));
  const rows = parseClaimRows(notesText);
  const cited = new Set();

  for (const row of rows) {
    const abs = path.resolve(cwd, row.file);
    let source;
    try {
      source = await readUtf8(abs);
    } catch {
      issues.push(`${row.raw}: missing file ${row.file}`);
      continue;
    }
    const slice = windowAround(source, row.line, 10);
    const claimTokens = tokensIn(row.claim);
    if (claimTokens.size === 0) {
      const needle = row.claim.replace(/`/g, "").trim();
      if (needle && !slice.includes(needle) && !slice.includes(row.claim)) {
        issues.push(`${row.raw}: claim token absent at ${row.file}:${row.line} ±10`);
      }
      continue;
    }
    const stillMissing = [...claimTokens].filter((t) => {
      if (slice.includes(t)) return false;
      if (t.startsWith("npm run ") && slice.includes(t.slice("npm run ".length))) return false;
      return true;
    });
    if (stillMissing.length) {
      issues.push(
        `${row.raw}: claim token ${stillMissing.join(", ")} absent at ${row.file}:${row.line} ±10`,
      );
    }
    for (const t of claimTokens) cited.add(t);
    cited.add(row.claim);
  }

  const citedBlob = `${notesText}\n${[...cited].join("\n")}`;
  const pages = await listPages(path.resolve(cwd, docsDir));
  for (const page of pages) {
    let text;
    try {
      text = await readUtf8(page);
    } catch {
      continue;
    }
    const rel = path.relative(cwd, page);
    for (const token of pageCitationTokens(text)) {
      if (!citedBlob.includes(token)) {
        issues.push(`${rel}: uncited token ${token}`);
      }
    }
  }

  issues.sort();
  return issues;
}

export async function main(argv = process.argv.slice(2), cwd = root) {
  const [notesPath, docsDir] = argv;
  if (!notesPath || !docsDir) {
    console.error("usage: node scripts/docs-claims-check.mjs <notes-file> <docs-dir>");
    return 2;
  }
  const issues = await checkClaims({ notesPath, docsDir, cwd });
  if (issues.length) {
    console.error(issues.join("\n"));
    return 1;
  }
  console.log("Docs claims check passed.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
