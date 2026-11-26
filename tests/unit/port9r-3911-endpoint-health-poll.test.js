import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLIENT_PING_FAST_MS,
  CLIENT_PING_SLOW_MS,
  STATUS_POLL_FAST_MS,
  STATUS_POLL_SLOW_MS,
} from "../../src/app/(dashboard)/dashboard/endpoint/endpointConstants.js";

const PAGE = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx", import.meta.url),
  "utf8",
);

// The repo has no DOM effect harness, so this pins the two effect invariants in source.
describe("9router #3911 (cdc04504b73f) - slow the health polls down instead of stopping them", () => {
  it("polls tunnel status slowly while healthy and fast while degraded", () => {
    expect(STATUS_POLL_SLOW_MS).toBeGreaterThan(STATUS_POLL_FAST_MS);
    expect(PAGE).toContain("allHealthy ? STATUS_POLL_SLOW_MS : STATUS_POLL_FAST_MS");
    expect(PAGE).not.toContain("if (allHealthy) return");
  });

  it("keeps probing from the browser while both endpoints are reachable", () => {
    expect(CLIENT_PING_SLOW_MS).toBeGreaterThan(CLIENT_PING_FAST_MS);
    expect(PAGE).toContain("tunnelHealthy && tsHealthy ? CLIENT_PING_SLOW_MS : CLIENT_PING_FAST_MS");
    expect(PAGE).not.toContain("if (tunnelHealthy && tsHealthy) return");
  });
});
