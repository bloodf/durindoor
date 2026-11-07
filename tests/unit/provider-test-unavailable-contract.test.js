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

const oauthOutcomes = [503, 429, "TimeoutError", "AbortError", 401, 403, 200, "blocked", "application"];
const unavailableOAuthOutcomes = [503, 429, "TimeoutError", "AbortError"];
function savedOAuthRow(id) {
  return {
    id, provider: "github", authType: "oauth", accessToken: `private-oauth-${id}`,
    expiresAt: "2099-01-01T00:00:00.000Z", providerSpecificData: {},
    testStatus: "active", lastError: "prior metadata", lastErrorAt: "2026-01-01T00:00:00.000Z"
  };
}
async function oauthProbeOutcome(outcome) {
  if (typeof outcome === "number") return new Response("", { status: outcome });
  if (outcome === "blocked") {
    const { OutboundUrlGuardError } = await import("../../open-sse/utils/outboundUrlGuard.js");
    throw new OutboundUrlGuardError("Outbound URL blocked", { code: "OUTBOUND_URL_GUARD_BLOCKED", url: "http://127.0.0.1" });
  }
  if (outcome === "application") throw new Error("Invalid probe configuration");
  throw new DOMException("private transport detail", outcome);
}

it.each(oauthOutcomes)("preserves saved GitHub OAuth metadata only for transient outcome %s", async (outcome) => {
  const row = savedOAuthRow("oauth");
  const original = structuredClone(row);
  db.get.mockResolvedValue(row);
  const restore = __setProviderTestFetchForTesting(async (_url, _options, proxy) => {
    expect(proxy).toEqual({ connectionProxyEnabled: false });
    return oauthProbeOutcome(outcome);
  });
  try {
    const response = await POST(new Request("http://localhost/api/providers/oauth/test", { method: "POST" }), { params: Promise.resolve({ id: "oauth" }) });
    const result = await response.json();
    const unavailable = unavailableOAuthOutcomes.includes(outcome);
    expect(result).toMatchObject({ valid: outcome === 200, unavailable, refreshed: false });
    expect(JSON.stringify(result)).not.toContain(row.accessToken);
    expect(JSON.stringify(result)).not.toContain("private transport detail");
    expect(row).toEqual(original);
    if (unavailable) expect(db.update).not.toHaveBeenCalled();
    else {
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(db.update).toHaveBeenCalledWith("oauth", expect.objectContaining({
        testStatus: outcome === 200 ? "active" : "error",
        lastError: outcome === 200 ? null : expect.any(String),
        lastErrorAt: outcome === 200 ? null : expect.any(String)
      }));
    }
    if (outcome === 401) expect(result.error).toBe("Token invalid or revoked");
    if (outcome === 403) expect(result.error).toBe("Access denied");
  } finally { restore(); }
});

it("counts GitHub OAuth transient probes separately in batch and writes only definitive outcomes", async () => {
  const rows = oauthOutcomes.map((_, i) => savedOAuthRow(String(i)));
  const original = structuredClone(rows);
  db.list.mockResolvedValue(rows);
  db.get.mockImplementation(async (id) => rows.find((row) => row.id === id));
  const restore = __setProviderTestFetchForTesting(async (_url, options) => {
    const id = options.headers.Authorization.replace("Bearer private-oauth-", "");
    return oauthProbeOutcome(oauthOutcomes[Number(id)]);
  });
  try {
    const response = await batch(new Request("http://localhost/api/providers/test-batch", { method: "POST", body: JSON.stringify({ mode: "all" }) }));
    const result = await response.json();
    expect(result.summary).toEqual({ total: 9, passed: 1, failed: 4, skipped: 0, unavailable: 4 });
    expect(db.update.mock.calls.map(([id]) => id).sort()).toEqual(["4", "5", "6", "7", "8"]);
    expect(rows).toEqual(original);
    for (const row of rows) expect(JSON.stringify(result)).not.toContain(row.accessToken);
  } finally { restore(); }
});
