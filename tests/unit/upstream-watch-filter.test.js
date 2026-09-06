import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Guards the upstream scan report: it must list every OPEN upstream PR that has
 * not already been ported here, and nothing else.
 *
 * Two failure modes this locks down:
 *  1. Already-ported PRs leaking into the report (the original bug).
 *  2. Silent truncation hiding unported PRs — the union of the issue body and
 *     its continuation comments must equal the complete unported set.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOW = join(ROOT, ".github/workflows/upstream-watch.yml");
const SCRIPT = join(ROOT, "scripts/upstream-scan-report.sh");
const IDS_SCRIPT = join(ROOT, "scripts/upstream-ported-ids.sh");
const LEDGER = join(ROOT, ".github/upstream-ported.json");
/** Mirrors the workflow's `sed` extraction of ported upstream PR numbers. */
const PORTED_SED = /^port\(upstream\): #(\d+)/;

/** GitHub's hard cap on an issue body or comment. */
const GITHUB_MAX_BYTES = 65536;

let dir;

const run = (prs, ported, opts = {}) => {
  const out = mkdtempSync(join(dir, "run-"));
  writeFileSync(join(out, "prs.json"), JSON.stringify(prs));
  writeFileSync(join(out, "ported.json"), JSON.stringify(ported));
  const stdout = execFileSync(
    SCRIPT,
    [join(out, "prs.json"), join(out, "ported.json"), join(out, "report")],
    { encoding: "utf8", env: { ...process.env, ...opts.env } },
  );
  const reportDir = join(out, "report");
  const files = readdirSync(reportDir);
  const pages = files
    .filter((f) => f === "body.md" || f.startsWith("comment-"))
    .sort()
    .map((f) => readFileSync(join(reportDir, f), "utf8"));
  return { stdout, pages, files, reportDir };
};

