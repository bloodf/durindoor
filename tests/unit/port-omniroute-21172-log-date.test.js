import { describe, expect, it, vi } from "vitest";

const { all } = vi.hoisted(() => ({ all: vi.fn() }));
vi.mock("../../src/lib/db/driver.js", () => ({ getAdapter: async () => ({ all }) }));
vi.mock("../../src/lib/db/repos/connectionsRepo.js", () => ({ getProviderConnections: async () => [] }));

import { getRecentLogs } from "../../src/lib/db/repos/usageRepo.js";

describe("OmniRoute #21172 request log dates", () => {
  it("retains the calendar date and time for entries across midnight", async () => {
    const row = { provider: "test", model: "model", status: "OK" };
    all.mockReturnValue([
      { ...row, timestamp: new Date(2026, 10, 25, 0, 1, 2).toISOString() },
      { ...row, timestamp: new Date(2026, 10, 24, 23, 59, 58).toISOString() },
    ]);
    const logs = await getRecentLogs();
    expect(logs.map((log) => log.split(" | ")[0])).toEqual([
      "25-11-2026 00:01:02",
      "24-11-2026 23:59:58",
    ]);
  });
});
