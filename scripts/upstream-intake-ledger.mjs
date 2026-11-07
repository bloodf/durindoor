#!/usr/bin/env node
/**
 * Upstream Intake Ledger Helper (Issue #1148)
 *
 * Extends upstream intake tracking across both decolua/9router and
 * diegosouzapw/OmniRoute. Stores complete reviewed candidate records:
 * source, SHA, PR/commit state, final diff, local equivalent, test coverage,
 * disposition, and owner issue.
 *
 * Enforces deduplication across repositories, pagination under GitHub's
 * 65,536-byte limit, and manual dispatch provenance without inferring ports
 * from titles.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GITHUB_MAX_BYTES = 65536;
export const DEFAULT_PAGE_BYTES = 60000;

export const ALLOWED_SOURCES = Object.freeze([
  "decolua/9router",
  "diegosouzapw/OmniRoute",
]);

export const ALLOWED_DISPOSITIONS = Object.freeze([
  "candidate",
  "needs-review",
  "tracked",
  "deferred",
  "skipped",
  "ported",
]);

export const ALLOWED_STATES = Object.freeze([
  "open",
  "merged",
  "closed",
  "tracked",
]);

/**
 * Derives a canonical deduplication identifier for a candidate record.
 * Keeps source repositories strictly separated so e.g. 9router #42 does not
 * collide with OmniRoute #42.
 */
export function canonicalId(record) {
  const source = record.source === undefined ? "decolua/9router" : record.source;
  if (record.number !== undefined && record.number !== null && record.number !== "") {
    return `${source}#PR${record.number}`;
  }
  if (record.sha) {
    return `${source}#SHA${record.sha}`;
  }
  if (record.id) {
    return `${source}#ID${record.id}`;
  }
  throw new Error(`Record lacks unique identifier (number, sha, or id): ${JSON.stringify(record)}`);
}

/**
 * Normalizes a raw input record into the reviewed intake schema.
 * Note: Never infers disposition from titles!
 */
export function normalizeRecord(raw) {
  if (!raw || Array.isArray(raw) || Object(raw) !== raw) {
    throw new TypeError("Candidate record must be an object");
  }

  const source = raw.source === undefined ? "decolua/9router" : raw.source;
  const number = raw.number !== undefined && raw.number !== null && raw.number !== ""
    ? Number(raw.number)
    : null;
  const sha = raw.sha ? String(raw.sha).trim().toLowerCase() : null;
  const title = raw.title ? String(raw.title).trim() : "(untitled candidate)";
  const state = raw.state ? String(raw.state).trim().toLowerCase() : "open";
  const disposition = raw.disposition
    ? String(raw.disposition).trim().toLowerCase()
    : "candidate";

  const finalDiff = raw.finalDiff !== undefined && raw.finalDiff !== null
    ? String(raw.finalDiff).trim()
    : (sha ? `https://github.com/${source}/commit/${sha}` : "pending");

  const localEquivalent = raw.localEquivalent !== undefined && raw.localEquivalent !== null
    ? String(raw.localEquivalent).trim()
    : "none";

  const test = raw.test !== undefined && raw.test !== null
    ? String(raw.test).trim()
    : "none";

  let ownerIssue = null;
  if (raw.ownerIssue !== undefined && raw.ownerIssue !== null && raw.ownerIssue !== "") {
    const s = String(raw.ownerIssue).trim();
    ownerIssue = s.startsWith("#") ? s : `#${s}`;
  }

  const additions = Number.isFinite(Number(raw.additions)) ? Number(raw.additions) : 0;
  const deletions = Number.isFinite(Number(raw.deletions)) ? Number(raw.deletions) : 0;
  const why = raw.why ? String(raw.why).trim() : "";
  const author = raw.author
    ? String(raw.author.login ?? raw.author)
    : "";

  return {
    source,
    number,
    sha,
    title,
    state,
    disposition,
    finalDiff,
    localEquivalent,
    test,
    ownerIssue,
    additions,
    deletions,
    why,
    author,
  };
}

/**
 * Validates that a normalized candidate adheres to the intake contract.
 */