/** Every `- #N ...` bullet across all pages. */
const listedNumbers = (pages) =>
  pages
    .flatMap((p) => p.split("\n"))
    .map((l) => l.match(/^- #(\d+) /))
    .filter(Boolean)
    .map((m) => Number(m[1]));

const makePr = (number, title = `pr ${number}`) => ({
  number,
  title,
  author: { login: "someone" },
  additions: 1,
  deletions: 2,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "upstream-watch-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ported-PR extraction", () => {
  it("takes the upstream number, not our own squash-merge number", () => {
    const subjects = [
      "port(upstream): #3660 - prevent persisted theme flash (#734)",
      "port(upstream): #3624 - add Ollama Cloud web fetch provider (#731)",
      "feat(config): unrelated commit (#700)",
      "port(omniroute): cross-fork port (#712)",
    ];
    const ported = subjects
      .map((s) => s.match(PORTED_SED))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);

    // Trailing (#734)/(#731) are OUR PR numbers and must not be treated as
    // upstream ports; non-`port(upstream)` subjects are ignored entirely.
    expect(ported).toEqual([3624, 3660]);
  });
});

describe("upstream-scan-report.sh", () => {
  it("drops already-ported PRs and keeps unported ones", () => {
    const { pages, stdout } = run([makePr(3660), makePr(9999)], [3624, 3660]);
    expect(listedNumbers(pages)).toEqual([9999]);
    expect(stdout.trim()).toContain("new=1");
  });

  it("never mentions upstream PR authors", () => {
    const { pages } = run([makePr(9999)], []);
    expect(pages.join("\n")).not.toContain("someone");
  });

  it("reports cleanly when everything is already ported", () => {
    const { pages, stdout } = run([makePr(3660), makePr(3624)], [3624, 3660]);
    expect(listedNumbers(pages)).toEqual([]);
    expect(pages[0]).toContain("No unported upstream PRs");
    expect(stdout.trim()).toContain("new=0");
  });

  it("lists EVERY unported PR across pages, with no truncation", () => {
    // 900 open upstream PRs, 300 of them already ported: mirrors the real
    // 879-open / 167-ported shape that overflowed a single issue body.
    const prs = Array.from({ length: 900 }, (_, i) =>
      makePr(1000 + i, `upstream change ${i} ${"x".repeat(80)}`),
    );
    const ported = prs.filter((_, i) => i % 3 === 0).map((p) => p.number);
    const expected = prs.map((p) => p.number).filter((n) => !ported.includes(n));

    const { pages, stdout } = run(prs, ported);

    expect(stdout.trim()).toContain(`new=${expected.length}`);
    // Multiple pages are required at this size — proves pagination engaged.
    expect(pages.length).toBeGreaterThan(1);

    const listed = listedNumbers(pages);
    // Union is exactly the unported set: nothing dropped, nothing duplicated.
    expect([...listed].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
    expect(new Set(listed).size).toBe(listed.length);
    // No ported PR leaks in.
    expect(listed.filter((n) => ported.includes(n))).toEqual([]);
    // Newest first.
    expect(listed[0]).toBe(Math.max(...expected));
  });

  it("keeps every page under GitHub's byte limit", () => {
    const prs = Array.from({ length: 900 }, (_, i) =>
      makePr(1000 + i, `upstream change ${i} ${"x".repeat(120)}`),
    );
    const { pages } = run(prs, []);
    for (const page of pages) {
      expect(Buffer.byteLength(page, "utf8")).toBeLessThanOrEqual(GITHUB_MAX_BYTES);
    }
  });

  it("labels continuation comments so stale pages can be pruned", () => {
    const prs = Array.from({ length: 400 }, (_, i) => makePr(1000 + i, "y".repeat(300)));
    const { files, reportDir } = run(prs, []);
    const comments = files.filter((f) => f.startsWith("comment-"));
    expect(comments.length).toBeGreaterThan(0);
    for (const c of comments) {
      // The workflow deletes prior pages by matching this exact prefix.
      expect(readFileSync(join(reportDir, c), "utf8")).toMatch(
        /^Unported upstream PRs — page \d+ of \d+/,
      );
    }
  });
});

describe("ported ledger", () => {
  const ledger = () => JSON.parse(readFileSync(LEDGER, "utf8"));

  it("is valid, deduplicated, sorted, and carries evidence per entry", () => {
    const l = ledger();
    const ported = l.ported.map((e) => e.pr);
    expect(new Set(ported).size).toBe(ported.length);
    // Kept ascending so entries stay reviewable and diffs stay readable.
    expect(ported).toEqual([...ported].sort((a, b) => a - b));
    for (const e of l.ported) {
      expect(typeof e.pr).toBe("number");
      // Entries are reviewed like code; a wrong one hides a real candidate.
      expect(e.why.length).toBeGreaterThan(10);
    }
  });

  it("includes secondary IDs ported under another PR's commit subject", () => {
    // These landed inside commits naming a DIFFERENT upstream number, so the
    // subject scan alone re-proposed them as new. Regression guard.
    const ported = ledger().ported.map((e) => e.pr);
    for (const pr of [3693, 3691, 3465, 3519, 3513, 3433, 3483, 3447, 3451, 3484, 3553]) {
      expect(ported).toContain(pr);
    }
  });

  it("counts independently implemented concerns as ported", () => {
    // #3498/#3527 (MCP local-only gate + SSE abort release), #3500 (database
    // dual auth), #3501 (explicit JWT_SECRET) were written independently rather
    // than cherry-picked, but the behavior and tests exist here — so the scan
    // must not re-propose them.
    const ported = ledger().ported.map((e) => e.pr);
    for (const pr of [3498, 3500, 3501, 3527]) {
      expect(ported).toContain(pr);
    }
  });

  it("unions the ledger with commit subjects", () => {
    const out = JSON.parse(execFileSync(IDS_SCRIPT, [ROOT], { encoding: "utf8" }));
    for (const pr of ledger().ported.map((e) => e.pr)) {
      expect(out).toContain(pr);
    }
    // #3497 has its own `port(upstream): #3497` subject, so the subject source
    // covers it without a ledger entry.
    expect(out).toContain(3497);
    expect(out.length).toBeGreaterThan(ledger().ported.length);
  });
});

describe("upstream-watch workflow wiring", () => {
  const yml = () => readFileSync(WORKFLOW, "utf8");

  it("has no scheduled trigger and does not request author data", () => {
    const text = yml();
    expect(text).not.toContain("schedule:");
    expect(text).not.toContain("number,title,author");
  });

  it("scans the full open set with full git history", () => {
    // Reading ported subjects needs full history, not a shallow clone.
    expect(yml()).toContain("fetch-depth: 0");
    // 879 open upstream PRs as of 2026-09; a low limit would silently starve.
    expect(yml()).toContain("--limit 1000");
  });

  it("builds the ported set via the ledger script, not an inline sed", () => {
    const text = yml();
    expect(text).toContain("./scripts/upstream-ported-ids.sh . > ported.json");
    // The old inline extraction ignored the ledger entirely.
    expect(text).not.toContain("sed -nE 's/^port");
  });

  it("posts the generated report files, not an inline truncated list", () => {
    const text = yml();
    expect(text).toContain("./scripts/upstream-scan-report.sh upstream-prs.json ported.json report");
    expect(text).toContain("--body-file report/body.md");
    expect(text).toContain("report/comment-*.md");
    // No cap constant may reappear.
    expect(text).not.toContain("MAX_LISTED");
  });

  it("captures the new issue number from the URL gh actually prints", () => {
    const text = yml();
    // `gh issue create` has no --json/--jq; it prints the issue URL.
    expect(text).not.toMatch(/gh issue create[\s\S]{0,300}--json/);
    expect(text).toContain("sed -nE 's#.*/([0-9]+)$#\\1#p'");
  });

  it("derives the issue number correctly from a mocked gh create URL", () => {
    // Exercise the exact sed the workflow uses against gh's real output shape.
    const url = "https://github.com/bloodf/durindoor/issues/742";
    const issue = execFileSync("sh", ["-c", `printf '%s\\n' "${url}" | sed -nE 's#.*/([0-9]+)$#\\1#p'`], {
      encoding: "utf8",
    }).trim();
    expect(issue).toBe("742");
  });
});
