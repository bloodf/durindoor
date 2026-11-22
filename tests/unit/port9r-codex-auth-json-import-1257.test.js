import { beforeEach, describe, expect, it, vi } from "vitest";

const createProviderConnection = vi.hoisted(() => vi.fn());

vi.mock("@/models", () => ({ createProviderConnection }));
vi.mock("@/lib/oauth/providers", () => ({ extractCodexAccountInfo: vi.fn(() => null) }));

import { POST } from "../../src/app/api/oauth/codex/bulk-import/route.js";
import { normalizeCodexImportRecord } from "../../src/lib/oauth/codexImportRecord.js";

function request(body) {
  return new Request("http://localhost/api/oauth/codex/bulk-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("upstream 9router #1257: Codex CLI auth.json bulk import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createProviderConnection.mockResolvedValue({ id: "codex-1" });
  });

  it("imports a Codex CLI auth.json with nested snake_case tokens", async () => {
    const authJson = {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: "sk-should-not-persist",
      last_refresh: "2026-11-01T00:00:00Z",
      tokens: {
        id_token: "id.jwt.token",
        access_token: "access.jwt.token",
        refresh_token: "rt_refresh",
        account_id: "acct-123",
      },
      email: "user@example.com",
    };

    const response = await POST(request([authJson]));
    const body = await response.json();

    expect(body).toMatchObject({ success: 1, failed: 0 });
    const saved = createProviderConnection.mock.calls[0][0];
    expect(saved).toMatchObject({
      provider: "codex",
      authType: "oauth",
      accessToken: "access.jwt.token",
      refreshToken: "rt_refresh",
      idToken: "id.jwt.token",
      email: "user@example.com",
      providerSpecificData: expect.objectContaining({ chatgptAccountId: "acct-123" }),
    });
    for (const key of ["tokens", "auth_mode", "OPENAI_API_KEY", "last_refresh", "access_token", "account_id"]) {
      expect(saved).not.toHaveProperty(key);
    }
  });

  it("maps flat snake_case exports including expired", () => {
    const input = { access_token: "a", refresh_token: "r", expired: "2026-12-01T00:00:00Z" };
    const out = normalizeCodexImportRecord(input);
    expect(out).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: "2026-12-01T00:00:00.000Z" });
    expect(input).toHaveProperty("access_token", "a");
  });

  it("keeps camelCase fields authoritative and passes non-objects through", () => {
    expect(normalizeCodexImportRecord({ accessToken: "camel", access_token: "snake" }))
      .toEqual({ accessToken: "camel" });
    expect(normalizeCodexImportRecord(null)).toBeNull();
  });
});
