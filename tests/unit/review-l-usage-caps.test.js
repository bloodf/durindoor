import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  totals: vi.fn(), emitter: { on: vi.fn(), off: vi.fn() },
  stats: vi.fn(async () => ({ totalRequests: 0 })),
}));
vi.mock("@/lib/db/index.js", () => ({
  getApiKeyByKey: vi.fn(), getApiKeyUsageLimitStatus: vi.fn(),
  getApiKeyWindowUsageTotals: mocks.totals, statsEmitter: mocks.emitter,
}));
vi.mock("@/lib/usageDb", () => ({ statsEmitter: mocks.emitter, getUsageStats: mocks.stats }));

import { enforceApiKeyLimits } from "@/lib/apiKeyLimits.js";
import { GET } from "@/app/api/usage/stream/route.js";

it("rejects admission when a window usage query fails", async () => {
  mocks.totals.mockRejectedValueOnce(new Error("database unavailable"));
  const result = await enforceApiKeyLimits(new Request("http://localhost"), {
    id: "window-failure", key: "window-failure", policy: { monthlyBudget: 1 },
  });
  expect(result.status).toBe(503);
});

it("limits concurrent streams per key and releases slots on cancellation", async () => {
  const request = () => new Request("http://localhost/api/usage/stream", { headers: { authorization: "Bearer stream-key" } });
  const responses = await Promise.all(Array.from({ length: 4 }, () => GET(request())));
  expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
  expect((await GET(request())).status).toBe(429);
  await responses[0].body.cancel();
  const replacement = await GET(request());
  expect(replacement.status).toBe(200);
  await Promise.all([...responses.slice(1), replacement].map((response) => response.body.cancel()));
});
