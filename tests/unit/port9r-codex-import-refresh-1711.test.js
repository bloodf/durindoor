import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(async (data) => ({ id: "c1", provider: data.provider, email: data.email, name: data.name })),
}));
vi.mock("@/models", () => ({ createProviderConnection: mocks.createProviderConnection }));

const { POST } = await import("../../src/app/api/oauth/codex/import-token/route.js");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const EXP = 1893456000; // 2030-01-01T00:00:00Z
const jwt = `${b64({ alg: "none" })}.${b64({ exp: EXP, email: "a@example.test" })}.sig`;
const post = (body) => POST(new Request("http://localhost/api/oauth/codex/import-token", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));

describe("port 9router #1711: codex token import with refresh token", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a refreshable oauth connection with expiry when a refresh token is given", async () => {
    const res = await post({ accessToken: jwt, refreshToken: "  rt_abc  " });
    expect(res.status).toBe(200);
    const saved = mocks.createProviderConnection.mock.calls[0][0];
    expect(saved).toMatchObject({
      provider: "codex",
      authType: "oauth",
      accessToken: jwt,
      refreshToken: "rt_abc",
      expiresAt: new Date(EXP * 1000).toISOString(),
    });
    expect(saved.providerSpecificData.authMethod).toBe("oauth");
  });

  it("keeps the access_token import unchanged without a refresh token", async () => {
    await post({ accessToken: jwt });
    const saved = mocks.createProviderConnection.mock.calls[0][0];
    expect(saved.authType).toBe("access_token");
    expect(saved).not.toHaveProperty("refreshToken");
    expect(saved.providerSpecificData.authMethod).toBe("access_token");
  });
});
