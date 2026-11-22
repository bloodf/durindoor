import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshAndUpdateCredentials } from "../../src/shared/services/providerCredentials.js";
import { getProviderCredentials, markAccountUnavailable } from "../../src/sse/services/auth.js";
import { getProjectIdForConnection, removeConnection } from "../../open-sse/services/projectId.js";

const db = vi.hoisted(() => ({ rows: [], getSettings: vi.fn(), evidence: vi.fn() }));
const outbound = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: outbound }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async ({ provider } = {}) => db.rows.filter((r) => !provider || r.provider === provider).map((r) => ({ ...r }))),
  getProviderConnectionById: vi.fn(async (id) => db.rows.find((r) => r.id === id) || null),
  updateProviderConnection: vi.fn(async (id, patch) => Object.assign(db.rows.find((r) => r.id === id), patch)),
  validateApiKey: vi.fn(), getSettings: db.getSettings,
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: db.evidence, clearProviderRateLimitEvidence: vi.fn(),
}));
const account = (id) => ({ id, provider: "antigravity", authType: "oauth", isActive: true, accessToken: `${id}-old`, refreshToken: `${id}-refresh`, priority: id === "a" ? 1 : 2, providerSpecificData: { projectId: `${id}-project` } });

describe("Antigravity credential isolation", () => {
  beforeEach(() => { db.rows = [account("a"), account("b")]; db.getSettings.mockResolvedValue({}); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
  it("shares one refresh and persists only the selected connection", async () => {
    let release;
    const refresh = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const update = vi.fn(async (id, patch) => Object.assign(db.rows.find((r) => r.id === id), patch));
    const options = { getProviderConnectionByIdImpl: async (id) => db.rows.find((r) => r.id === id), updateProviderConnectionImpl: update, getExecutorImpl: () => ({ needsRefresh: () => true, refreshCredentials: refresh }) };
    const requests = Array.from({ length: 12 }, () => refreshAndUpdateCredentials({ ...db.rows[0] }, true, null, options));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    release({ accessToken: "a-new", expiresIn: 3600 });
    const results = await Promise.all(requests);
    expect(results.every((r) => r.connection.accessToken === "a-new")).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(db.rows[1].accessToken).toBe("b-old");
    expect(db.rows[0].providerSpecificData.projectId).toBe("a-project");
  });
  it("uses a newer stored credential instead of refreshing a stale snapshot", async () => {
    const stale = { ...db.rows[0] };
    db.rows[0] = { ...db.rows[0], accessToken: "a-current", refreshToken: "a-current-refresh" };
    const refresh = vi.fn();
    const result = await refreshAndUpdateCredentials(stale, true, null, { getProviderConnectionByIdImpl: async () => db.rows[0], getExecutorImpl: () => ({ refreshCredentials: refresh }) });
    expect(result.connection.accessToken).toBe("a-current");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("keeps a failed refresh local to its account", async () => {
    const refresh = vi.fn(async (creds) => creds.connectionId === "a" ? null : { accessToken: "b-new", expiresIn: 3600 });
    const opts = { getProviderConnectionByIdImpl: async (id) => db.rows.find((r) => r.id === id), updateProviderConnectionImpl: async (id, patch) => Object.assign(db.rows.find((r) => r.id === id), patch), getExecutorImpl: () => ({ needsRefresh: () => true, refreshCredentials: refresh }) };
    const [bad, good] = await Promise.all(db.rows.map((row) => refreshAndUpdateCredentials(row, true, null, opts)));
    expect(bad.connection.accessToken).toBe("a-old");
    expect(good.connection.accessToken).toBe("b-new");
  });
  it("classifies project validation per credential and rejects cross-origin redirects", async () => {
    outbound.mockImplementation(async (_url, init) => {
      if (init.headers.Authorization === "Bearer rejected") return new Response("denied", { status: 403 });
      if (init.headers.Authorization === "Bearer redirect") return new Response(null, { status: 302, headers: { location: "https://other.invalid/steal" } });
      return Response.json({ cloudaicompanionProject: "healthy-project" });
    });
    await expect(getProjectIdForConnection("project-a", "rejected", null, null, "antigravity")).rejects.toMatchObject({ credentialScoped: true, status: 403 });
    expect(await getProjectIdForConnection("project-b", "healthy", null, null, "antigravity")).toBe("healthy-project");
    expect(await getProjectIdForConnection("project-c", "redirect", null, null, "antigravity")).toBeNull();
    expect(outbound).toHaveBeenCalledTimes(3);
    for (const id of ["project-a", "project-b", "project-c"]) removeConnection(id);
  });
  it.each([["rate limit", 30_000], ["insufficient credits", 24 * 60 * 60 * 1000]])("cools only the affected account for %s and recovers", async (message, duration) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const model = "gemini-3-flash";
    const context = message === "rate limit" ? { rateLimitEvidence: { state: "cooldown", resetAtMs: Date.now() + duration, source: "retry_after" } } : {};
    const result = await markAccountUnavailable("a", 429, message, "antigravity", model, null, context);
    expect(result.cooldownMs).toBe(duration);
    expect((await getProviderCredentials("antigravity", null, model)).connectionId).toBe("b");
    if (message === "insufficient credits") {
      expect((await getProviderCredentials("antigravity", null, "gemini-3-pro")).connectionId).toBe("b");
    }
    vi.advanceTimersByTime(duration + 1);
    expect((await getProviderCredentials("antigravity", null, model)).connectionId).toBe("a");
  });
});
