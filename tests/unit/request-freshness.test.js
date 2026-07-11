import { describe, expect, it } from "vitest";
import { createLatestRequestGuard, mergeUsageResponse } from "@/shared/utils/requestFreshness";

describe("latest request guard", () => {
  it("rejects an older response when requests resolve out of order", async () => {
    const guard = createLatestRequestGuard();
    const old = guard.begin();
    const latest = guard.begin();
    const committed = [];

    await Promise.resolve();
    if (latest.isCurrent()) committed.push("latest");
    if (old.isCurrent()) committed.push("old");

    expect(committed).toEqual(["latest"]);
  });

  it("invalidates a request during cleanup", () => {
    const token = createLatestRequestGuard().begin();
    token.cancel();
    expect(token.isCurrent()).toBe(false);
  });

  it("keeps SSE live fields authoritative over a later REST payload", () => {
    expect(mergeUsageResponse(
      { totalRequests: 1, pending: { stale: true } },
      { totalRequests: 2, pending: { fromRest: true }, activeRequests: ["rest"] },
      { pending: { live: true }, activeRequests: ["sse"] },
    )).toMatchObject({
      totalRequests: 2,
      pending: { live: true },
      activeRequests: ["sse"],
    });
  });
});
