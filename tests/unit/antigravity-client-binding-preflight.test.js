import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Refresh preflight for the Antigravity/agy OAuth client binding, driven
// through the real refresh entry points. Storage is a temporary local DB and
// all HTTP is mocked; this proves no live Google client acceptance.
// The configured client is read once at module load, so each client change
// resets the module graph and imports the entry points again.
const CLIENT_A = "synthetic-preflight-a.apps.example.test";
const CLIENT_B = "synthetic-preflight-b.apps.example.test";
const bindingOf = (id) => `v1:${createHash("sha256").update(id).digest("hex")}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-binding-preflight-"));
const previous = { ...process.env };
process.env.DATA_DIR = dir;
const expired = () => new Date(Date.now() - 60_000).toISOString();
fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify({
  providerConnections: ["antigravity", "agy"].map((provider) => ({
    id: `legacy-${provider}`, provider, authType: "oauth", email: `legacy-${provider}@example.test`,
    accessToken: `legacy-${provider}-old`, refreshToken: `legacy-${provider}-refresh`, projectId: `legacy-${provider}-project`,
    expiresAt: expired(), isActive: true
  }))
}));

vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
const outbound = vi.hoisted(() => ({ calls: [], queue: [] }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: async (input, init = {}) => {
    outbound.calls.push({ url: String(input), init });
    const next = outbound.queue.shift() || { status: 200, body: { access_token: "unexpected", expires_in: 3600 } };
    return Response.json(next.body, { status: next.status });
  }
}));

let m;
async function useClient(clientId) {
  vi.resetModules();
  process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = clientId;
  process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = clientId ? `${clientId}-secret` : "";
  m = {
    db: await import("@/lib/localDb"),
    flow: await import("@/lib/oauth/flowCompletion.js"),
    creds: await import("@/shared/services/providerCredentials.js"),
    tokens: await import("open-sse/services/tokenRefresh.js"),
    models: await import("@/app/api/providers/[id]/models/fetchConnectionModels.js"),
    driver: await import("@/lib/db/driver.js")
  };
}

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => { throw new Error("unexpected global fetch"); });
  await useClient(CLIENT_A);
});
afterAll(() => { vi.unstubAllGlobals(); process.env = previous; fs.rmSync(dir, { recursive: true, force: true }); });

const tokenCalls = () => outbound.calls.filter((c) => c.url.includes("oauth2.googleapis.com") || c.url.includes("/token"));
const reset = (...queue) => { outbound.calls.length = 0; outbound.queue = queue; };
const tokenReply = (body) => ({ status: 200, body: { expires_in: 3600, ...body } });
const row = (id) => m.db.getProviderConnectionById(id);
async function leaseRows() {
  const adapter = await m.driver.getAdapter();
  try {
    return adapter.all("SELECT * FROM antigravityRefreshLeases ORDER BY connectionId");
  } catch {
    return [];
  }
}
// Durable fields a refused refresh must leave alone.
const durable = (r) => ({
  accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt, isActive: r.isActive,
  testStatus: r.testStatus, errorCode: r.errorCode, lastError: r.lastError, providerSpecificData: r.providerSpecificData
});
async function signIn(provider, refreshToken, extra = {}) {
  return m.flow.saveOAuthConnection(provider, {
    accessToken: `${refreshToken}-access`, refreshToken, expiresIn: 3600, email: `${refreshToken}@example.test`
  }, { mode: "direct", metadataPatch: {} }, extra);
}
async function expireAccess(id) {
  await m.db.updateProviderConnection(id, { expiresAt: expired() });
}

// Every refused entry point: zero outbound calls, no lease change, no row change.
async function expectRefused(id, provider) {
  await expireAccess(id);
  const before = durable(await row(id));
  const leases = await leaseRows();
  // Each refused row refreshed earlier, so its lease row exists and must stay as it is.
  expect(leases.some((lease) => lease.connectionId === id)).toBe(true);
  reset();

  await expect(m.creds.refreshAndUpdateCredentials(await row(id), true)).rejects.toMatchObject({
    code: "PROVIDER_REAUTH_REQUIRED", category: "reauth_required"
  });
  await expect(m.creds.refreshAndUpdateCredentials(await row(id), false)).rejects.toMatchObject({ category: "reauth_required" });
  await expect(m.creds.refreshAntigravityConnection(await row(id))).rejects.toMatchObject({ category: "reauth_required" });

  const stored = await row(id);
  const direct = { ...stored, connectionId: id };
  expect(await m.tokens.refreshTokenByProvider(provider, direct, null)).toEqual({ blocked: true, category: "reauth_required" });
  expect(await m.tokens.getAccessToken(provider, direct, null)).toEqual({ blocked: true, category: "reauth_required" });

  expect(outbound.calls).toHaveLength(0);
  expect(await leaseRows()).toEqual(leases);
  expect(durable(await row(id))).toEqual(before);
}

let markedAg, markedAgy;

describe("matching client (A)", () => {
  it("stamps both providers at sign-in", async () => {
    markedAg = (await signIn("antigravity", "ag-r1")).id;
    markedAgy = (await signIn("agy", "agy-r1")).id;
    expect((await row(markedAg)).providerSpecificData.oauthClientBinding).toBe(bindingOf(CLIENT_A));
    expect((await row(markedAgy)).providerSpecificData.oauthClientBinding).toBe(bindingOf(CLIENT_A));
  });

  it("dispatcher refresh with rotation dispatches once and keeps the marker", async () => {
    await expireAccess(markedAg);
    reset(tokenReply({ access_token: "ag-a2", refresh_token: "ag-r2" }));
    const result = await m.creds.refreshAndUpdateCredentials(await row(markedAg), true);
    expect(result.refreshed).toBe(true);
    expect(tokenCalls()).toHaveLength(1);
    expect(Object.fromEntries(tokenCalls()[0].init.body)).toMatchObject({ client_id: CLIENT_A, refresh_token: "ag-r1" });
    const stored = await row(markedAg);
    expect(stored).toMatchObject({ accessToken: "ag-a2", refreshToken: "ag-r2" });
    expect(stored.providerSpecificData.oauthClientBinding).toBe(bindingOf(CLIENT_A));
  });

  it("direct token refresh dispatches once and keeps the marker", async () => {
    await expireAccess(markedAgy);
    const stored = await row(markedAgy);
    reset(tokenReply({ access_token: "agy-a2", refresh_token: "agy-r2" }));
    const result = await m.tokens.refreshTokenByProvider("agy", { ...stored, connectionId: markedAgy }, null);
    expect(result).toMatchObject({ accessToken: "agy-a2", refreshToken: "agy-r2" });
    expect(tokenCalls()).toHaveLength(1);
    expect(Object.fromEntries(tokenCalls()[0].init.body)).toMatchObject({ client_id: CLIENT_A, refresh_token: "agy-r1" });
    expect((await row(markedAgy)).providerSpecificData.oauthClientBinding).toBe(bindingOf(CLIENT_A));
  });

  it("agy model discovery refreshes after a 401 under the matching client", async () => {
    reset({ status: 401, body: { error: "expired" } }, tokenReply({ access_token: "agy-a3" }), { status: 200, body: { models: {} } });
    await m.models.fetchConnectionModels(await row(markedAgy));
    expect(tokenCalls()).toHaveLength(1);
    expect(outbound.calls).toHaveLength(3);
    expect((await row(markedAgy)).providerSpecificData.oauthClientBinding).toBe(bindingOf(CLIENT_A));
  });
});

describe("changed client (B)", () => {
  beforeAll(() => useClient(CLIENT_B));

  it.each([["antigravity"], ["agy"]])("refuses every %s refresh entry point before lease or outbound", async (provider) => {
    await expectRefused(provider === "agy" ? markedAgy : markedAg, provider);
  });

  it("agy model discovery reports reauth_required without refreshing or writing", async () => {
    const before = durable(await row(markedAgy));
    const leases = await leaseRows();
    reset({ status: 401, body: { error: "expired" } });
    const result = await m.models.fetchConnectionModels(await row(markedAgy));
    expect(result).toMatchObject({ status: 409 });
    expect(result.error).toMatch(/different OAuth client/);
    expect(outbound.calls).toHaveLength(1);
    expect(tokenCalls()).toHaveLength(0);
    expect(await leaseRows()).toEqual(leases);
    expect(durable(await row(markedAgy))).toEqual(before);
  });

  it.each([["antigravity"], ["agy"]])("legacy unmarked %s row refreshes as before and is never stamped", async (provider) => {
    const id = `legacy-${provider}`;
    reset(tokenReply({ access_token: `${id}-new` }));
    const result = await m.creds.refreshAndUpdateCredentials(await row(id), true);
    expect(result.refreshed).toBe(true);
    expect(tokenCalls()).toHaveLength(1);
    expect(Object.fromEntries(tokenCalls()[0].init.body)).toMatchObject({ client_id: CLIENT_B, refresh_token: `${id}-refresh` });
    const stored = await row(id);
    expect(stored.accessToken).toBe(`${id}-new`);
    expect(stored.providerSpecificData?.oauthClientBinding).toBeUndefined();

    const direct = { ...stored, connectionId: id };
    reset(tokenReply({ access_token: `${id}-direct` }));
    expect(await m.tokens.refreshTokenByProvider(provider, direct, null)).toMatchObject({ accessToken: `${id}-direct` });
    expect(tokenCalls()).toHaveLength(1);
    expect((await row(id)).providerSpecificData?.oauthClientBinding).toBeUndefined();
  });

  it("reauthorization under B restamps the row and refresh works again", async () => {
    await signIn("agy", "agy-b1", { connectionId: markedAgy });
    expect((await row(markedAgy)).providerSpecificData.oauthClientBinding).toBe(bindingOf(CLIENT_B));
    await expireAccess(markedAgy);
    reset(tokenReply({ access_token: "agy-b2", refresh_token: "agy-b3" }));
    const result = await m.creds.refreshAndUpdateCredentials(await row(markedAgy), true);
    expect(result.refreshed).toBe(true);
    expect(tokenCalls()).toHaveLength(1);
    expect(Object.fromEntries(tokenCalls()[0].init.body)).toMatchObject({ client_id: CLIENT_B, refresh_token: "agy-b1" });
    const stored = await row(markedAgy);
    expect(stored).toMatchObject({ accessToken: "agy-b2", refreshToken: "agy-b3" });
    expect(stored.providerSpecificData.oauthClientBinding).toBe(bindingOf(CLIENT_B));
  });
});

describe("no configured client", () => {
  beforeAll(() => useClient(""));

  it.each([["antigravity"], ["agy"]])("refuses a marked %s row before lease or outbound", async (provider) => {
    await expectRefused(provider === "agy" ? markedAgy : markedAg, provider);
  });
});

describe("configured client restored (A)", () => {
  beforeAll(() => useClient(CLIENT_A));

  it("refresh resumes for the row issued by A and keeps the marker", async () => {
    await expireAccess(markedAg);
    reset(tokenReply({ access_token: "ag-a3", refresh_token: "ag-r3" }));
    const result = await m.creds.refreshAntigravityConnection(await row(markedAg));
    expect(result).toMatchObject({ accessToken: "ag-a3", refreshToken: "ag-r3" });
    expect(tokenCalls()).toHaveLength(1);
    expect(Object.fromEntries(tokenCalls()[0].init.body)).toMatchObject({ client_id: CLIENT_A, refresh_token: "ag-r2" });
    expect((await row(markedAg)).providerSpecificData.oauthClientBinding).toBe(bindingOf(CLIENT_A));
  });

  it("the row reauthorized under B is now refused under A", async () => {
    await expectRefused(markedAgy, "agy");
  });
});
