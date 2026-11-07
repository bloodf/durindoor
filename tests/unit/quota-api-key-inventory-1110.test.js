import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/localDb", () => ({ getProviderConnections: vi.fn() }));
vi.mock("@/lib/oauth/providers", () => ({ backfillCodexEmails: vi.fn(), backfillClaudeProfiles: vi.fn() }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({ backfillCursorEmails: vi.fn() }));
import { GET, isUsageEligible } from "@/app/api/providers/client/route.js";
import { getProviderConnections } from "@/lib/localDb";
import { USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";
describe("actual API-key quota inventory", () => {
  it.each(["gemini", "xai"])("includes %s through real registry-derived flags", async (provider) => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain(provider);
    expect(USAGE_APIKEY_PROVIDERS).toContain(provider);
    const connection = { id: "fixture", provider, authType: "apikey", isActive: true, managementApiKey: "private-fixture" };
    expect(isUsageEligible(connection)).toBe(true);
    expect(isUsageEligible({ ...connection, authType: "api_key" })).toBe(true);
    expect(isUsageEligible({ ...connection, isActive: false })).toBe(false);
    getProviderConnections.mockResolvedValue([connection]);
    const body = await (await GET(new Request("http://localhost/api/providers/client"))).json();
    expect(body.connections).toEqual([expect.objectContaining({ id: "fixture", provider })]);
    expect(JSON.stringify(body)).not.toContain("private-fixture");
  });
});