export function validateRecord(record) {
  const errors = [];
  if (!record.source) {
    errors.push("Missing source repository");
  } else if (!ALLOWED_SOURCES.includes(record.source)) {
    errors.push(`Invalid source format: ${record.source}`);
  }

  if (record.number === null && !record.sha) {
    errors.push("Record must have at least a PR number or a commit SHA");
  }

  if (record.number !== null && (!Number.isSafeInteger(record.number) || record.number <= 0)) errors.push("Invalid PR/issue number");
  if (record.sha !== null && !/^[a-f0-9]{7,40}$/.test(record.sha)) errors.push("Invalid commit SHA");
  if (!ALLOWED_STATES.includes(record.state)) errors.push("Invalid upstream state");
  for (const field of ["finalDiff", "localEquivalent", "test"]) {
    if (!record[field]) errors.push(`Missing ${field}`);
  }
  if (!record.title) {
    errors.push("Missing title");
  }

  if (!ALLOWED_DISPOSITIONS.includes(record.disposition)) {
    errors.push(`Invalid disposition '${record.disposition}'. Allowed: ${ALLOWED_DISPOSITIONS.join(", ")}`);
  }

  if (record.disposition === "ported" && record.localEquivalent === "none" && !record.why) {
    errors.push("Ported disposition requires localEquivalent or why rationale");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Invariant guard: Titles must never be parsed to infer ported disposition.
 * Titles such as "port(upstream): #123" or "feat: port XYZ" in candidate lists
 * are upstream descriptions, not proof of DurinDoor implementation.
 */
export function assertTitleDoesNotInferPort(candidate) {
  if (candidate.disposition === "ported" && !candidate.why && candidate.localEquivalent === "none") {
    throw new Error(
      `Provenance violation: candidate #${candidate.number || candidate.sha} marked ported without local evidence or reviewed rationale.`
    );
  }
}

/**
 * Deduplicates a list of candidate records against themselves and an existing
 * ported/tracked set, respecting source qualification.
 *
 * @param {Array<Object>} candidates - List of candidate objects.
 * @param {Array<number|Object>} [existingPorted] - Array of ported numbers or ledger objects.
 * @returns {Array<Object>} Deduplicated, normalized candidates.
 */
export function deduplicateCandidates(candidates, existingPorted = []) {
  if (!Array.isArray(candidates)) {
    throw new TypeError("Candidates must be an array");
  }

  // Build a lookup set of ported items qualified by source
  const portedSet = new Set();
  if (!Array.isArray(existingPorted)) existingPorted = existingPorted?.ported;
  if (!Array.isArray(existingPorted)) throw new TypeError("Ported ledger must be an array or contain ported[]");
  for (const item of existingPorted) {
    if (Number.isSafeInteger(item) && item > 0) {
      // Legacy unadorned number defaults to decolua/9router
      portedSet.add(`decolua/9router#PR${item}`);
    } else if (item && !Array.isArray(item) && Object(item) === item) {
      const src = item.source === undefined ? "decolua/9router" : item.source;
      if (!ALLOWED_SOURCES.includes(src)) continue;
      if (item.pr !== undefined && item.pr !== null) {
        portedSet.add(`${src}#PR${item.pr}`);
      }
      if (item.number !== undefined && item.number !== null) {
        portedSet.add(`${src}#PR${item.number}`);
      }
      if (item.sha) {
        portedSet.add(`${src}#SHA${item.sha}`);
      }
    }
  }

  const seen = new Map();
  const result = [];

  for (const raw of candidates) {
    const record = normalizeRecord(raw);
    const validation = validateRecord(record);
    if (!validation.valid) throw new Error(validation.errors.join("; "));
    const key = canonicalId(record);

    // If already ported in the reference ledger, mark disposition or skip duplicate
    if (portedSet.has(key)) {
      record.disposition = "ported";
      // Membership in the supplied reviewed ledger is itself retained evidence.
      if (!record.why) record.why = `Reviewed ported ledger membership: ${key}`;
    }

    if (!seen.has(key)) {
      seen.set(key, record);
      result.push(record);
    } else {
      // Merge records preserving higher priority disposition
      const existing = seen.get(key);
      const prio = {
        ported: 5,
        tracked: 4,
        deferred: 3,
        skipped: 3,
        "needs-review": 2,
        candidate: 1,
      };
      if ((prio[record.disposition] || 0) > (prio[existing.disposition] || 0)) {
        Object.assign(existing, record);
      }
      if (record.finalDiff !== "pending" && existing.finalDiff === "pending") {
        existing.finalDiff = record.finalDiff;
      }
      if (record.localEquivalent !== "none" && existing.localEquivalent === "none") {
        existing.localEquivalent = record.localEquivalent;
      }
      if (record.test !== "none" && existing.test === "none") {
        existing.test = record.test;
      }
      if (record.ownerIssue && !existing.ownerIssue) {
        existing.ownerIssue = record.ownerIssue;
      }
    }
  }

  return result;
}

/**
 * Formats a single candidate bullet line for markdown reports.
 * Omits upstream author usernames to avoid unsolicited user notifications.
 */
export function formatCandidateBullet(record) {
  const norm = normalizeRecord(record);
  const idStr = norm.number !== null ? `#${norm.number}` : norm.sha.slice(0, 7);
  const delta = `+${norm.additions}/-${norm.deletions}`;
  const details = [];

  details.push(`state: ${norm.state}`);
  if (norm.sha) details.push(`sha: ${norm.sha}`);
  if (norm.why) details.push(`why: ${norm.why}`);
  if (norm.ownerIssue) details.push(`owner: ${norm.ownerIssue}`);
  if (norm.disposition !== "candidate") details.push(`disposition: ${norm.disposition}`);
  if (norm.localEquivalent !== "none") details.push(`eq: ${norm.localEquivalent}`);
  if (norm.test !== "none") details.push(`test: ${norm.test}`);
  if (norm.finalDiff !== "pending") details.push(`diff: ${norm.finalDiff}`);

  const extra = details.length > 0 ? ` [${details.join(" | ")}]` : "";
  return `- [${norm.source}] ${idStr} ${delta}: ${norm.title}${extra}`;
}

/**
 * Paginates formatted lines into pages that strictly respect byte limits.
 *
 * @param {Array<string>} lines - Candidate text lines.
 * @param {Object} options
 * @param {number} [options.pageBytes=60000] - Target max bytes per page.
 * @param {string} [options.summaryHeader] - Header text for body.md.
 * @param {string} [options.commentPrefix] - Header prefix for continuation comments.
 * @returns {Array<string>} Array of page contents (index 0 is body.md, rest are comments).
 */
export function paginateLines(lines, options = {}) {
  const pageBytes = options.pageBytes ?? DEFAULT_PAGE_BYTES;
  if (!Number.isSafeInteger(pageBytes) || pageBytes < 512 || pageBytes > GITHUB_MAX_BYTES) {
    throw new Error("pageBytes must be an integer between 512 and 65536");
  }
  const summaryHeader = options.summaryHeader || "";
  const commentPrefix = options.commentPrefix || "Unported upstream PRs — page";
  // Reserve the largest possible continuation header, including total-page digits.
  const header = (i, total) => i === 0 ? `${summaryHeader}\n\n` : `${commentPrefix} ${i + 1} of ${total}\n\n`;
  const reserve = Math.max(Buffer.byteLength(header(0, 1)), Buffer.byteLength(header(lines.length, lines.length + 1)));
  const capacity = pageBytes - reserve;
  if (capacity <= 0) throw new Error("Report header exceeds page limit");
  const chunks = [""];
  for (const line of lines.length ? lines : ["No unported upstream candidates."]) {
    const entry = `${line}\n`;
    if (Buffer.byteLength(entry) > capacity) throw new Error("Candidate exceeds page limit; shorten its fields");
    if (Buffer.byteLength(chunks.at(-1) + entry) > capacity) chunks.push("");
    chunks[chunks.length - 1] += entry;
  }
  const pages = chunks.map((chunk, i) => header(i, chunks.length) + chunk);
  return pages;
}

/**
 * Builds the complete multi-page report from a candidate array.
 */
export function buildReportPages(candidates, options = {}) {
  const pageBytes = options.pageBytes ?? DEFAULT_PAGE_BYTES;
  const existingPorted = options.existingPorted || [];
  const deduped = deduplicateCandidates(candidates, existingPorted);

  // Partition unported candidates (disposition !== "ported")
  const unported = deduped.filter((c) => c.disposition !== "ported");
  const portedCount = deduped.length - unported.length;
  const total = deduped.length;

  // Sort newest first (highest PR number or SHA)
  unported.sort((a, b) => {
    if (a.number !== null && b.number !== null) {
      return b.number - a.number;
    }
    if (a.number !== null) return -1;
    if (b.number !== null) return 1;
    return (b.sha || "").localeCompare(a.sha || "");
  });

  const lines = unported.map(formatCandidateBullet);

  const breakdown = {
    total,
    ported: portedCount,
    unported: unported.length,
    tracked: unported.filter((c) => c.disposition === "tracked").length,
    deferred: unported.filter((c) => c.disposition === "deferred").length,
    skipped: unported.filter((c) => c.disposition === "skipped").length,
    candidate: unported.filter((c) => c.disposition === "candidate").length,
    needsReview: unported.filter((c) => c.disposition === "needs-review").length,
  };

  const summaryHeader = [
    `Scanned ${total} upstream candidates across tracked sources: ${portedCount} ported, **${unported.length} unported**.`,
    `Dispositions: ${breakdown.candidate} candidate, ${breakdown.needsReview} needs-review, ${breakdown.tracked} tracked, ${breakdown.deferred} deferred, ${breakdown.skipped} skipped.`,
    `Provenance: Manual dispatch only; titles are not inferred ports; source diffs and test equivalents required before merge.`,
  ].join("\n");

  const pages = paginateLines(lines, {
    pageBytes,
    summaryHeader,
    commentPrefix: "Unported upstream PRs — page",
  });

  return {
    pages,
    breakdown,
    unported,
    deduped,
  };
}

/**
 * Writes report pages to output directory.
 */
export function writeReportFiles(pages, outdir) {
  mkdirSync(outdir, { recursive: true });
  // Clean prior reports
  for (const f of readdirSync(outdir)) {
    if (/^comment-\d{3,}\.md$/.test(f)) {
      rmSync(join(outdir, f), { force: true });
    }
  }

  writeFileSync(join(outdir, "body.md"), pages[0]);
  for (let i = 1; i < pages.length; i++) {
    const pageNum = i + 1;
    const name = `comment-${String(pageNum).padStart(3, "0")}.md`;
    writeFileSync(join(outdir, name), pages[i]);
  }
}

/**
 * CLI command runner
 */
export function runCli(argv) {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(`
Usage:
  node upstream-intake-ledger.mjs build-report --candidates <file> --outdir <dir> [--ported <file>] [--page-bytes <num>]
  node upstream-intake-ledger.mjs dedup --candidates <file> [--ported <file>] [--out <file>]
  node upstream-intake-ledger.mjs validate --candidates <file>
  node upstream-intake-ledger.mjs legacy --prs <prs.json> --ported <ported.json> --outdir <dir>
`);
    return 0;
  }

  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  if (command === "build-report" || command === "legacy") {
    const candidatesPath = getArg("--candidates") || getArg("--prs");
    const outdir = getArg("--outdir");
    const portedPath = getArg("--ported");
    const pageBytesArg = getArg("--page-bytes");
    const pageBytes = pageBytesArg ? Number(pageBytesArg) : DEFAULT_PAGE_BYTES;

    if (!candidatesPath || !outdir) {
      console.error("Error: --candidates and --outdir are required");
      return 1;
    }

    const candidates = JSON.parse(readFileSync(resolve(candidatesPath), "utf8"));
    const ported = portedPath
      ? JSON.parse(readFileSync(resolve(portedPath), "utf8"))
      : [];

    const { pages, breakdown } = buildReportPages(candidates, {
      pageBytes,
      existingPorted: ported,
    });

    writeReportFiles(pages, resolve(outdir));
    console.log(`total=${breakdown.total} ported=${breakdown.ported} new=${breakdown.unported} pages=${pages.length}`);
    return 0;
  }

  if (command === "validate") {
    const candidatesPath = getArg("--candidates");
    if (!candidatesPath) {
      console.error("Error: --candidates is required");
      return 1;
    }
    const candidates = JSON.parse(readFileSync(resolve(candidatesPath), "utf8"));
    let errCount = 0;
    for (const raw of candidates) {
      const norm = normalizeRecord(raw);
      const { valid, errors } = validateRecord(norm);
      if (!valid) {
        console.error(`Invalid record #${norm.number || norm.sha}: ${errors.join("; ")}`);
        errCount++;
      }
    }
    if (errCount > 0) {
      console.error(`Validation failed with ${errCount} errors`);
      return 1;
    }
    console.log(`All ${candidates.length} candidate records valid.`);
    return 0;
  }

  if (command === "dedup") {
    const candidatesPath = getArg("--candidates");
    const portedPath = getArg("--ported");
    const outPath = getArg("--out");
    if (!candidatesPath) {
      console.error("Error: --candidates is required");
      return 1;
    }
    const candidates = JSON.parse(readFileSync(resolve(candidatesPath), "utf8"));
    const ported = portedPath
      ? JSON.parse(readFileSync(resolve(portedPath), "utf8"))
      : [];
    const deduped = deduplicateCandidates(candidates, ported);
    if (outPath) {
      writeFileSync(resolve(outPath), JSON.stringify(deduped, null, 2));
    } else {
      console.log(JSON.stringify(deduped, null, 2));
    }
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  return 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const exitCode = runCli(process.argv);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
