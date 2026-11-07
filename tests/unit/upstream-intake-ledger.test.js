import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ALLOWED_DISPOSITIONS,
  assertTitleDoesNotInferPort,
  buildReportPages,
  canonicalId,
  deduplicateCandidates,
  formatCandidateBullet,
  GITHUB_MAX_BYTES,
  normalizeRecord,
  runCli,
  validateRecord,
  writeReportFiles,
} from "../../scripts/upstream-intake-ledger.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = join(ROOT, "scripts/upstream-intake-ledger.mjs");
const SCAN_REPORT_SH = join(ROOT, "scripts/upstream-scan-report.sh");

let testDir;

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), "intake-ledger-test-"));
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("Record normalization and validation", () => {
  it("normalizes a standard PR candidate with default decolua/9router source", () => {
    const raw = {
      number: 1234,
      title: "fix: resolve SSE buffer truncation",
      additions: 10,
      deletions: 5,
      author: { login: "contributor" },
    };
    const norm = normalizeRecord(raw);
    expect(norm.source).toBe("decolua/9router");
    expect(norm.number).toBe(1234);
    expect(norm.title).toBe("fix: resolve SSE buffer truncation");
    expect(norm.disposition).toBe("candidate");
    expect(norm.state).toBe("open");
    expect(norm.finalDiff).toBe("pending");
    expect(norm.localEquivalent).toBe("none");
    expect(norm.test).toBe("none");
    expect(norm.ownerIssue).toBeNull();
    expect(norm.author).toBe("contributor");
  });

  it("normalizes commit candidate with explicit SHA and diegosouzapw/OmniRoute source", () => {
    const raw = {
      source: "diegosouzapw/OmniRoute",
      sha: "8ed9da7165340",
      title: "feat(sse): GLM-5.3 models",
      state: "merged",
      disposition: "tracked",
      ownerIssue: 1148,
      localEquivalent: "open-sse/providers/registry/glm.js",
      test: "tests/unit/glm-catalog.test.js",
    };
    const norm = normalizeRecord(raw);
    expect(norm.source).toBe("diegosouzapw/OmniRoute");
    expect(norm.sha).toBe("8ed9da7165340");
    expect(norm.number).toBeNull();
    expect(norm.ownerIssue).toBe("#1148");
    expect(norm.disposition).toBe("tracked");
    expect(norm.state).toBe("merged");
    expect(norm.finalDiff).toBe("https://github.com/diegosouzapw/OmniRoute/commit/8ed9da7165340");
    expect(norm.localEquivalent).toBe("open-sse/providers/registry/glm.js");
  });

  it("validates all allowed dispositions", () => {
    for (const disp of ALLOWED_DISPOSITIONS) {
      const rec = normalizeRecord({
        source: "decolua/9router",
        number: 4001,
        title: `candidate with ${disp}`,
        disposition: disp,
        localEquivalent: disp === "ported" ? "open-sse/test.js" : "none",
        why: disp === "ported" ? "verified in test" : "",
      });
      const { valid, errors } = validateRecord(rec);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    }
  });

  it("rejects invalid disposition or missing identifier", () => {
    const noId = normalizeRecord({ title: "orphan candidate" });
    const resNoId = validateRecord(noId);
    expect(resNoId.valid).toBe(false);
    expect(resNoId.errors.some((e) => e.includes("PR number or a commit SHA"))).toBe(true);

    const badDisp = normalizeRecord({
      number: 100,
      title: "bad disposition candidate",
      disposition: "arbitrary-unknown",
    });
    const resBadDisp = validateRecord(badDisp);
    expect(resBadDisp.valid).toBe(false);
    expect(resBadDisp.errors.some((e) => e.includes("Invalid disposition"))).toBe(true);
  });
});

