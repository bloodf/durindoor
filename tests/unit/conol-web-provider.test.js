import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { conolWebCookieProfile } from "../../open-sse/providers/registry/conol-web.js";
import { ConolWebExecutor } from "../../open-sse/executors/conol-web.js";
import { getCookieImportContract, buildImportedCookieHeader } from "../../src/lib/providers/cookieImport/contract.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";

const COOKIE = "__Secure-better-auth.session_token=synthetic-session";
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const delta = (text) => `${JSON.stringify({ type: "history_delta", stages: [{ logs: [{ role: "assistant", content: [{ type: "text", text }] }] }] })}\n${JSON.stringify({ type: "done" })}\n`;
afterEach(() => vi.restoreAllMocks());

describe("Conol Web staged provider", () => {
  it("publishes the pinned fallback models and cookie profile", () => {
    expect(REGISTRY.find((x) => x.id === "conol-web").models.map((x) => x.id)).toContain("claude-fable-5");
    expect(PROVIDERS["conol-web"]).toMatchObject({ baseUrl: "https://conol.ai/api/sessions", executor: "conol-web", authType: "cookie" });
    expect(conolWebCookieProfile.cookieNames).toEqual(["__Secure-better-auth.session_token"]);
    expect(getCookieImportContract("conol-web")).toMatchObject({ origin: "https://conol.ai", cookieNames: ["__Secure-better-auth.session_token"] });
    expect(buildImportedCookieHeader(getCookieImportContract("conol-web"), [{ name: "__Secure-better-auth.session_token", value: "synthetic", domain: "conol.ai" }])).toMatchObject({ ok: true, header: "__Secure-better-auth.session_token=synthetic" });
  });
  it("discovers the staged fallback catalog for a saved connection", async () => {
    expect(getProviderModels("conol-web").map((x) => x.id)).toContain("claude-fable-5");
  });
  it("validates good and rejected sessions with the authenticated catalog probe", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ servers: [] })).mockResolvedValueOnce(json({ error: "expired" }, 401));
    expect(await probeRegistryProvider("conol-web", COOKIE, fetcher)).toMatchObject({ valid: true, status: 200 });
    expect(await probeRegistryProvider("conol-web", COOKIE, fetcher)).toMatchObject({ valid: false, status: 401 });
    expect(fetcher.mock.calls[0][0]).toBe(conolWebCookieProfile.validationProbe.url);
  });
  it.each([["/v1/chat/completions", FORMATS.OPENAI], ["/v1/messages", FORMATS.CLAUDE]])("routes JSON and streamed turns through %s", async (endpoint, format) => {
    const original = globalThis.fetch, calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url); calls.push([u, init]);
      if (u.endsWith("/api/sessions") && init.method === "POST") return json({ sessionId: `session-${calls.length}` }, 201);
      if (u.endsWith("/model")) return json({ ok: true });
      if (u.includes("/messages?logDeltas=1")) return new Response(delta("Conol says hello"), { status: 200 });
      if (u.endsWith("/messages")) return new Response(null, { status: 202 });
      if (u.endsWith("/api/agent-servers")) return json({ servers: [] });
      throw new Error(`unexpected mocked URL ${u}`);
    });
    try {
      for (const stream of [false, true]) {
        const body = { model: "conol-web/claude-fable-5", messages: [{ role: "user", content: "hi" }], stream, ...(endpoint === "/v1/messages" ? { max_tokens: 50 } : {}) };
        const result = await handleChatCore({ body, modelInfo: { provider: "conol-web", model: "claude-fable-5" }, credentials: { id: "conol-test", apiKey: COOKIE, authType: "cookie" }, clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: format, connectionId: "conol-test", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
        expect(result.response.status).toBe(200);
        expect(await result.response.text()).toContain("Conol says hello");
      }
      expect(calls.filter(([url]) => url.endsWith("/api/sessions"))).toHaveLength(2);
      expect(calls.some(([, init]) => init.headers?.Cookie === COOKIE)).toBe(true);
    } finally { globalThis.fetch = original; }
  });
  it("maps expiry and 429 while keeping two connection cookies isolated", async () => {
    const executor = new ConolWebExecutor(), original = globalThis.fetch, seen = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => { const u=String(url); seen.push(init.headers?.Cookie); if(u.endsWith("/api/sessions")) return json({sessionId:"s"},201); if(u.endsWith("/model")) return json({}); if(u.endsWith("/messages")) return json({},429); return json({},401); });
    try {
      for (const key of ["__Secure-better-auth.session_token=account-a", "__Secure-better-auth.session_token=account-b"]) { const r=await executor.execute({model:"claude-fable-5",body:{messages:[{role:"user",content:"hi"}]},credentials:{apiKey:key}}); expect(r.response.status).toBe(429); }
      globalThis.fetch.mockImplementation(async () => json({},401));
      expect((await executor.execute({model:"claude-fable-5",body:{messages:[{role:"user",content:"hi"}]},credentials:{apiKey:COOKIE}})).response.status).toBe(401);
      expect(seen).toContain("__Secure-better-auth.session_token=account-a"); expect(seen).toContain("__Secure-better-auth.session_token=account-b");
    } finally { globalThis.fetch = original; }
  });
});

// Registration batch C (#2034): the registry and executor map are no longer composed by this file.
describe("Conol Web production registration", () => {
  it("is served by the unmocked production registry and executor map", async () => {
    const { default: registry } = await import("../../open-sse/providers/registry/index.js");
    const { getExecutor, hasSpecializedExecutor } = await import("../../open-sse/executors/index.js");
    const { ConolWebExecutor } = await import("../../open-sse/executors/conol-web.js");
    expect(registry.filter((entry) => entry.id === "conol-web")).toHaveLength(1);
    expect(hasSpecializedExecutor("conol-web")).toBe(true);
    expect(getExecutor("conol-web")).toBeInstanceOf(ConolWebExecutor);
    expect(getExecutor("cnl")).toBe(getExecutor("conol-web"));
  });
});
