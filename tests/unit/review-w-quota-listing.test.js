import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  listProviderQuotaSnapshots: vi.fn(),
}));

vi.mock("@/lib/localDb", () => mocks);
vi.mock("@/lib/oauth/providers", () => ({ backfillCodexEmails: vi.fn(), backfillClaudeProfiles: vi.fn() }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({ backfillCursorEmails: vi.fn() }));

import { GET } from "@/app/api/providers/client/route.js";

describe("provider client quota listing", () => {
  it("returns dimension floors and pauses a connection below its floor", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      id: "quota-connection",
      provider: "codex",
      authType: "oauth",
      isActive: true,
    }]);
    mocks.getSettings.mockResolvedValue({ quotaSelection: {
      routingFloorEnabled: true,
      routingFloorRatio: 0.2,
    } });
    mocks.listProviderQuotaSnapshots.mockResolvedValue([{
      identity: { connectionId: "quota-connection", provider: "codex", accountKey: "scope:connection", resourceKey: "scope:account", dimensionKey: "requests:runtime" },
      state: "low",
      amounts: { limitKind: "bounded", limit: 100, used: 90, remaining: 10, remainingRatio: 0.1, unit: "requests" },
      timing: { observedAt: new Date().toISOString(), staleAt: new Date(Date.now() + 60_000).toISOString(), resetAt: null, cooldownUntil: null },
      provenance: { sourceType: "provider_api", sourceId: "codex:wham-usage:v1", reasonCode: "rate_limited", metadata: {} },
    }]);

    const response = await GET(new Request("http://localhost/api/providers/client"));
    const body = await response.json();

    expect(body.connections[0].quotaWindows).toEqual([
      { key: "requests:runtime", percent: null, effectivePercent: 20 },
    ]);
    expect(body.connections[0].quotaPaused).toBe(true);
    expect(mocks.getSettings).toHaveBeenCalledTimes(1);
  });
});
