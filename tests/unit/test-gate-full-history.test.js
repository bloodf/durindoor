import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every workflow that runs the blocking Vitest gate (`npm run test:ci`) must
 * check out with `fetch-depth: 0`.
 *
 * The gate includes tests that read real git history — the ported-ledger test
 * in `tests/unit/upstream-watch-filter.test.js` unions
 * `.github/upstream-ported.json` with `port(upstream): #N` commit subjects
 * across the whole repo. A shallow checkout makes the subject scan silently
 * return nothing and the gate fails on a byte-identical tree: release.yml
 * (fetch-depth: 2) failed the v3.20.0 and v3.20.1 publishes, and nightly.yml
 * failed every run from 2026-09-05 until this guard landed. test.yml has used
 * fetch-depth: 0 all along, which is why PR CI stayed green.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS_DIR = join(ROOT, ".github/workflows");

/** Workflows that invoke the blocking test gate. */
const gateWorkflows = () =>
  readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => ({ file: f, text: readFileSync(join(WORKFLOWS_DIR, f), "utf8") }))
    .filter(({ text }) => text.includes("npm run test:ci"));

describe("workflows running the blocking Vitest gate", () => {
  it("finds the gate in at least one workflow (detector sanity)", () => {
    // If this fails the detector regex broke and the real check is vacuous.
    expect(gateWorkflows().length).toBeGreaterThan(0);
  });

  it("checks out with full history (fetch-depth: 0)", () => {
    for (const { file, text } of gateWorkflows()) {
      // Each actions/checkout step in a gate workflow must fetch full history.
      const checkouts = text.match(/uses: actions\/checkout@.*/g) || [];
      expect(checkouts.length, `${file} must check out the repo`).toBeGreaterThan(0);
      expect(text, `${file} runs test:ci against a shallow clone; the ported-ledger test needs full history`).toContain(
        "fetch-depth: 0",
      );
    }
  });
});
