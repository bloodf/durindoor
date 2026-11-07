import { describe, expect, it, vi } from "vitest";
import { fetchGeminiApiKeyQuota } from "../../src/lib/usage/geminiApiKeyQuotaAdapter.js";
import { fetchXaiQuota, normalizeXaiPrepaidBalance } from "../../src/lib/usage/xaiQuotaAdapter.js";

const connection = { provider: "xai", apiKey: "inference-only", providerSpecificData: { teamId: "team/42", managementApiKey: "management-only" } };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

describe("documented quota snapshots", () => {
  it("keeps Gemini unknown even with a custom URL, without sending credentials", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchGeminiApiKeyQuota({ connection: { apiKey: "secret", providerSpecificData: { quotaEndpoint: "https://127.0.0.1" } }, fetchImpl })).toMatchObject({ outcome: "unknown", rows: [], quotas: {} });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([{}, { teamId: "team" }, { managementApiKey: "management" }, { ...connection.providerSpecificData, quotaEndpoint: "https://127.0.0.1" }])("does not send an inference key or use custom URLs: %j", async (providerSpecificData) => {
    const fetchImpl = vi.fn();
    expect(await fetchXaiQuota({ connection: { ...connection, providerSpecificData }, fetchImpl })).toMatchObject({ outcome: "unknown", quotas: {} });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([["-8550", 85.5], ["0", 0], ["100", 0]])("reads signed cents %s", (val, expected) => {
    expect(normalizeXaiPrepaidBalance({ total: { val } })).toBe(expected);
  });
  it.each([{}, { balance: 85.5 }, { total: { val: "" } }, { total: { val: 50 } }, { total: { val: "1.5" } }, { total: { val: "9007199254740992" } }])("rejects unproven balance shape %j", (payload) => {
    expect(normalizeXaiPrepaidBalance(payload)).toBeNull();
  });
  it("uses only the management credential and fixed endpoint with bounded transport", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ total: { val: "-8550" } }));
    const proxyOptions = { strictProxy: true };
    const result = await fetchXaiQuota({ connection, fetchImpl, proxyOptions });
    expect(result).toMatchObject({ outcome: "success", quotas: { "Prepaid credit (USD)": { total: 85.5, isCreditBalance: true } } });
    expect(fetchImpl).toHaveBeenCalledWith("https://management-api.x.ai/v1/billing/teams/team%2F42/prepaid/balance", expect.objectContaining({ redirect: "error", headers: { Authorization: "Bearer management-only", Accept: "application/json" }, signal: expect.any(AbortSignal) }), proxyOptions);
    expect(JSON.stringify(result)).not.toContain("management-only");
  });
  it.each([401, 403, 429, 500])("keeps failed HTTP %s unknown without fabricating balances", async (status) => {
    const result = await fetchXaiQuota({ connection, fetchImpl: vi.fn().mockResolvedValue(response({}, status)) });
    expect(result.quotas).toEqual({});
    expect(result.outcome).not.toBe("success");
  });
  it("runs Gemini through the real usage dispatcher", async () => {
    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    expect(await getUsageForProvider({ provider: "gemini", apiKey: "inference" })).toMatchObject({ outcome: "unknown", quotas: {} });
  });
});
