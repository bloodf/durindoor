import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
const mocks = vi.hoisted(() => ({ create: vi.fn(), transport: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.transport }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: mocks.create, getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(), getProxyPoolById: vi.fn() }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
import { clearOAuthFlowsForTests } from "@/lib/oauth/flowStore.js";
import { GET, POST } from "../../src/app/api/oauth/[provider]/[action]/route.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { discoverOrcaRouterModels } from "../../open-sse/providers/orcarouterCatalog.js";
const params = (action) => ({ params: Promise.resolve({ provider: "orcarouter", action }) });
const post = (action, body) => POST(new Request(`http://localhost/api/oauth/orcarouter/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params(action));
const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
beforeEach(() => {
  clearOAuthFlowsForTests();
  mocks.create.mockReset().mockImplementation(async (data, options) => { expect(options.shouldCommit()).toBe(true); return { id: `connection-${data.providerSpecificData.userId}`, ...data }; });
  mocks.transport.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected outbound fetch"); }));
});
afterEach(() => { clearOAuthFlowsForTests(); vi.unstubAllGlobals(); });
describe("OrcaRouter sign-in and request contract", () => {
  it("binds each code to its server-side PKCE flow and keeps account credentials separate", async () => {
    const start = async () => (await GET(new Request("http://localhost/api/oauth/orcarouter/authorize?redirect_uri=oob"), params("authorize"))).json();
    const first = await start();
    const second = await start();
    const url = new URL(first.authUrl);
    expect(url.searchParams.get("callback_url")).toBe("oob");
    expect(url.searchParams.get("state")).toBe(first.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(first).not.toHaveProperty("codeVerifier");
    expect((await post("exchange", { code: "fake-code", flowId: first.flowId, state: second.state })).status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    globalThis.fetch.mockImplementation(async (target, init) => {
      expect(target).toBe("https://www.orcarouter.ai/api/v1/auth/keys");
      const body = JSON.parse(init.body);
      const auth = body.code === "first-code" ? first : second;
      expect(crypto.createHash("sha256").update(body.code_verifier).digest("base64url")).toBe(new URL(auth.authUrl).searchParams.get("code_challenge"));
      expect(body.code_challenge_method).toBe("S256");
      return json({ key: `sk-orca-${body.code}`, user_id: body.code, scope: "api" });
    });
    for (const [flow, code] of [[first, "first-code"], [second, "second-code"]]) {
      const response = await post("exchange", { code, state: flow.state, flowId: flow.flowId, codeVerifier: "untrusted" });
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain(`sk-orca-${code}`);
    }
    expect(mocks.create.mock.calls.map(([data]) => [data.providerSpecificData.userId, data.apiKey])).toEqual([["first-code", "sk-orca-first-code"], ["second-code", "sk-orca-second-code"]]);
    expect((await post("exchange", { code: "first-code", state: first.state, flowId: first.flowId })).status).toBe(410);
  });
  it("uses the selected account key for capability discovery and execution", async () => {
    const catalog = vi.fn().mockResolvedValue(json({ data: [{ id: "orcarouter/auto", supported_endpoint_types: ["openai"] }] }));
    const result = await discoverOrcaRouterModels({ apiKey: "sk-orca-account-a", fetchImpl: catalog });
    expect(result.models[0].id).toBe("orcarouter/auto");
    expect(catalog.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-orca-account-a");
    mocks.transport.mockResolvedValue(json({ choices: [] }));
    await getExecutor("orcarouter").execute({ model: result.models[0].id, body: { model: result.models[0].id, messages: [] }, stream: false, credentials: { apiKey: "sk-orca-account-b" } });
    expect(mocks.transport.mock.calls[0][0]).toBe("https://api.orcarouter.ai/v1/chat/completions");
    expect(mocks.transport.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-orca-account-b");
    expect(JSON.parse(mocks.transport.mock.calls[0][1].body).model).toBe("orcarouter/auto");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
