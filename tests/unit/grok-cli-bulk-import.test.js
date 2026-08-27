import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createProviderConnection = vi.hoisted(() => vi.fn());

vi.mock("@/models", () => ({ createProviderConnection }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }),
  },
}));

import { POST } from "../../src/app/api/oauth/grok-cli/bulk-import/route.js";

function request(body) {
  return new Request("http://localhost/api/oauth/grok-cli/bulk-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

describe("Grok CLI bulk import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("imports mixed token shapes serially with derived identity and partial token-safe results", async () => {
    let active = 0;
    let maxActive = 0;
    createProviderConnection.mockImplementation(async ({ accessToken: savedAccessToken }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      const callNumber = createProviderConnection.mock.calls.length;
      active -= 1;
      if (savedAccessToken === "storage-secret") {
        throw new Error("duplicate credential storage-secret");
      }
      return { id: `grok-${callNumber}` };
    });

    const idToken = jwt({ email: "id-token@example.com" });
    const accessToken = jwt({ sub: "access-token@example.com" });
    const response = await POST(request({ accounts: [
      {
        access_token: "snake-secret",
        refresh_token: "snake-refresh-secret",
        id_token: idToken,
        expires_in: 60,
      },
      { access_token: "invalid-secret", expires_in: "never" },
      {
        accessToken,
        refreshToken: "camel-refresh-secret",
        expiresAt: "2030-01-02T03:04:05.000Z",
        providerSpecificData: { userId: "user-2", authMethod: "authorization_code", accessToken: "nested-secret" },
      },
      { accessToken: "storage-secret" },
    ] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: 2,
      failed: 2,
      results: [
        { index: 0, ok: true, id: "grok-1" },
        { index: 1, ok: false, error: "expires_in / expiresIn must be a positive number" },
        { index: 2, ok: true, id: "grok-2" },
        { index: 3, ok: false, error: "duplicate credential [REDACTED]" },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/snake-secret|snake-refresh-secret|invalid-secret|camel-refresh-secret|storage-secret|nested-secret|header\./);
    expect(maxActive).toBe(1);
    expect(createProviderConnection).toHaveBeenCalledTimes(3);
    expect(createProviderConnection.mock.calls[0][0]).toEqual(expect.objectContaining({
      provider: "grok-cli",
      authType: "oauth",
      accessToken: "snake-secret",
      refreshToken: "snake-refresh-secret",
      idToken,
      email: "id-token@example.com",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      testStatus: "active",
      isActive: true,
      providerSpecificData: {
        authMethod: "device_code",
        email: "id-token@example.com",
      },
    }));
    expect(createProviderConnection.mock.calls[1][0]).toEqual(expect.objectContaining({
      accessToken,
      email: "access-token@example.com",
      expiresAt: "2030-01-02T03:04:05.000Z",
      providerSpecificData: {
        userId: "user-2",
        authMethod: "device_code",
        email: "access-token@example.com",
      },
    }));
  });

  it.each([
    [{ accessToken: "single" }],
    [[{ access_token: "array" }]],
    [{ accounts: [{ accessToken: "wrapped" }] }],
  ])("accepts single, array, and accounts-wrapped JSON (%#)", async (payload) => {
    createProviderConnection.mockResolvedValue({ id: "grok-1" });
    const response = await POST(request(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: 1,
      failed: 0,
      results: [{ index: 0, ok: true, id: "grok-1" }],
    });
  });
});