describe("Title port invariant (do not infer ports from titles)", () => {
  it("never infers ported status from upstream title", () => {
    const raw = {
      source: "decolua/9router",
      number: 5555,
      title: "port(upstream): #4482 - ensure trailing user turn (#734)",
    };
    const norm = normalizeRecord(raw);
    // Disposition must remain candidate; title text does NOT promote to ported!
    expect(norm.disposition).toBe("candidate");
  });

  it("assertTitleDoesNotInferPort rejects ported candidate without evidence", () => {
    const fakePort = normalizeRecord({
      number: 5555,
      title: "port(upstream): something",
      disposition: "ported",
      localEquivalent: "none",
      why: "",
    });
    expect(() => assertTitleDoesNotInferPort(fakePort)).toThrow(/Provenance violation/);
  });
});

describe("Cross-source isolation and canonical IDs", () => {
  it("generates distinct keys for identical numbers across 9router and OmniRoute", () => {
    const c1 = normalizeRecord({ source: "decolua/9router", number: 42 });
    const c2 = normalizeRecord({ source: "diegosouzapw/OmniRoute", number: 42 });
    expect(canonicalId(c1)).toBe("decolua/9router#PR42");
    expect(canonicalId(c2)).toBe("diegosouzapw/OmniRoute#PR42");
    expect(canonicalId(c1)).not.toEqual(canonicalId(c2));
  });

  it("handles commit SHAs", () => {
    const c = normalizeRecord({ source: "decolua/9router", sha: "1fe586bb" });
    expect(canonicalId(c)).toBe("decolua/9router#SHA1fe586bb");
  });
});

describe("Deduplication", () => {
  it("deduplicates candidates within batch and merges higher-priority status", () => {
    const candidates = [
      { source: "decolua/9router", number: 3012, title: "cooldown v1", disposition: "candidate" },
      {
        source: "decolua/9router",
        number: 3012,
        title: "cooldown v2",
        disposition: "tracked",
        ownerIssue: 1148,
        localEquivalent: "open-sse/services/quota/",
      },
    ];
    const deduped = deduplicateCandidates(candidates);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].number).toBe(3012);
    expect(deduped[0].disposition).toBe("tracked");
    expect(deduped[0].ownerIssue).toBe("#1148");
    expect(deduped[0].localEquivalent).toBe("open-sse/services/quota/");
  });

  it("deduplicates against existing ported list with source qualification", () => {
    const candidates = [
      { source: "decolua/9router", number: 3660, title: "theme flash" },
      { source: "diegosouzapw/OmniRoute", number: 3660, title: "omniroute specific 3660" },
      { source: "decolua/9router", number: 9999, title: "unported candidate" },
    ];
    const existingPorted = [
      { pr: 3660, source: "decolua/9router" },
    ];
    const deduped = deduplicateCandidates(candidates, existingPorted);
    const p1 = deduped.find((c) => c.source === "decolua/9router" && c.number === 3660);
    const p2 = deduped.find((c) => c.source === "diegosouzapw/OmniRoute" && c.number === 3660);
    const p3 = deduped.find((c) => c.number === 9999);

    expect(p1.disposition).toBe("ported");
    // OmniRoute #3660 is NOT ported just because 9router #3660 is!
    expect(p2.disposition).toBe("candidate");
    expect(p3.disposition).toBe("candidate");
  });
});

describe("Format candidate bullet", () => {
  it("formats candidate line omitting author usernames", () => {
    const rec = normalizeRecord({
      source: "decolua/9router",
      number: 1355,
      title: "fail non-streaming requests when upstream SSE carries error",
      additions: 15,
      deletions: 2,
      disposition: "tracked",
      ownerIssue: 1355,
      localEquivalent: "open-sse/executors/stream.js",
      author: { login: "upstreamDev123" },
    });
    const line = formatCandidateBullet(rec);
    expect(line).toContain("[decolua/9router] #1355 +15/-2:");
    expect(line).toContain("fail non-streaming requests");
    expect(line).toContain("owner: #1355");
    expect(line).toContain("eq: open-sse/executors/stream.js");
    expect(line).not.toContain("upstreamDev123");
  });
});

