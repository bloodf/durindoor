import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("../../open-sse/providers/registry/index.js", async (original) => {
  const actual = await original();
  const { default: entry } = await import("../../open-sse/providers/private/blackbox-web.js");
  return { ...actual, default: [...actual.default, entry] };
});
vi.mock("../../open-sse/executors/index.js", async (original) => {
  const actual = await original();
  const { BlackboxWebExecutor } = await import("../../open-sse/executors/blackbox-web.js");
  const executor = new BlackboxWebExecutor();
  return { ...actual, getExecutor: (id) => id === "blackbox-web" || id === "bb-web" ? executor : actual.getExecutor(id) };
});
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { blackboxWebCookieProfile } from "../../open-sse/providers/private/blackbox-web.js";
import { BlackboxWebExecutor } from "../../open-sse/executors/blackbox-web.js";
import { getCookieImportContract, buildImportedCookieHeader } from "../../src/lib/providers/cookieImport/contract.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";

const COOKIE = "next-auth.session-token=synthetic-session";
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
afterEach(() => { vi.restoreAllMocks(); });

describe("Blackbox Web staged provider", () => {
  it("publishes its static model catalog and cookie profile", () => {
    expect(REGISTRY.find((x) => x.id === "blackbox-web").models.map((x) => x.id)).toContain("gpt-4-turbo");
    expect(PROVIDERS["blackbox-web"]).toMatchObject({ baseUrl: "https://app.blackbox.ai/api/chat", executor: "blackbox-web", authType: "cookie" });
    expect(blackboxWebCookieProfile.cookieNames).toEqual(["next-auth.session-token"]);
    expect(getCookieImportContract("blackbox-web")).toMatchObject({ origin: "https://app.blackbox.ai", cookieNames: ["next-auth.session-token"] });
    expect(buildImportedCookieHeader(getCookieImportContract("blackbox-web"), [{ name: "next-auth.session-token", value: "synthetic", domain: "app.blackbox.ai" }])).toMatchObject({ ok: true, header: "next-auth.session-token=synthetic" });
  });
  it("discovers the staged catalog for a saved connection", async () => {
    expect(getProviderModels("blackbox-web").map((x) => x.id)).toContain("gpt-4-turbo");
  });
  it("validates good and expired sessions with the declared probe", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ user: { email: "synthetic@example.invalid" } })).mockResolvedValueOnce(json({ error: "expired" }, 401));
    expect(await probeRegistryProvider("blackbox-web", COOKIE, fetcher)).toMatchObject({ valid: true, status: 200 });
    expect(await probeRegistryProvider("blackbox-web", COOKIE, fetcher)).toMatchObject({ valid: false, status: 401 });
    expect(fetcher.mock.calls[0][0]).toBe(blackboxWebCookieProfile.validationProbe.url);
  });
  it.each([["/v1/chat/completions", FORMATS.OPENAI], ["/v1/messages", FORMATS.CLAUDE]])("routes JSON and streamed turns through %s", async (endpoint, format) => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push([String(url), init]);
      if (String(url).endsWith("/api/auth/session")) return json({ user: { email: "synthetic@example.invalid" } });
      if (String(url).endsWith("/api/check-subscription")) return json({ hasActiveSubscription: true });
      if (String(url).endsWith("/api/chat")) return new Response("Blackbox says hello", { status: 200 });
      throw new Error(`unexpected mocked URL ${url}`);
    });
    try {
      for (const stream of [false, true]) {
        const body = endpoint === "/v1/messages" ? { model: "blackbox-web/gpt-4", max_tokens: 40, messages: [{ role: "user", content: "hi" }], stream } : { model: "blackbox-web/gpt-4", messages: [{ role: "user", content: "hi" }], stream };
        const result = await handleChatCore({ body, modelInfo: { provider: "blackbox-web", model: "gpt-4" }, credentials: { id: "bb-test", apiKey: COOKIE, authType: "cookie" }, clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: format, connectionId: "bb-test", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
        expect(result.response.status).toBe(200);
        expect(await result.response.text()).toContain("Blackbox says hello");
      }
      expect(calls.filter(([url]) => url.endsWith("/api/chat"))).toHaveLength(2);
      expect(calls.at(-1)[1].headers.Cookie).toContain(COOKIE);
    } finally { globalThis.fetch = original; }
  });
  it("maps 429 and preserves isolation between two cookie connections", async () => {
    const executor = new BlackboxWebExecutor(), original = globalThis.fetch;
    const cookies = [];
    let expire = false;
    globalThis.fetch = vi.fn(async (url, init = {}) => { cookies.push(init.headers?.Cookie); if (String(url).endsWith("/api/auth/session")) return expire ? json({}, 401) : json({ user: { email: "synthetic@example.invalid" } }); if (String(url).endsWith("/api/check-subscription")) return json({ hasActiveSubscription: true }); return json({ error: "limited" }, 429); });
    try {
      for (const key of ["next-auth.session-token=account-a", "next-auth.session-token=account-b"]) {
        const r = await executor.execute({ model: "gpt-4", body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: key } });
        expect(r.response.status).toBe(429);
      }
      expire = true;
      const expired = await executor.execute({ model: "gpt-4", body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: "next-auth.session-token=expired" } });
      expect(expired.response.status).toBe(401);
      expect(cookies).toContain("next-auth.session-token=account-a"); expect(cookies).toContain("next-auth.session-token=account-b");
    } finally { globalThis.fetch = original; }
  });
});
