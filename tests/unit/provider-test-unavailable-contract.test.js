import { afterEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), list: vi.fn() }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: db.get, updateProviderConnection: db.update }));
vi.mock("@/models", () => ({ getProviderConnections: db.list }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({ connectionProxyEnabled: false })) }));
import { POST } from "../../src/app/api/providers/[id]/test/route.js";
import { POST as batch } from "../../src/app/api/providers/test-batch/route.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { __setProviderTestFetchForTesting } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { testSummaryToast } from "../../src/app/(dashboard)/dashboard/providers/testSummaryToast.js";
afterEach(() => vi.clearAllMocks());

it.each([503, 401, 403, 200])("carries real probe status %i through the saved route without exposing the key", async (status) => {
  db.get.mockResolvedValue({ id: "a", provider: "gitlawb-gmi", authType: "apikey", apiKey: "private-test-key", providerSpecificData: {}, testStatus: "active" });
  const restore = __setProviderTestFetchForTesting(async () => new Response("", { status }));
  try {
    const response = await POST(new Request("http://localhost/api/providers/a/test", { method: "POST" }), { params: Promise.resolve({ id: "a" }) });
    const result = await response.json();
    expect(result).toMatchObject({ valid: status === 200, unavailable: status === 503, skipped: false, refreshed: false });
    expect(JSON.stringify(result)).not.toContain("private-test-key");
    if (status === 503) expect(db.update).not.toHaveBeenCalled();
    else expect(db.update).toHaveBeenCalledWith("a", expect.objectContaining({ testStatus: status === 200 ? "active" : "error" }));
    if (status === 401 || status === 403) expect(result.error).toBe("Invalid API key");
  } finally { restore(); }
});

it("keeps real temporary and rejected probes separate in batch counts and toast", async () => {
  const rows = ["a", "b"].map((id) => ({ id, provider: "gitlawb-gmi", authType: "apikey", apiKey: id, providerSpecificData: {} }));
  db.list.mockResolvedValue(rows);
  db.get.mockImplementation(async (id) => rows.find((row) => row.id === id));
  const restore = __setProviderTestFetchForTesting(async (_url, options) => new Response("", { status: options.headers.Authorization === "Bearer a" ? 503 : 401 }));
  try {
    const response = await batch(new Request("http://localhost/api/providers/test-batch", { method: "POST", body: JSON.stringify({ mode: "all" }) }));
    const result = await response.json();
    expect(result.summary).toEqual({ total: 2, passed: 0, failed: 1, skipped: 0, unavailable: 1 });
    expect(testSummaryToast(result.summary)).toEqual({ level: "warning", message: "0/2 passed, 1 failed, 1 unavailable" });
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update.mock.calls[0][0]).toBe("b");
  } finally { restore(); }
});

it("does not accept an outage or an unrelated HTTP failure as Claude credential proof", async () => {
  for (const status of [503, 404]) {
    const result = await probeRegistryProvider("wafer", "private-test-key", async () => new Response("", { status }));
    expect(result).toMatchObject({ valid: false, status });
    if (status === 503) expect(result.unavailable).toBe(true);
  }
});

it("keeps successful catalog fallback and marks exhausted network probes uncertain", async () => {
  const transport = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response("", { status: 200 }));
  expect(await probeRegistryProvider("qiniu", "key", transport)).toMatchObject({ valid: true, status: 200 });
  expect(await probeRegistryProvider("qiniu", "key", async () => { throw new Error("secret transport detail"); })).toMatchObject({ valid: false, unavailable: true, status: null });
});
