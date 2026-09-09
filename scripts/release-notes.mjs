#!/usr/bin/env node
/**
 * release-notes.mjs — version math + changelog tooling for the release train.
 *
 * Pure, exported, testable functions:
 *   parseVersion(str)           -> [major, minor, patch]
 *   computeBump(subjects)       -> "major" | "minor" | "patch"
 *   nextVersion(current, bump)  -> semver string
 *   classifySubject(subject)    -> changelog section name
 *   buildChangelogSection(...)  -> markdown section for one version
 *   extractSection(changelog, version) -> that version's section text
 *
 * CLI (all git access goes through execFileSync — no shell-string
 * interpolation of untrusted input):
 *   node scripts/release-notes.mjs next-version [--bump auto|patch|minor|major] [--from <tag>]
 *   node scripts/release-notes.mjs notes <version> [--from <tag>]
 *   node scripts/release-notes.mjs extract <version>
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A breaking-change marker on any conventional type (`feat!:`, `fix(api)!:`). */
const BREAKING_PATTERN = /^[a-z]+(\([^)]*\))?!:/;
const FEATURE_PATTERN = /^feat(\(|:)/;

/**
 * Parse a semver string (optional leading `v`) into [major, minor, patch].
 * Throws on anything that is not exactly three numeric components.
 */
export function parseVersion(str) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(str).trim());
  if (!match) throw new Error(`Not a semver version: ${str}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Derive the release bump from Conventional Commit subjects.
 * Any breaking marker wins (major); any feat is minor; otherwise patch.
 */
export function computeBump(subjects) {
  if (subjects.some((subject) => BREAKING_PATTERN.test(subject))) return "major";
  if (subjects.some((subject) => FEATURE_PATTERN.test(subject))) return "minor";
  return "patch";
}

/** Apply a bump to a semver string and return the next semver string. */
export function nextVersion(current, bump) {
  const [major, minor, patch] = parseVersion(current);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump: ${bump}`);
}

/**
 * Map a Conventional Commit subject to a changelog section name.
 * feat -> Features; fix -> Fixes; port/sync -> Upstream ports; rest -> Maintenance.
 */
export function classifySubject(subject) {
  if (/^feat(\(|:|!)/.test(subject)) return "Features";
  if (/^fix(\(|:|!)/.test(subject)) return "Fixes";
  if (/^(port|sync)(\(|:|!)/.test(subject)) return "Upstream ports";
  return "Maintenance";
}

/** Ordered section names used in generated changelog entries. */
export const SECTION_ORDER = ["Features", "Fixes", "Upstream ports", "Maintenance"];

/**
 * Build the markdown changelog section for a version from commit subjects.
 * Emits `# X.Y.Z` followed by only the non-empty `## <section>` subsections,
 * each bullet the full original commit subject.
 */
export function buildChangelogSection(version, subjects) {
  const groups = new Map(SECTION_ORDER.map((name) => [name, []]));
  for (const subject of subjects) {
    groups.get(classifySubject(subject)).push(subject);
  }
  const lines = [`# ${version}`, ""];
  for (const name of SECTION_ORDER) {
    const items = groups.get(name);
    if (items.length === 0) continue;
    lines.push(`## ${name}`, "");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

/**
 * Extract one version's section from changelog markdown: from its
 * `# <version>` heading up to (not including) the next top-level `# ` heading.
 * Returns null when the version has no section.
 */
export function extractSection(changelog, version) {
  const lines = changelog.split("\n");
  const heading = `# ${version}`;
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("# ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").replace(/\n+$/, "\n");
}

// ---------------------------------------------------------------------------
// CLI plumbing
// ---------------------------------------------------------------------------

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

/** Latest v* tag reachable from HEAD (default release baseline). */
function latestTag() {
  try {
    return git(["describe", "--tags", "--abbrev=0", "--match", "v*"]);
  } catch {
    throw new Error("No v* tag found on HEAD history; pass --from <tag> explicitly.");
  }
}

/** Commit subjects on `<from>..HEAD`; errors when the range is empty. */
function subjectsSince(from) {
  const output = git(["log", `${from}..HEAD`, "--format=%s"]);
  const subjects = output === "" ? [] : output.split("\n");
  if (subjects.length === 0) {
    throw new Error(`No commits since ${from}; nothing to release.`);
  }
  return subjects;
}

function readChangelog() {
  return readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      options[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

const BUMPS = ["auto", "patch", "minor", "major"];

export function main(argv, { stdout = console.log, stderr = console.error } = {}) {
  const [command, ...rest] = argv;
  const { positional, options } = parseArgs(rest);
  const from = options.from || latestTag();

  if (command === "next-version") {
    const bump = options.bump || "auto";
    if (!BUMPS.includes(bump)) {
      throw new Error(`Unknown --bump value "${bump}" (expected one of ${BUMPS.join(", ")}).`);
    }
    const subjects = subjectsSince(from);
    const current = from.replace(/^v/, "");
    const resolved = bump === "auto" ? computeBump(subjects) : bump;
    stdout(nextVersion(current, resolved));
    return 0;
  }

  if (command === "notes") {
    const version = positional[0];
    if (!version) throw new Error("Usage: release-notes.mjs notes <version> [--from <tag>]");
    parseVersion(version); // validates the shape
    stdout(buildChangelogSection(version, subjectsSince(from)));
    return 0;
  }

  if (command === "extract") {
    const version = positional[0];
    if (!version) throw new Error("Usage: release-notes.mjs extract <version>");
    const section = extractSection(readChangelog(), version);
    if (section === null) {
      throw new Error(`CHANGELOG.md has no "# ${version}" section.`);
    }
    stdout(section);
    return 0;
  }

  stderr(
    "Usage: release-notes.mjs <next-version|notes|extract> [args]\n" +
      "  next-version [--bump auto|patch|minor|major] [--from <tag>]\n" +
      "  notes <version> [--from <tag>]\n" +
      "  extract <version>",
  );
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`release-notes: ${error.message}`);
    process.exit(1);
  }
}
