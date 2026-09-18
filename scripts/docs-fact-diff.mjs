#!/usr/bin/env node
/**
 * Compare a pre-humanizer draft against the final page and report lost fact tokens.
 *
 * Tokens: URLs; [A-Z][A-Z0-9_]{3,}; `npm run x` / `npx x`; ports 20127/20128/11434
 * or 4-5 digit numbers preceded by `:` or `port`; semver; backticked identifiers.
 *
 * Usage:
 *   node scripts/docs-fact-diff.mjs <pre> <final> [--added]
 *   node scripts/docs-fact-diff.mjs --all [--added]
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, "..");
export const DRAFTS_DIR = path.join(root, ".omc", "plans", "docs-fumadocs", "notes", "drafts");

const ENV_RE = /\b[A-Z][A-Z0-9_]{3,}\b/g;
const NPM_RE = /\bnpm run ([a-z:][a-zA-Z0-9:-]*)/g;
const NPX_RE = /\bnpx ([a-zA-Z0-9@/_.:-]+)/g;
const URL_RE = /https?:\/\/[^\s)\]>'"`]+/g;
const PORT_RE = /(?:port\s*:?\s*|:)(20127|20128|11434|\d{4,5})\b/gi;
const SEMVER_RE = /\b\d+\.\d+\.\d+\b/g;

export function stripFences(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^(\s{0,3})(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fenceChar = fenceMatch[2][0];
      const fenceLen = fenceMatch[2].length;
      i++;
      while (i < lines.length) {
        const closeMatch = lines[i].match(/^(\s{0,3})(`{3,}|~{3,})/);
        if (closeMatch && closeMatch[2][0] === fenceChar && closeMatch[2].length >= fenceLen) {
          i++;
          break;
        }
        i++;
      }
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join("\n");
}

function addAll(set, re, text, prefix = "") {
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    set.add(prefix ? `${prefix}${m[1]}` : m[0]);
  }
}

export function extractTokens(text) {
  const tokens = new Set();
  addAll(tokens, URL_RE, text);
  addAll(tokens, ENV_RE, text);
  addAll(tokens, NPM_RE, text, "npm run ");
  addAll(tokens, NPX_RE, text, "npx ");
  PORT_RE.lastIndex = 0;
  for (const m of text.matchAll(PORT_RE)) tokens.add(m[1]);
  addAll(tokens, SEMVER_RE, text);

  const unfenced = stripFences(text);
  for (const m of unfenced.matchAll(/`([^`\n]+)`/g)) {
    const id = m[1].trim();
    if (id) tokens.add(`\`${id}\``);
  }
  return tokens;
}

export function diffTokens(preText, finalText) {
  const pre = extractTokens(preText);
  const final = extractTokens(finalText);
  const lost = [...pre].filter((t) => !final.has(t)).sort();
  const added = [...final].filter((t) => !pre.has(t)).sort();
  return { lost, added };
}

async function readUtf8(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return "";
  }
}

async function collectPreMdx(dir) {
  let names;
  try {
    names = await readdir(dir, { recursive: true });
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".pre.mdx"))
    .map((n) => path.join(dir, n))
    .sort();
}

export async function comparePair(prePath, finalPath) {
  const preText = await readUtf8(prePath);
  const finalText = await readUtf8(finalPath);
  return { prePath, finalPath, ...diffTokens(preText, finalText) };
}

export async function compareAll(cwd = root) {
  const drafts = path.join(cwd, ".omc", "plans", "docs-fumadocs", "notes", "drafts");
  const files = await collectPreMdx(drafts);
  const results = [];
  for (const prePath of files) {
    const rel = path.relative(drafts, prePath);
    const finalRel = rel.replace(/\.pre\.mdx$/, ".mdx");
    const finalPath = path.join(cwd, finalRel);
    results.push(await comparePair(prePath, finalPath));
  }
  return results;
}

function printResult(result, { showAdded }) {
  const label = `${path.relative(root, result.prePath)} -> ${path.relative(root, result.finalPath)}`;
  if (result.lost.length) {
    console.error(`lost: ${label}`);
    for (const t of result.lost) console.error(t);
  }
  if (showAdded && result.added.length) {
    console.log(`added: ${label}`);
    for (const t of result.added) console.log(t);
  }
}

export async function main(argv = process.argv.slice(2), cwd = root) {
  const flags = new Set(argv.filter((a) => a.startsWith("-")));
  const positional = argv.filter((a) => !a.startsWith("-"));
  const showAdded = flags.has("--added");
  let lostCount = 0;

  if (flags.has("--all")) {
    const results = await compareAll(cwd);
    for (const result of results) {
      printResult(result, { showAdded });
      lostCount += result.lost.length;
    }
    return lostCount ? 1 : 0;
  }

  const [pre, final] = positional;
  if (!pre || !final) {
    console.error("usage: node scripts/docs-fact-diff.mjs <pre> <final> [--added]");
    console.error("       node scripts/docs-fact-diff.mjs --all [--added]");
    return 2;
  }
  const result = await comparePair(path.resolve(cwd, pre), path.resolve(cwd, final));
  printResult(result, { showAdded });
  lostCount = result.lost.length;
  return lostCount ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
