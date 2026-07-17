#!/usr/bin/env node
/**
 * Model catalog diff / audit tool.
 *
 * Two modes:
 *
 *   1. Local audit (default, `npm run catalog:diff`):
 *      Loads OUR raw registry (the default export of
 *      `open-sse/providers/registry/index.js` — the same array `providers/index.js`
 *      builds from, NOT the normalized `PROVIDER_MODELS` re-export) plus
 *      `open-sse/providers/pricing.js`, and reports internal consistency defects:
 *        - duplicate model ids within a single provider
 *        - empty / non-string model ids
 *        - `upstreamModelId` references that resolve to no id in the same provider
 *        - `targetFormat` values not present in `open-sse/translator/formats.js#FORMATS`
 *        - pricing rows (`MODEL_PRICING`, `PROVIDER_PRICING`, `PATTERN_PRICING`)
 *          whose id / glob pattern matches NO registry model id (orphan pricing)
 *      Works in any clone/CI with only `origin`. Reviewed-intentional findings are
 *      recorded in `open-sse/config/catalogAllowlist.js` and skipped by default so a
 *      fully-reviewed catalog exits clean; pass `--strict` to show every finding.
 *      Exit 1 when un-reviewed findings exist.
 *
 *   2. Comparison (`--upstream-ref <ref> --omniroute-ref <ref>`):
 *      Reads foreign catalog trees via `git show <ref>:<path>` and emits
 *      `model-catalog-report.md` (committed) with:
 *        - header pinning the exact commit SHAs compared (`git rev-parse <ref>`)
 *        - per-provider table: `model id | ours | upstream | omniroute` (✓/✗)
 *        - a "missing here" summary (present upstream/omniroute, absent in ours)
 *      Output is a review report — NEVER auto-applied. Id extraction from foreign
 *      sources is intentionally heuristic (quoted tokens resembling model ids in
 *      `id:` positions / array literals); imperfect matches are acceptable.
 *
 * Errors cleanly (`ref not found — fetch the remote first`) when comparison refs
 * are absent.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { REVIEWED_ORPHANS } from "../open-sse/config/catalogAllowlist.js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const MODEL_ID_RE = /^[a-z0-9][a-z0-9._/-]+$/i;

// ── git helpers ────────────────────────────────────────────────────────────
function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function revParse(ref) {
  try {
    return git(["rev-parse", ref]).trim();
  } catch {
    throw new Error(`ref not found: ${ref} — fetch the remote first`);
  }
}

function showFile(ref, path) {
  try {
    return git(["show", `${ref}:${path}`]);
  } catch {
    return null; // absent at that ref is not fatal (providers differ across forks)
  }
}

// ── local audit ────────────────────────────────────────────────────────────
/**
 * Load our RAW registry array (default export of registry/index.js). This is the
 * same source `providers/index.js` builds `PROVIDERS`/`PROVIDER_MODELS` from, but
 * pre-normalization — so raw-shape defects (duplicate ids, bad targetFormat, orphan
 * upstreamModelId) are visible instead of being hidden by normalizeModel/aliasing.
 */
async function loadOurRegistry() {
  const mod = await import(pathToFileURL(`${ROOT}/open-sse/providers/registry/index.js`).href);
  return mod.default;
}

async function loadFormats() {
  const mod = await import(pathToFileURL(`${ROOT}/open-sse/translator/formats.js`).href);
  return new Set(Object.values(mod.FORMATS));
}

async function loadPricing() {
  const mod = await import(pathToFileURL(`${ROOT}/open-sse/providers/pricing.js`).href);
  return {
    model: mod.MODEL_PRICING || {},
    provider: mod.PROVIDER_PRICING || {},
    pattern: mod.PATTERN_PRICING || [],
  };
}

function globMatch(pattern, id) {
  // Minimal glob: `*` → `.*`, anchor both ends, escape the rest.
  const re = new RegExp(
    "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
  );
  return re.test(id);
}

/**
 * Run the local consistency audit against our registry + pricing.
 * Returns an array of human-readable findings (empty = clean).
 *
 * Findings that have been human-reviewed and confirmed intentional are recorded
 * in `open-sse/config/catalogAllowlist.js` (REVIEWED_ORPHANS). By default they are
 * skipped so a fully-reviewed catalog exits clean; pass `{ strict: true }` (CLI
 * `--strict`) to surface every finding regardless of allowlist. Allowlist matching
 * uses STABLE keys built at finding-creation time — never parsed back out of the
 * message text.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.strict=false]  ignore the allowlist and return everything
 * @param {Map<string,string>} [opts.allowlist=REVIEWED_ORPHANS]  key → reason
 */
