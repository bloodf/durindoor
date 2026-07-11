/**
 * Model catalog consistency drift guard.
 *
 * Runs the M-1 local audit (`scripts/model-catalog-diff.mjs::localAudit`)
 * programmatically against the live registry + pricing and asserts the catalog
 * is clean: no duplicate ids per provider, all ids nonempty strings, every
 * `upstreamModelId` resolves, every `targetFormat` ∈ FORMATS, no orphan pricing
 * rows. No ordering assertions (model-array order is behavior; see plan M-2).
 *
 * Gate semantics
 * ──────────────
 * The FINAL assertion in the single test below is the real gate: it requires
 * zero findings. On `dev` today the audit reports the 37 findings catalogued
 * in `KNOWN_BASELINE`, so this test FAILS there — that is intentional and is
 * what proves the gate works. The test PASSES only after the M-2 catalog
 * refresh resolves every finding (at which point the baseline must be cleared).
 *
 * The FIRST assertion is a tripwire, not the gate: it accepts either the exact
 * documented baseline OR the empty set, and fails on anything else. That way a
 * *new* finding (or a known one that silently changes shape) is caught as
 * unexpected drift instead of being absorbed into a fuzzy snapshot, while the
 * post-cleanup empty state is also accepted. It does NOT gate cleanliness.
 */
import { describe, expect, it } from "vitest";

// Exact finding set reported by `node scripts/model-catalog-diff.mjs` on dev
// Baseline is empty: Phase 6 integration closed every catalog finding, so the live
// audit reports zero findings and this gate stays green.
const KNOWN_BASELINE = [];

const format = (findings) => findings.map((f) => `  - ${f}`).join("\n");

describe("model catalog consistency", () => {
  it("has zero drift-guard findings (fails on dev until M-2 cleanup lands)", async () => {
    const { localAudit } = await import("../../scripts/model-catalog-diff.mjs");
    const findings = (await localAudit()).sort();

    // Tripwire: findings must be EITHER the documented baseline (current dev)
    // OR empty (post-M-2). Anything else = unexpected drift; investigate before
    // touching KNOWN_BASELINE. Accepts empty so this same assertion keeps
    // passing after cleanup and never blocks the gate below from turning green.
    const matchesBaseline =
      findings.length === KNOWN_BASELINE.length &&
      findings.every((f, i) => f === KNOWN_BASELINE[i]);
    const isClean = findings.length === 0;
    expect(
      matchesBaseline || isClean,
      `catalog findings changed unexpectedly (neither the ${KNOWN_BASELINE.length}-finding baseline nor clean).\n` +
        `Actual (${findings.length}):\n${format(findings)}`
    ).toBe(true);

    // THE GATE: zero findings required. Fails on current dev (37 findings,
    // listed below); passes only after M-2 resolves every entry. Failure text
    // enumerates the live findings so a red run is self-explanatory.
    expect(
      findings,
      `model catalog consistency gate failed — resolve every finding (documented in KNOWN_BASELINE above):\n${format(
        findings
      )}`
    ).toEqual([]);
  });
});
