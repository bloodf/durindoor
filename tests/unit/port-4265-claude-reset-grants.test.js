/**
 * Regression tests for upstream decolua/9router PR #4265
 * ("feat(usage): show and redeem free limit resets for cc accounts").
 * Ports the observable contracts: cedar_ember grant parsing, the redeem
 * route (mocked fetch, no live network), and that no path redeems a grant
 * without an explicit POST triggered by the dashboard's confirm dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("port-4265: parseClaudeResetGrants", () => {
  it("sums usable grants and prefers next_grant_id", async () => {
    const { parseClaudeResetGrants } = await import("../../open-sse/services/usage/claude.js");
    const result = parseClaudeResetGrants({
      eligible: true,
      next_grant_id: "g2",
      weekly_resets_at: "2026-10-01T00:00:00Z",
      grants: [
        { id: "g1", resets_left: 1, ends_at: "2026-10-01T00:00:00Z" },
        { id: "g2", resets_left: 2, ends_at: "2026-10-22T00:00:00Z", clears: ["five_hour", "seven_day"] },
        { id: "g3", resets_left: 5, paused: true },
      ],
    });
    expect(result).toMatchObject({
      availableCount: 3,
      nextGrantId: "g2",
      expiresAt: "2026-10-22T00:00:00Z",
      weeklyResetsAt: "2026-10-01T00:00:00Z",
    });
    expect(result.grants.map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
    expect(result.grants[1].clears).toEqual(["five_hour", "seven_day"]);
    expect(result.grants[2].paused).toBe(true);
  });

});

describe("port-4265: parseClaudeResetGrants (null cases)", () => {
  it("returns null when ineligible, missing, or grants is not an array", async () => {
    const { parseClaudeResetGrants } = await import("../../open-sse/services/usage/claude.js");
    expect(parseClaudeResetGrants(undefined)).toBeNull();
    expect(parseClaudeResetGrants(null)).toBeNull();
    expect(parseClaudeResetGrants({ eligible: false, grants: [] })).toBeNull();
    expect(parseClaudeResetGrants({ eligible: true, grants: "nope" })).toBeNull();
  });

  it("drops paused/exhausted grants from availableCount but keeps them listed", async () => {
    const { parseClaudeResetGrants } = await import("../../open-sse/services/usage/claude.js");
    const result = parseClaudeResetGrants({
      eligible: true,
      grants: [
        { id: "a", resets_left: 0 },
        { id: "b", resets_left: 1, paused: true },
        { id: "c", resets_left: 1 },
      ],
    });
    expect(result.availableCount).toBe(1);
    expect(result.nextGrantId).toBe("c");
    expect(result.grants).toHaveLength(3);
  });
});

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  refreshAndUpdateCredentials: vi.fn(),
  consumeClaudeResetGrant: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.getProviderConnectionById }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/shared/services/providerCredentials", () => ({
  refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials,
}));
vi.mock("open-sse/services/usage.js", () => ({
  consumeClaudeResetGrant: mocks.consumeClaudeResetGrant,
}));

function request(body) {
  return new Request("http://localhost/api/usage/conn-1/claude-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("port-4265: POST /api/usage/[connectionId]/claude-reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshAndUpdateCredentials.mockResolvedValue({
      connection: { id: "conn-1", provider: "claude", authType: "oauth", accessToken: "tok" },
    });
  });

  it("rejects non-Claude connections", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({ id: "conn-1", provider: "codex", authType: "oauth" });
    const { POST } = await import("../../src/app/api/usage/[connectionId]/claude-reset/route.js");
    const response = await POST(request({ grantId: "g1" }), { params: Promise.resolve({ connectionId: "conn-1" }) });
    expect(response.status).toBe(400);
    expect(mocks.consumeClaudeResetGrant).not.toHaveBeenCalled();
  });

  it("rejects a missing grant id without calling upstream", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({ id: "conn-1", provider: "claude", authType: "oauth" });
    const { POST } = await import("../../src/app/api/usage/[connectionId]/claude-reset/route.js");
    const response = await POST(request({}), { params: Promise.resolve({ connectionId: "conn-1" }) });
    expect(response.status).toBe(400);
    expect(mocks.consumeClaudeResetGrant).not.toHaveBeenCalled();
  });

  it("redeems the named grant for an explicit request and returns the result", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({ id: "conn-1", provider: "claude", authType: "oauth" });
    mocks.consumeClaudeResetGrant.mockResolvedValue({
      ok: true,
      status: 200,
      result: "reset",
      reason: null,
      resetsLeft: 1,
      message: null,
    });

    const { POST } = await import("../../src/app/api/usage/[connectionId]/claude-reset/route.js");
    const response = await POST(request({ grantId: "g2" }), { params: Promise.resolve({ connectionId: "conn-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, result: "reset", resetsLeft: 1 });
    expect(mocks.consumeClaudeResetGrant).toHaveBeenCalledWith("tok", "g2", expect.any(Object));
  });

  it("surfaces a failed redeem with a non-2xx status instead of swallowing it", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({ id: "conn-1", provider: "claude", authType: "oauth" });
    mocks.consumeClaudeResetGrant.mockResolvedValue({
      ok: false,
      status: 409,
      result: "no_grant",
      reason: "no_grant",
      resetsLeft: 0,
      message: null,
    });

    const { POST } = await import("../../src/app/api/usage/[connectionId]/claude-reset/route.js");
    const response = await POST(request({ grantId: "g2" }), { params: Promise.resolve({ connectionId: "conn-1" }) });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.message).toContain("no_grant");
  });
});

describe("port-4265: no auto-redeem path exists", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetching Claude usage never calls the redeem endpoint on its own", async () => {
    // getClaudeUsage's only network call is the read-only oauth usage GET;
    // it must never reach the reset_rate_limits POST endpoint.
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ five_hour: { utilization: 10 }, cedar_ember: { eligible: false } }), { status: 200 }),
    );
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchSpy }));
    vi.resetModules();

    const { getClaudeUsage, __clearOAuthQuotaCacheForTesting } = await import("../../open-sse/services/usage/claude.js");
    __clearOAuthQuotaCacheForTesting();
    await getClaudeUsage("access-token", null, "oauth");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toContain("/api/oauth/usage");
    expect(String(calledUrl)).not.toContain("reset_rate_limits");
  });
});