export async function localAudit(registryOverride, formatsOverride, pricingOverride, opts = {}) {
  const registry = registryOverride || (await loadOurRegistry());
  const formats = formatsOverride || (await loadFormats());
  const pricing = pricingOverride || (await loadPricing());
  const strict = opts.strict === true;
  const allowlist = opts.allowlist === undefined ? REVIEWED_ORPHANS : opts.allowlist;

  const findings = [];
  // Push a finding unless it is allowlisted (and we are not in strict mode).
  // `key` is the stable allowlist key; `message` is the human-readable text.
  function addFinding(key, message) {
    if (key != null && !strict && allowlist && allowlist.has(key)) return;
    findings.push(message);
  }
  // Every model id that exists anywhere in our registry (for MODEL_PRICING +
  // PATTERN_PRICING orphan checks, both provider-agnostic).
  const allIds = new Set();
  // Provider → set of its model ids. Indexed by BOTH entry.id and entry.alias so
  // PROVIDER_PRICING lookups keyed by alias (e.g. `gh`) resolve to the same set as
  // the canonical id (`github`). An override for a provider absent under every key
  // is a genuine orphan; an override whose model id isn't in THAT provider is too.
  const providerIds = new Map();

  for (const entry of registry) {
    const provider = entry.id || entry.alias || "<unknown>";
    const models = entry.models || [];
    const seen = new Map(); // composite key `${id}\0${effectiveKind}` → first index
    const idSet = new Set();

    for (let i = 0; i < models.length; i++) {
      const raw = models[i];
      const m = typeof raw === "string" ? { id: raw } : raw || {};
      const id = m.id;

      if (typeof id !== "string" || id.length === 0) {
        addFinding(null, `[${provider}] model[${i}] has empty/non-string id (${JSON.stringify(id)})`);
        continue;
      }
      const kind = m.kind || m.type || "llm";
      const dedupKey = `${id}\0${kind}`;
      idSet.add(id);
      allIds.add(id);
      // Same id is allowed across distinct kinds (e.g. gemini-2.5-pro as llm + stt).
      // A true duplicate is the same id repeated within the SAME effective kind.
      // Kind resolution matches runtime: `m.kind || m.type || "llm"` (see
      // open-sse/providers/models/schema.js#modelKind). Chat rows carry no kind
      // and resolve to the llm default; a bare duplicate chat row still flags.
      if (seen.has(dedupKey)) {
        const kindNote = kind ? `, kind "${kind}"` : " (no kind)";
        addFinding(
          null,
          `[${provider}] duplicate model id "${id}"${kindNote} (indices ${seen.get(dedupKey)}, ${i})`
        );
      } else {
        seen.set(dedupKey, i);
      }

      if (m.targetFormat != null && !formats.has(m.targetFormat)) {
        addFinding(
          null,
          `[${provider}] model "${id}" targetFormat "${m.targetFormat}" not in FORMATS`
        );
      }
    }

    // Register this provider's id set under every key pricing may use (id + alias).
    for (const key of new Set([entry.id, entry.alias].filter(Boolean))) {
      providerIds.set(key, idSet);
    }

    // upstreamModelId must resolve to an id in the SAME provider.
    for (let i = 0; i < models.length; i++) {
      const raw = models[i];
      const m = typeof raw === "string" ? { id: raw } : raw || {};
      if (m.upstreamModelId != null && !idSet.has(m.upstreamModelId)) {
        addFinding(
          `${provider}:${m.id}`,
          `[${provider}] model "${m.id}" upstreamModelId "${m.upstreamModelId}" resolves to no id in this provider`
        );
      }
    }
  }

  // Orphan pricing: a row is "covered" if some registry id equals/matches it.
  for (const key of Object.keys(pricing.model)) {
    if (!allIds.has(key)) {
      addFinding(`pricing:${key}`, `pricing MODEL_PRICING["${key}"] matches no registry model id`);
    }
  }
  for (const prov of Object.keys(pricing.provider)) {
    const ids = providerIds.get(prov);
    if (!ids) {
      addFinding(null, `pricing PROVIDER_PRICING.${prov} — provider key matches no registry id/alias`);
      continue;
    }
    for (const key of Object.keys(pricing.provider[prov])) {
      if (!ids.has(key)) {
        addFinding(null, `pricing PROVIDER_PRICING.${prov}["${key}"] matches no model id in that provider`);
      }
    }
  }
  for (const row of pricing.pattern) {
    let hit = false;
    for (const id of allIds) {
      if (globMatch(row.pattern, id)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      addFinding(`pricing-pattern:${row.pattern}`, `pricing PATTERN_PRICING "${row.pattern}" matches no registry model id`);
    }
  }

  return findings;
}

// ── comparison mode ────────────────────────────────────────────────────────
// Path maps: provider catalog source locations per tree.
const OUR_REGISTRY_GLOB_DIR = "open-sse/providers/registry";
const UPSTREAM_REGISTRY_DIR = "open-sse/providers/registry"; // same layout as ours
const OMN_ROUTE_REGISTRY_DIR = "open-sse/config/providers/registry"; // <provider>/index.ts

function listTree(ref, prefix) {
  try {
    return git(["ls-tree", "-r", "--name-only", ref, prefix]).split("\n").filter(Boolean);
  } catch {
    throw new Error(`ref not found: ${ref} — fetch the remote first`);
  }
}

/**
 * Extract heuristic model-id tokens from a registry source file (JS or TS).
 * Captures `id: "..."` values plus bare quoted string literals that look like
 * model ids. Imperfect by design — this feeds a review report, never auto-applied.
 */
/**
 * Return the [start, end) spans of every `models:`/`models =` array body
 * (contents between the outer `[` and its matching `]`), so callers can restrict
 * extraction to model rows and never touch provider-root fields, imports, or URLs.
 */
function modelArraySpans(source) {
  const spans = [];
  const arrayStart = /\bmodels\s*[:=]\s*\[/g;
  let start;
  while ((start = arrayStart.exec(source)) !== null) {
    let depth = 1;
    let i = arrayStart.lastIndex;
    const bodyStart = i;
    let inStr = null;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (inStr !== null) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === inStr) inStr = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") inStr = ch;
      else if (ch === "[") depth++;
      else if (ch === "]") depth--;
      i++;
    }
    spans.push([bodyStart, i - 1]); // excludes the closing ]
  }
  return spans;
}