describe("Pagination and body limits", () => {
  it("paginates candidates and guarantees every page is under GITHUB_MAX_BYTES", () => {
    const count = 750;
    const candidates = Array.from({ length: count }, (_, i) => ({
      source: i % 2 === 0 ? "decolua/9router" : "diegosouzapw/OmniRoute",
      number: 1000 + i,
      title: `upstream candidate ${i} ${"x".repeat(100)}`,
      additions: i,
      deletions: 1,
    }));

    const { pages, breakdown } = buildReportPages(candidates, { pageBytes: 30000 });
    expect(breakdown.total).toBe(count);
    expect(breakdown.unported).toBe(count);
    expect(pages.length).toBeGreaterThan(1);

    for (const page of pages) {
      const bytes = Buffer.byteLength(page, "utf8");
      expect(bytes).toBeLessThanOrEqual(GITHUB_MAX_BYTES);
    }

    // Continuation pages carry prefix
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i]).toMatch(/^Unported upstream PRs — page \d+ of \d+/);
    }
  });

  it("outputs a clean single page when 0 unported candidates exist", () => {
    const candidates = [
      { source: "decolua/9router", number: 10, title: "already done", disposition: "ported", why: "Reviewed local implementation" },
    ];
    const { pages, breakdown } = buildReportPages(candidates);
    expect(breakdown.unported).toBe(0);
    expect(breakdown.ported).toBe(1);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("0 unported");
  });
});

describe("CLI operations and script delegation", () => {
  it("CLI build-report creates body.md and comment files", () => {
    const candidates = [
      { source: "decolua/9router", number: 2001, title: "first PR", additions: 5, deletions: 1 },
      { source: "diegosouzapw/OmniRoute", number: 2002, title: "second PR", additions: 8, deletions: 2 },
    ];
    const candFile = join(testDir, "cli-cand.json");
    const outDir = join(testDir, "cli-out");
    writeFileSync(candFile, JSON.stringify(candidates));

    const exitCode = runCli([
      "node",
      "upstream-intake-ledger.mjs",
      "build-report",
      "--candidates",
      candFile,
      "--outdir",
      outDir,
    ]);
    expect(exitCode).toBe(0);

    const bodyContent = readFileSync(join(outDir, "body.md"), "utf8");
    expect(bodyContent).toContain("Scanned 2 upstream candidates");
    expect(bodyContent).toContain("#2001");
    expect(bodyContent).toContain("#2002");
  });

  it("CLI validate passes valid candidates file", () => {
    const candidates = [
      { source: "decolua/9router", number: 3001, title: "valid PR", disposition: "candidate" },
      {
        source: "diegosouzapw/OmniRoute",
        sha: "deadbeef123",
        title: "valid commit",
        disposition: "deferred",
      },
    ];
    const candFile = join(testDir, "cli-valid.json");
    writeFileSync(candFile, JSON.stringify(candidates));

    const exitCode = runCli([
      "node",
      "upstream-intake-ledger.mjs",
      "validate",
      "--candidates",
      candFile,
    ]);
    expect(exitCode).toBe(0);
  });

  it("upstream-scan-report.sh --intake delegates to upstream-intake-ledger.mjs", () => {
    const candidates = [
      { source: "decolua/9router", number: 4001, title: "scan report intake PR", additions: 2, deletions: 1 },
    ];
    const candFile = join(testDir, "scan-intake-cand.json");
    const outDir = join(testDir, "scan-intake-out");
    writeFileSync(candFile, JSON.stringify(candidates));

    const stdout = execFileSync(
      SCAN_REPORT_SH,
      ["--intake", candFile, outDir],
      { encoding: "utf8" }
    );
    expect(stdout).toContain("total=1 ported=0 new=1 pages=1");
    const body = readFileSync(join(outDir, "body.md"), "utf8");
    expect(body).toContain("#4001");
  });
});


