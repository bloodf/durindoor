import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Sign-in stamping of the Antigravity/agy OAuth client binding. Mocked
// storage and HTTP only; this proves no live Google client acceptance.
const CLIENT_ID = "synthetic-binding-client.apps.example.test";
const CLIENT_SECRET = "synthetic-binding-secret";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-client-binding-"));
const previous = { ...process.env };
process.env.DATA_DIR = dir;
process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = CLIENT_ID;
process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = CLIENT_SECRET;
fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify({
  providerConnections: [{
    id: "legacy-agy", provider: "agy", authType: "oauth", email: "legacy@example.test",
    accessToken: "legacy-old", refreshToken: "legacy-refresh", projectId: "legacy-project",
    expiresAt: new Date(Date.now() - 60_000).toISOString(), isActive: true
  }]
}));

vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
const outbound = vi.hoisted(() => ({ calls: [], next: null }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: async (input, init = {}) => {
    outbound.calls.push({ url: String(input), init });
    return Response.json(outbound.next || { access_token: "refreshed", expires_in: 3600 });
  }
}));

const expected = `v1:${createHash("sha256").update(CLIENT_ID).digest("hex")}`;
let db, flow, binding, creds;
beforeAll(async () => {
  vi.stubGlobal("fetch", async () => { throw new Error("unexpected global fetch"); });
  db = await import("@/lib/localDb");
  flow = await import("@/lib/oauth/flowCompletion.js");
  binding = await import("@/lib/antigravity/clientBinding.js");
  creds = await import("@/shared/services/providerCredentials.js");
});
afterAll(() => { vi.unstubAllGlobals(); process.env = previous; fs.rmSync(dir, { recursive: true, force: true }); });

const proxy = { mode: "direct", metadataPatch: {} };
function signIn(provider, tokens, extra = {}) {
  return flow.saveOAuthConnection(provider, { accessToken: "a", refreshToken: "r", expiresIn: 3600, ...tokens }, proxy, extra);
}

describe("Antigravity OAuth client binding helper", () => {
  it("hashes the trimmed public client ID and never includes raw values", () => {
    expect(binding.clientBindingFor(` ${CLIENT_ID}\n`)).toBe(expected);
    expect(binding.clientBindingFor("")).toBeNull();
    expect(binding.clientBindingFor("   ")).toBeNull();
    expect(binding.clientBindingFor(undefined)).toBeNull();
    expect(expected).not.toContain(CLIENT_ID);
    expect(expected).not.toContain(CLIENT_SECRET);
    expect(expected).not.toBe(`v1:${createHash("sha256").update(CLIENT_SECRET).digest("hex")}`);
  });

  it("classifies legacy, matching, changed and empty current clients", () => {
    const marked = binding.withClientBinding({ other: 1 }, CLIENT_ID);
    expect(marked).toEqual({ other: 1, oauthClientBinding: expected });
    expect(binding.clientBindingStatus({}, CLIENT_ID)).toBe("unmarked");
    expect(binding.clientBindingStatus(undefined, "")).toBe("unmarked");
    expect(binding.clientBindingStatus(marked, CLIENT_ID)).toBe("match");
    expect(binding.clientBindingStatus(marked, "other-client")).toBe("mismatch");
    expect(binding.clientBindingStatus(marked, "")).toBe("mismatch");
    expect(binding.withClientBinding({ other: 1 }, "")).toEqual({ other: 1 });
  });
});

describe("sign-in stamping", () => {
  it.each(["antigravity", "agy"])("stamps %s at sign-in without the raw ID or secret", async (provider) => {
    const connection = await signIn(provider, { email: `${provider}@example.test`, providerSpecificData: { antigravitySubject: `sub-${provider}` } });
    const stored = await db.getProviderConnectionById(connection.id);
    expect(stored.providerSpecificData).toMatchObject({ oauthClientBinding: expected, antigravitySubject: `sub-${provider}` });
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(CLIENT_ID);
    expect(serialized).not.toContain(CLIENT_SECRET);
  });

  it("reauthorization restamps a row carrying another client's binding", async () => {
    const created = await signIn("antigravity", { email: "reauth@example.test" });
    await db.updateProviderConnection(created.id, { providerSpecificData: { oauthClientBinding: "v1:stale" } });
    const reconnected = await signIn("antigravity", { accessToken: "new", refreshToken: "new-r" }, { connectionId: created.id });
    expect(reconnected.providerSpecificData.oauthClientBinding).toBe(expected);
    expect((await db.getProviderConnectionById(created.id)).providerSpecificData.oauthClientBinding).toBe(expected);
  });

  it("does not stamp other providers", async () => {
    const connection = await signIn("gemini-cli", { email: "gemini@example.test" });
    expect((await db.getProviderConnectionById(connection.id)).providerSpecificData?.oauthClientBinding).toBeUndefined();
  });
});

describe("refresh leaves the binding unchanged", () => {
  it("legacy unmarked agy row refreshes as before and stays unmarked", async () => {
    outbound.calls.length = 0;
    outbound.next = { access_token: "legacy-new", expires_in: 3600 };
    const legacy = await db.getProviderConnectionById("legacy-agy");
    const result = await creds.refreshAntigravityConnection(legacy);
    expect(result).toMatchObject({ accessToken: "legacy-new", refreshToken: "legacy-refresh" });
    expect(outbound.calls).toHaveLength(1);
    expect(Object.fromEntries(outbound.calls[0].init.body)).toMatchObject({ client_id: CLIENT_ID, refresh_token: "legacy-refresh" });
    expect((await db.getProviderConnectionById("legacy-agy")).providerSpecificData?.oauthClientBinding).toBeUndefined();
  });

  it("refresh-token rotation on a marked row preserves the binding", async () => {
    const created = await signIn("antigravity", { email: "rotate@example.test", refreshToken: "rotate-old" });
    outbound.calls.length = 0;
    outbound.next = { access_token: "rotated-access", refresh_token: "rotate-new", expires_in: 3600 };
    const result = await creds.refreshAntigravityConnection(await db.getProviderConnectionById(created.id));
    expect(result).toMatchObject({ accessToken: "rotated-access", refreshToken: "rotate-new" });
    expect(result.providerSpecificData.oauthClientBinding).toBe(expected);
  });
});