export function extractModelIds(source) {
  const ids = new Set();
  if (!source) return ids;

  // Everything is scoped to model-array bodies. Within a body we capture:
  //   1. every `id: "..."` (model-row objects), and
  //   2. bare string literals that are DIRECT array elements (brace-depth 0),
  //      i.e. string-form models like `models: ["gpt-5.6-sol"]`.
  // Provider-root `id:`, imports, URLs and other out-of-array tokens never enter.
  for (const [begin, end] of modelArraySpans(source)) {
    const body = source.slice(begin, end);

    for (const m of body.matchAll(/\bid\s*:\s*["']([^"']+)["']/g)) {
      if (MODEL_ID_RE.test(m[1])) ids.add(m[1]);
    }

    let brace = 0;
    let inStr = null;
    let tok = "";
    const flush = () => {
      if (inStr !== null && brace === 0 && MODEL_ID_RE.test(tok)) ids.add(tok);
      tok = "";
    };
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (inStr !== null) {
        if (ch === "\\") {
          i++;
          continue;
        }
        if (ch === inStr) {
          flush();
          inStr = null;
        } else {
          tok += ch;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = ch;
        tok = "";
      } else if (ch === "{") {
        brace++;
      } else if (ch === "}") {
        brace--;
      }
      // nested `[`/`]` inside an object (capabilities/params) keep brace>0 so
      // their strings stay excluded; no separate bracket tracking needed.
    }
  }

  return ids;
}

function providerFromPath(path, layout) {
  if (layout === "ours" || layout === "upstream") {
    // open-sse/providers/registry/<provider>.js
    const base = path.split("/").pop().replace(/\.js$/, "");
    return base;
  }
  // omniroute: open-sse/config/providers/registry/<provider>/index.ts
  const parts = path.split("/");
  return parts[parts.length - 2];
}

// Non-registry catalog sources. Each is a stable synthetic bucket so ids that
// only appear in pricing / capabilities / thinking levels / cost data still show
// up in the report (the plan names these as Phase-6 inputs). `bucket` is the
// report section; `path` is the per-tree location (null when that tree has none).
const EXTRA_SOURCES = [
  {
    bucket: "__pricing__",
    ours: "open-sse/providers/pricing.js",
    upstream: "open-sse/providers/pricing.js",
    omniroute: "open-sse/services/providerCostData.ts",
  },
  {
    bucket: "__capabilities__",
    ours: "open-sse/providers/capabilities.js",
    upstream: "open-sse/providers/capabilities.js",
    omniroute: "open-sse/services/modelCapabilities.ts",
  },
  {
    // Ingested per plan; concrete ids are rare here (mostly `pattern:` globs,
    // which are excluded from comparison). Bucket may legitimately be empty.
    bucket: "__thinking-levels__",
    ours: "open-sse/providers/thinkingLevels.js",
    upstream: "open-sse/providers/thinkingLevels.js",
    omniroute: null,
  },
];

