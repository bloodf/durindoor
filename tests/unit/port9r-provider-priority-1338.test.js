import { expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ NextResponse: { json: (body) => ({ body }) } }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => [
    { id: "invalid", provider: "codex", authType: "oauth", priority: "bad" },
    { id: "second", provider: "codex", authType: "oauth", priority: "2" },
    { id: "first", provider: "codex", authType: "oauth", priority: "1" },
  ],
  getSettings: async () => ({}),
  listProviderQuotaSnapshots: async () => [],
}));
vi.mock("@/lib/oauth/providers", () => ({ backfillCodexEmails: async () => {}, backfillClaudeProfiles: async () => {} }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({ backfillCursorEmails: async () => {} }));

it("orders numeric priorities before invalid priorities before pagination", async () => {
  const { GET } = await import("../../src/app/api/providers/client/route.js");
  const response = await GET({ url: "http://localhost/api/providers/client?pageSize=2" });
  expect(response.body.connections.map((connection) => connection.id)).toEqual(["first", "second"]);
});