describe("Intake safety regressions", () => {
  it("reads the repository ledger shape and ignores explicit null/empty sources", () => {
    const rows = [42, 43, 44].map(number => ({ number }));
    const result = deduplicateCandidates(rows, { ported: [
      { pr: 42, why: "reviewed" }, { pr: 43, source: null }, { pr: 44, source: "" },
    ] });
    expect(result.map(row => row.disposition)).toEqual(["ported", "candidate", "candidate"]);
  });

  it.each([{ number: -1 }, { number: "NaN" }, { sha: "not-a-sha" },
    { number: 1, source: null }, { number: 1, state: "invalid" },
    { number: 1, disposition: "ported" }])("rejects invalid input before reporting %j", row => {
    expect(() => buildReportPages([row])).toThrow();
  });

  it("retains every UTF-8 candidate exactly once within the configured page ceiling", () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ number: i + 1, title: `unique-${i} 終`.repeat(3) }));
    const { pages } = buildReportPages(rows, { pageBytes: 700 });
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(Buffer.byteLength(page)).toBeLessThanOrEqual(700);
    expect(pages.join("\n").split("\n").filter(line => line.startsWith("- ["))).toHaveLength(80);
    for (const row of rows) expect(pages.join("\n").split(row.title)).toHaveLength(2);
  });

  it.each([0, -1, NaN, 65537, 1.5])("rejects unsafe page limit %s", pageBytes => {
    expect(() => buildReportPages([{ number: 1 }], { pageBytes })).toThrow();
  });

  it("rejects oversized entries without truncation", () => {
    expect(() => buildReportPages([{ number: 1, title: "x".repeat(70000) }])).toThrow(/exceeds/);
  });

  it("preserves candidate JSON and unrelated output files on regeneration", () => {
    const out = join(testDir, "safe-output");
    writeReportFiles(["first", "stale"], out);
    writeFileSync(join(out, "candidates.json"), "[]");
    writeFileSync(join(out, "comment-notes.md"), "keep");
    writeReportFiles(["second"], out);
    expect(readFileSync(join(out, "candidates.json"), "utf8")).toBe("[]");
    expect(readFileSync(join(out, "comment-notes.md"), "utf8")).toBe("keep");
    expect(() => readFileSync(join(out, "comment-002.md"))).toThrow();
  });

  it("fails closed on a missing explicitly supplied ledger", () => {
    const input = join(testDir, "missing-ledger-input.json");
    writeFileSync(input, "[]");
    expect(() => runCli(["node", SCRIPT, "dedup", "--candidates", input,
      "--ported", join(testDir, "absent.json")])).toThrow();
  });
});


describe("Persisted reviewed provenance", () => {
  it("reports serialized dedup output using the repository ledger shape", () => {
    const candidates = join(testDir, "roundtrip-input.json");
    const reviewed = join(testDir, "roundtrip-reviewed.json");
    const ledger = join(ROOT, ".github/upstream-ported.json");
    const out = join(testDir, "roundtrip-report");
    writeFileSync(candidates, JSON.stringify([{ number: 2533 }, { number: 999999 }]));
    execFileSync(process.execPath, [SCRIPT, "dedup", "--candidates", candidates,
      "--ported", ledger, "--out", reviewed]);
    const rows = JSON.parse(readFileSync(reviewed, "utf8"));
    expect(rows[0].disposition).toBe("ported");
    expect(rows[0].why).toContain("decolua/9router#PR2533");
    expect(validateRecord(rows[0]).valid).toBe(true);
    const stdout = execFileSync(SCAN_REPORT_SH, ["--intake", reviewed, out, ledger], { encoding: "utf8" });
    expect(stdout).toContain("total=2 ported=1 new=1 pages=1");
    const body = readFileSync(join(out, "body.md"), "utf8");
    expect(body).toContain("#999999");
    expect(body).not.toContain("#2533");
  });
});