function addExtras(map, ref, key) {
  for (const src of EXTRA_SOURCES) {
    const p = src[key];
    if (!p) continue;
    const text = showFile(ref, p);
    if (text == null) continue;
    const existing = map.get(src.bucket) || new Set();
    for (const id of extractExtraIds(text, src.bucket)) existing.add(id);
    map.set(src.bucket, existing);
  }
}

async function loadOurIdMap() {
  // Comparison groups by registry file. Use raw file text (git show HEAD) so the
  // extractor is symmetric across all three trees (ours/upstream JS, omniroute TS).
  const map = new Map();
  const paths = listTree("HEAD", OUR_REGISTRY_GLOB_DIR).filter(
    (p) => p.endsWith(".js") && !p.endsWith("/index.js")
  );
  for (const p of paths) {
    const src = showFile("HEAD", p);
    map.set(providerFromPath(p, "ours"), extractModelIds(src));
  }
  addExtras(map, "HEAD", "ours");
  return map;
}

function loadForeignIdMap(ref, dir, layout, fileSuffix, extraKey) {
  const map = new Map();
  let paths;
  try {
    paths = listTree(ref, dir);
  } catch {
    return map; // whole dir absent at this ref
  }
  for (const p of paths) {
    if (layout === "omniroute") {
      if (!p.endsWith("/index.ts")) continue;
    } else {
      if (!p.endsWith(fileSuffix) || p.endsWith("/index.js")) continue;
    }
    const src = showFile(ref, p);
    if (src == null) continue;
    map.set(providerFromPath(p, layout), extractModelIds(src));
  }
  addExtras(map, ref, extraKey);
  return map;
}

function tick(set, id) {
  return set && set.has(id) ? "✓" : "✗";
}

/**
 * Source-specific id extraction for non-registry catalog files. The generic
 * extractor only understands `id:` and direct `models:` array strings, which
 * under-captures these shapes:
 *   - pricing.js (ours/upstream): MODEL_PRICING/PROVIDER_PRICING object keys +
 *     PATTERN_PRICING `pattern:` strings (globs; `*` stripped for comparison)
 *   - providerCostData.ts (omniroute): KNOWN_MODEL_PRICING object keys
 *   - capabilities.js: quoted object keys + `models: [...]` arrays
 *   - thinkingLevels.js: `pattern:` glob strings (closest available signal)
 * Returns a Set; globs have their `*` removed so the token is comparable to a
 * concrete id (imperfect, review-report only).
 */
