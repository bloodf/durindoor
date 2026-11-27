import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const previous = { ...process.env };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-default-"));
const redirect = "http://localhost:51121/oauth-callback";
const publicId = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const outbound = vi.hoisted(() => ({ calls: [] }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: async (url, init) => {
    outbound.calls.push({ url: String(url), init });
    return Response.json({ access_token: "refreshed", expires_in: 3600 });
  }
}));
let route;
async function post(action, body) {
  return route.POST(new Request(`https://dashboard.example/api/oauth/antigravity/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  }), { params: Promise.resolve({ provider: "antigravity", action }) });
}
async function load(custom) {
  vi.resetModules();
  delete process.env.ANTIGRAVITY_OAUTH_CLIENT_ID;
  delete process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
  Object.assign(process.env, custom || {});
  route = await import("@/app/api/oauth/[provider]/[action]/route.js");
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    outbound.calls.push({ url: String(url), init });
    if (String(url).includes("/token")) return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
    if (String(url).includes("userinfo")) return Response.json({ email: "default@example.test", sub: "subject" });
    if (String(url).includes(":loadCodeAssist")) return Response.json({ cloudaicompanionProject: "project" });
    throw new Error(`Unexpected network: ${url}`);
  }));
}
beforeEach(() => {
  process.env.DATA_DIR = path.join(dir, String(Math.random()));
  outbound.calls.length = 0;
});
afterAll(() => {
  vi.unstubAllGlobals();
  process.env = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("public Antigravity desktop OAuth profile (closed network)", () => {
  it("accepts the desktop callback path on the CLI loopback listener", async () => {
    await load();
    const { startLocalServer } = await import("@/lib/oauth/utils/server.js");
    let callback;
    const listener = await startLocalServer(params => { callback = params; });
    try {
      const status = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${listener.port}/oauth-callback?code=local-code&state=local-state`, res => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        }).on("error", reject);
      });
      expect(status).toBe(200);
      expect(callback).toEqual({ code: "local-code", state: "local-state" });
    } finally {
      listener.close();
    }
  });
  it.each(["http://localhost:8080/callback", "https://dashboard.example/callback"])("authorizes and exchanges from %s with the pinned callback", async (requested) => {
    await load();
    const response = await post("authorize", { redirectUri: requested, proxyMode: "direct" });
    expect(response.status).toBe(200);
    const flow = await response.json();
    const params = new URL(flow.authUrl).searchParams;
    expect(params.get("client_id")).toBe(publicId);
    expect(params.get("redirect_uri")).toBe(redirect);
    expect(params.get("scope").split(" ")).toHaveLength(6);
    expect(params.get("scope")).toContain("https://www.googleapis.com/auth/aicode");
    expect(params.get("state")).toBe(flow.state);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(JSON.stringify(flow)).not.toContain("clientSecret");
    expect(JSON.stringify(flow)).not.toContain("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");
    const wrong = await post("exchange", { flowId: flow.flowId, state: "wrong", code: "code" });
    expect(wrong.status).not.toBe(200);
    expect(outbound.calls).toHaveLength(0);
    const result = await post("exchange", { flowId: flow.flowId, state: flow.state, code: "code" });
    expect(result.status).toBe(200);
    const token = outbound.calls.find(c => c.url.includes("/token"));
    expect(token.init.body.get("redirect_uri")).toBe(redirect);
    expect(token.init.body.get("client_id")).toBe(publicId);
    expect(createHash("sha256").update(token.init.body.get("code_verifier")).digest("base64url")).toBe(params.get("code_challenge"));
    const db = await import("@/lib/localDb");
    const rows = await db.getProviderConnections({ provider: "antigravity" });
    expect(rows[0].providerSpecificData.oauthClientBinding).toBe(`v1:${createHash("sha256").update(publicId).digest("hex")}`);
    const { refreshGoogleTokenDetailed } = await import("../../open-sse/services/tokenRefresh/providers.js");
    const shared = await import("../../open-sse/providers/shared.js");
    expect((await refreshGoogleTokenDetailed("synthetic-refresh", shared.ANTIGRAVITY_OAUTH_CLIENT.clientId, shared.ANTIGRAVITY_OAUTH_CLIENT.clientSecret)).ok).toBe(true);
    expect(outbound.calls.at(-1).init.body.get("client_id")).toBe(publicId);
    // A fresh consent flow replaces the issuing-client marker on reauthorization.
    await db.updateProviderConnection(rows[0].id, { providerSpecificData: { oauthClientBinding: "v1:previous-client" } });
    const reauth = await (await post("authorize", { redirectUri: requested, proxyMode: "direct", connectionId: rows[0].id })).json();
    expect(new URL(reauth.authUrl).searchParams.get("prompt")).toBe("consent");
    expect((await post("exchange", { flowId: reauth.flowId, state: reauth.state, code: "new-code" })).status).toBe(200);
    expect((await db.getProviderConnectionById(rows[0].id)).providerSpecificData.oauthClientBinding).toBe(rows[0].providerSpecificData.oauthClientBinding);
  });

  it("retains custom redirects, scopes, exchange credentials and hides the custom secret", async () => {
    await load({ ANTIGRAVITY_OAUTH_CLIENT_ID: "custom-client", ANTIGRAVITY_OAUTH_CLIENT_SECRET: "custom-secret" });
    const flow = await (await post("authorize", { redirectUri: "https://registered.example/callback", proxyMode: "direct" })).json();
    const params = new URL(flow.authUrl).searchParams;
    expect(params.get("redirect_uri")).toBe("https://registered.example/callback");
    expect(params.get("scope").split(" ")).toHaveLength(5);
    expect(JSON.stringify(flow)).not.toContain("custom-secret");
    expect((await post("exchange", { flowId: flow.flowId, state: flow.state, code: "code" })).status).toBe(200);
    const body = outbound.calls[0].init.body;
    expect(body.get("client_id")).toBe("custom-client");
    expect(body.get("client_secret")).toBe("custom-secret");
    expect(body.get("redirect_uri")).toBe(params.get("redirect_uri"));
  });

  it.each([
    { ANTIGRAVITY_OAUTH_CLIENT_ID: "", ANTIGRAVITY_OAUTH_CLIENT_SECRET: "" },
    { ANTIGRAVITY_OAUTH_CLIENT_ID: "" },
    { ANTIGRAVITY_OAUTH_CLIENT_SECRET: "" },
    { ANTIGRAVITY_OAUTH_CLIENT_ID: "custom" },
    { ANTIGRAVITY_OAUTH_CLIENT_SECRET: "custom" },
    { ANTIGRAVITY_OAUTH_CLIENT_ID: " ", ANTIGRAVITY_OAUTH_CLIENT_SECRET: "secret" }
  ])("rejects explicit blank/incomplete overrides %j before network", async custom => {
    await load(custom);
    const response = await post("authorize", { proxyMode: "direct" });
    expect(response.status).not.toBe(200);
    expect((await response.json()).error).toContain("ANTIGRAVITY_OAUTH_CLIENT");
    expect(outbound.calls).toHaveLength(0);
    const { antigravityClientBindingBlocks } = await import("../../open-sse/services/antigravityClientBinding.js");
    expect(() => antigravityClientBindingBlocks("antigravity", {})).toThrow("unset both");
  });

  it("blocks client switches, resumes after reverting, and leaves legacy unmarked", async () => {
    await load();
    const binding = await import("../../open-sse/services/antigravityClientBinding.js");
    const marked = binding.withClientBinding({}, publicId);
    expect(binding.antigravityClientBindingBlocks("antigravity", marked)).toBe(false);
    await load({ ANTIGRAVITY_OAUTH_CLIENT_ID: "custom", ANTIGRAVITY_OAUTH_CLIENT_SECRET: "secret" });
    const custom = await import("../../open-sse/services/antigravityClientBinding.js");
    expect(custom.antigravityClientBindingBlocks("antigravity", marked)).toBe(true);
    expect(custom.antigravityClientBindingBlocks("antigravity", {})).toBe(false);
    expect(marked).toEqual(binding.withClientBinding({}, publicId));
    await load();
    expect((await import("../../open-sse/services/antigravityClientBinding.js")).antigravityClientBindingBlocks("antigravity", marked)).toBe(false);
  });
});
