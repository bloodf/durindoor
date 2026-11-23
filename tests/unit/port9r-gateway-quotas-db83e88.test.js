import { describe, expect, it, vi } from "vitest";
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { pickSafeProviderSpecificData } from "../../src/lib/providerRouteHandlers.js";
import { isSensitiveProviderSpecificDataKey } from "../../src/lib/db/helpers/providerSpecificDataSecrets.js";
import { resolveTransport } from "../../open-sse/services/provider.js";

describe("gateway provider quota and routing", () => {
  it("reports Synthetic hourly search alongside the current weekly pool", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      planWeeklyLimit: { percentRemaining: 40 },
      search: { hourly: { limit: 250, requests: 70, renewsAt: "2026-12-01T00:00:00Z" } },
    })));
    const result = await getUsageForProvider({ provider: "synthetic", apiKey: "test" });
    expect(result.quotas.Weekly.remaining).toBe(40);
    expect(result.quotas["Search (hourly)"]).toMatchObject({ used: 70, total: 250, remainingPercentage: 72 });
  });
  it("retains search quota when a subscription has no limit", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response(JSON.stringify({ subscription: { limit: 0 }, search: { hourly: { limit: 10, requests: 2 } } })));
    const result = await getUsageForProvider({ provider: "synthetic", apiKey: "test" });
    expect(result.quotas["Search (hourly)"].remaining).toBe(8);
  });
  it("routes DeepRelay and OpenDesign requests using the native formats", () => {
    expect(resolveTransport("deeprelay", "claude").baseUrl).toBe("https://api.deeprelay.ai/v1/messages");
    expect(resolveTransport("opendesign-go", "openai-responses").baseUrl).toBe("https://amr-link.open-design.ai/v1/responses");
  });
  it("classifies the OpenDesign control key as an encrypted secret", () => {
    expect(isSensitiveProviderSpecificDataKey("opendesignControlKey")).toBe(true);
    expect(pickSafeProviderSpecificData("opendesign-go", { opendesignControlKey: "secret", opendesignWorkspaceId: "workspace" })).toEqual({ opendesignWorkspaceId: "workspace" });
  });
  it("refuses ambiguous OpenDesign workspaces", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ workspaceId: "one" }, { workspaceId: "two" }] })));
    const result = await getUsageForProvider({ provider: "opendesign-go", providerSpecificData: { opendesignControlKey: "vela_ctrl_test" } });
    expect(result.message).toMatch(/2 workspaces/i);
    expect(result.quotas).toBeUndefined();
  });
});

describe("gateway error handling", () => {
  it("does not expose a credential echoed in an upstream error", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response("vela_ctrl_test", { status: 500 }));
    const result = await getUsageForProvider({ provider: "opendesign-go", providerSpecificData: { opendesignControlKey: "vela_ctrl_test" } });
    expect(result.message).not.toContain("vela_ctrl_test");
    expect(result.message).toContain("500");
  });
});