export function extractExtraIds(source, kind) {
  const ids = new Set();
  if (!source) return ids;

  // Concrete quoted object keys only: `"gpt-5.6": { ... }`. Glob `pattern:`
  // rows are intentionally EXCLUDED — a pattern is not a model id and emitting
  // it as one produces misleading ✓/✗ rows in the comparison table. Patterns
  // are validated by the local audit's orphan check, not cross-tree comparison.
  // Case-insensitive: real registries carry uppercase ids (e.g. "MiniMax-M3").
  for (const m of source.matchAll(/^[ \t]*["']([a-z0-9][a-z0-9._/-]+)["'][ \t]*:/gim)) {
    ids.add(m[1]);
  }
  // Also harvest anything the generic extractor finds (models arrays / id: rows)
  // for capabilities.js files that carry a `models:` list.
  for (const id of extractModelIds(source)) ids.add(id);
  return ids;
}

/**
 * Pure renderer: build the markdown report from already-loaded id maps + SHAs.
 * No git/fs access — fully unit-testable with fixture sets.
 *
 * @param {{ ours: Map<string,Set<string>>, upstream?: Map<string,Set<string>>,
 *   omniroute?: Map<string,Set<string>>, shas: {ours:string,upstream?:string,omniroute?:string},
 *   refs: {upstream?:string,omniroute?:string} }} input
 * @returns {{ markdown: string, missingHere: Array<{provider:string,id:string}> }}
 */
export function renderReport({ ours, upstream = null, omniroute = null, shas, refs = {} }) {
  const providers = new Set([
    ...ours.keys(),
    ...(upstream ? upstream.keys() : []),
    ...(omniroute ? omniroute.keys() : []),
  ]);

  const lines = [];
  lines.push("# Model Catalog Report");
  lines.push("");
  lines.push("Generated by `scripts/model-catalog-diff.mjs`. Heuristic id extraction; review only — never auto-applied.");
  lines.push("");
  lines.push("## Compared commits");
  lines.push("");
  lines.push(`- ours (HEAD): \`${shas.ours}\``);
  if (shas.upstream) lines.push(`- upstream (${refs.upstream}): \`${shas.upstream}\``);
  if (shas.omniroute) lines.push(`- omniroute (${refs.omniroute}): \`${shas.omniroute}\``);
  lines.push("");

  const missingHere = [];
  for (const provider of [...providers].sort()) {
    const o = ours.get(provider) || new Set();
    const u = (upstream && upstream.get(provider)) || new Set();
    const om = (omniroute && omniroute.get(provider)) || new Set();
    const ids = new Set([...o, ...u, ...om]);
    if (ids.size === 0) continue;

    lines.push(`## ${provider}`);
    lines.push("");
    lines.push("| model id | ours | upstream | omniroute |");
    lines.push("| --- | --- | --- | --- |");
    for (const id of [...ids].sort()) {
      lines.push(
        `| \`${id}\` | ${tick(o, id)} | ${upstream ? tick(u, id) : "—"} | ${omniroute ? tick(om, id) : "—"} |`
      );
      if (!o.has(id) && ((upstream && u.has(id)) || (omniroute && om.has(id)))) {
        missingHere.push({ provider, id });
      }
    }
    lines.push("");
  }

  lines.push("## Missing here (present upstream/omniroute, absent in ours)");
  lines.push("");
  if (missingHere.length === 0) {
    lines.push("None — or no comparison refs supplied.");
  } else {
    for (const { provider, id } of missingHere) lines.push(`- \`${provider}\`: \`${id}\``);
  }
  lines.push("");

  return { markdown: lines.join("\n"), missingHere };
}

export async function comparisonReport(upstreamRef, omnirouteRef) {
  const oursSha = revParse("HEAD");
  const upstreamSha = upstreamRef ? revParse(upstreamRef) : null;
  const omnirouteSha = omnirouteRef ? revParse(omnirouteRef) : null;

  const ours = await loadOurIdMap();
  const upstream = upstreamRef
    ? loadForeignIdMap(upstreamRef, UPSTREAM_REGISTRY_DIR, "upstream", ".js", "upstream")
    : null;
  const omniroute = omnirouteRef
    ? loadForeignIdMap(omnirouteRef, OMN_ROUTE_REGISTRY_DIR, "omniroute", ".ts", "omniroute")
    : null;

  const { markdown } = renderReport({
    ours,
    upstream,
    omniroute,
    shas: { ours: oursSha, upstream: upstreamSha, omniroute: omnirouteSha },
    refs: { upstream: upstreamRef, omniroute: omnirouteRef },
  });
  return markdown;
}

// ── CLI ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { upstreamRef: null, omnirouteRef: null, out: "model-catalog-report.md", strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--upstream-ref") out.upstreamRef = argv[++i];
    else if (a === "--omniroute-ref") out.omnirouteRef = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--strict") out.strict = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: node scripts/model-catalog-diff.mjs [--strict] [--upstream-ref REF] [--omniroute-ref REF] [--out FILE]");
    console.log("  --strict   show every finding, ignoring the reviewed allowlist (open-sse/config/catalogAllowlist.js)");
    process.exit(0);
  }

  if (args.upstreamRef || args.omnirouteRef) {
    const report = await comparisonReport(args.upstreamRef, args.omnirouteRef);
    writeFileSync(`${ROOT}/${args.out}`, report, "utf8");
    console.log(`wrote ${args.out}`);
    return;
  }

  // Local audit. Default mode skips reviewed-intentional findings (allowlist);
  // --strict shows everything. Exit 0 when no un-reviewed findings remain.
  const findings = await localAudit(undefined, undefined, undefined, { strict: args.strict });
  if (findings.length === 0) {
    console.log(args.strict
      ? "catalog audit: clean (no findings)"
      : "catalog audit: clean (no unreviewed findings)");
    process.exit(0);
  }
  console.error(`catalog audit: ${findings.length} finding(s):`);
  for (const f of findings) console.error("  - " + f);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(2);
  });
}
