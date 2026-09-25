// Regression test for the provider account reorder (up/down arrow) bug.
//
// handleSwapPriority in providers/[id]/page.js used to send two independent
// `PUT /api/providers/:id` requests in parallel (Promise.all), one per
// swapped row. The server (connectionsRepo.reorderInTx) renumbers priorities
// 1..N after every write and breaks ties by most-recently-updated, so which
// of the two parallel writes landed "most recent" decided the final order —
// moving a row up one position could promote it to the top instead, and a
// failed write left an optimistic UI that was never persisted (res.ok was
// never checked).
//
// The fix reuses the atomic `PUT /api/providers/reorder` endpoint (already
// used by handleReorderByStatus, see src/shared/utils/connectionReorder.js
// and tests/unit/connection-reorder-availability.test.js) instead of
// duplicating the racy per-connection PUT logic.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { persistConnectionOrder } from "@/shared/utils/connectionReorder";

const pagePath = path.resolve("../src/app/(dashboard)/dashboard/providers/[id]/page.js");

describe("ProviderDetailPage handleSwapPriority", () => {
  it("delegates to the atomic persistConnectionOrder helper, not per-connection PUTs", () => {
    const page = fs.readFileSync(pagePath, "utf8");
    const start = page.indexOf("const handleSwapPriority");
    expect(start).toBeGreaterThan(-1);
    const body = page.slice(start, page.indexOf("};", start) + 2);

    expect(body).toContain("persistConnectionOrder(providerId, newConnections)");
    // The old racy implementation issued one PUT per swapped row in parallel.
    expect(body).not.toContain("Promise.all");
    expect(body).not.toMatch(/priority:\s*index1/);
  });
});

describe("persistConnectionOrder for a single up/down move", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits every row's final position in one atomic request", async () => {
    const connections = ["c0", "c1", "c2", "c3", "c4"].map((id) => ({ id }));
    // Move c2 up one position (swap index 1 and 2), mirroring handleSwapPriority.
    const next = [...connections];
    [next[1], next[2]] = [next[2], next[1]];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await persistConnectionOrder("openai", next);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/providers/reorder");
    expect(JSON.parse(options.body)).toEqual({
      providerId: "openai",
      orderedIds: ["c0", "c2", "c1", "c3", "c4"],
    });
  });

  it("throws (and does not swallow) when the server rejects the order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "orderedIds must match the provider's connection set exactly" }),
      }),
    );

    await expect(
      persistConnectionOrder("openai", [{ id: "c0" }, { id: "c1" }]),
    ).rejects.toThrow(/orderedIds must match/);
  });
});
