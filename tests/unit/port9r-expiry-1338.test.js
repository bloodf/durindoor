import { expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({ connections: [] }));
vi.mock("next/server", () => ({ NextResponse: { json: (body) => ({ body }) } }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => data.connections,
  getSettings: async () => ({ quotaProviderOrder: ["codex", "claude"] }),
  listProviderQuotaSnapshots: async () => [],
}));
vi.mock("@/lib/oauth/providers", () => ({ backfillCodexEmails: async () => {}, backfillClaudeProfiles: async () => {} }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({ backfillCursorEmails: async () => {} }));

it("selects pages by saved expiry before provider grouping and safely serializes sanitized fields", async () => {
  data.connections = [
    { id: "late", provider: "codex", authType: "oauth", priority: 1n, expiresAt: "2026-05-25", apiKey: "secret" },
    { id: "early", provider: "claude", authType: "oauth", priority: 9007199254740993n, expiresAt: "invalid", rateLimitedUntil: "2026-05-23", providerSpecificData: { githubUserId: 7n, token: "secret" } },
    { id: "middle", provider: "codex", authType: "oauth", priority: 2n, expiresAt: "2026-05-24" },
    { id: "undated", provider: "claude", authType: "oauth", priority: 0n, expiresAt: "invalid" },
  ];
  const { GET } = await import("../../src/app/api/providers/client/route.js");
  const get = async (query) => (await GET({ url: `http://localhost/api/providers/client?${query}` })).body;
  const first = await get("sort=expiring&pageSize=2&page=1");
  const second = await get("sort=expiring&pageSize=2&page=2");
  expect(first.connections.map((item) => item.id)).toEqual(["early", "middle"]);
  expect(second.connections.map((item) => item.id)).toEqual(["late", "undated"]);
  expect(first.connections[0].priority).toBe("9007199254740993");
  expect(first.connections[0].providerSpecificData).toEqual({ githubUserId: 7 });
  expect(second.connections[0]).not.toHaveProperty("apiKey");
  const grouped = await get("sort=priority&pageSize=4");
  expect(grouped.connections.map((item) => item.id)).toEqual(["late", "middle", "undated", "early"]);
});
