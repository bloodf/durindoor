/**
 * Scope (#1162, chatgpt-web vs installed codex): offline identity/transport acceptance.
 * `chatgpt-web` is a cookie-session provider (browser or backend-api conversation HTTP);
 * `codex` is the OAuth Responses provider. They are NOT the same identity. Everything here
 * runs against mocked fetch; registry exports prove metadata only. Live account-backed
 * verification is UNAVAILABLE here, so no test claims real upstream support.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The registry imports Kimchi's updater, whose native import bypasses fetch mocks.
// Replace the whole module before any runtime imports; loader failure is not isolation.
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-test",
  updateKimchiUserAgent: vi.fn(async () => "kimchi/offline-test"),
}));

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (orig) => ({
  ...(await orig()),
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

const { default: chatgptWeb } = await import("../../open-sse/providers/registry/chatgpt-web.js");
const { default: codex } = await import("../../open-sse/providers/registry/codex.js");
const { getExecutor } = await import("../../open-sse/executors/index.js");
const { ChatGptWebExecutor } = await import("../../open-sse/executors/chatgpt-web.js");
const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
const { getCodexModels } = await import("../../open-sse/services/usage/codex.js");
const { ChatGptWebHttpExecutor, __resetChatGptWebCachesForTesting } =
  await import("../../open-sse/executors/chatgpt-web-http.js");
const { __setTlsFetchOverrideForTesting } = await import("../../open-sse/services/chatgptTlsClient.js");
const { probeRegistryProvider } = await import("../../src/app/api/providers/providerProbe.js");

const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

function installChatGptTls(handlers = {}) {
  const urls = [];
  const bodies = [];
  const headers = [];
  __setTlsFetchOverrideForTesting(async (url, opts = {}) => {
    const u = String(url);
    urls.push(u);
    bodies.push(opts.body);
    headers.push(new Headers(opts.headers));
    const h = new Headers({ "Content-Type": "application/json" });
    if (u.includes("/api/auth/session")) {
      return { status: 200, headers: h, body: null, text: JSON.stringify({ accessToken: "jwt", user: { id: "u1" } }) };
    }
    if (u.includes("/sentinel/chat-requirements")) {
      return { status: 200, headers: h, body: null, text: JSON.stringify({ token: "t", proofofwork: { required: false } }) };
    }
    if (u.includes("/backend-api/f/conversation") || u.endsWith("/backend-api/conversation")) {
      if (handlers.conv) return handlers.conv(h);
      const msg = (status) => ({
        conversation_id: "c1",
        message: { id: "m1", author: { role: "assistant" }, content: { content_type: "text", parts: ["pong"] }, status },
      });
      const sse = [msg("in_progress"), msg("finished_successfully")]
        .map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n";
      return { status: 200, headers: new Headers({ "Content-Type": "text/event-stream" }), body: null, text: sse };
    }
    return { status: 200, headers: h, body: null, text: "<html></html>" };
  });
  return { urls, bodies, headers };
}

describe("#1162 identity: chatgpt-web is not codex", () => {
  it("registry metadata differs in auth, format and endpoint (metadata only, not runtime proof)", () => {
    expect(chatgptWeb.authType).toBe("cookie");
    expect(codex.category).toBe("oauth");
    expect(chatgptWeb.transport.format).toBe("openai");
    expect(codex.transport.format).toBe("openai-responses");
    expect(chatgptWeb.transport.baseUrl).not.toContain("/codex/");
    expect(codex.transport.baseUrl).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(chatgptWeb.models.map((m) => m.id)).not.toEqual(expect.arrayContaining(codex.models.map((m) => m.id)));
  });

  it("dispatches to distinct executor classes, never the alias of the other", () => {
    expect(getExecutor("chatgpt-web")).toBeInstanceOf(ChatGptWebExecutor);
    expect(getExecutor("cgpt-web")).toBeInstanceOf(ChatGptWebExecutor);
    expect(getExecutor("codex")).toBeInstanceOf(CodexExecutor);
    expect(getExecutor("codex")).not.toBeInstanceOf(ChatGptWebExecutor);
  });

  it("keeps unsupported capabilities hidden: no image kind, no model discovery URL", () => {
    expect(chatgptWeb.hiddenKinds).toContain("image");
    expect(chatgptWeb.serviceKinds).toEqual(["llm"]);
    expect(chatgptWeb.transport.modelsUrl).toBeUndefined();
  });
});

describe("#1162 auth/validator", () => {
  it("cookie session validator hits /api/auth/session with Cookie, never a codex endpoint", async () => {
    const calls = [];
    const fetcher = async (url, init) => (calls.push({ url: String(url), init }), json({ accessToken: "at" }));
    const ok = await probeRegistryProvider("chatgpt-web", "__Secure-next-auth.session-token=abc", fetcher);
    expect(ok).toMatchObject({ valid: true });
    expect(calls[0].url).toBe("https://chatgpt.com/api/auth/session");
    expect(calls[0].init.headers.Cookie).toContain("abc");
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(calls.some((c) => c.url.includes("/codex"))).toBe(false);
  });

  it("rejects an empty 200 session response as expired or incomplete, not a credential-type check", async () => {
    const fetcher = vi.fn(async () => json({}));
    const bad = await probeRegistryProvider("chatgpt-web", "__Secure-next-auth.session-token=expired", fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(bad).toMatchObject({ valid: false, status: 200 });
    expect(bad.error).toContain("Session expired or incomplete");
  });
});

describe("#1162 executor transports (mocked)", () => {
  beforeEach(() => {
    mocks.proxyAwareFetch.mockReset();
    __resetChatGptWebCachesForTesting();
  });

  it("chatgpt-web http rejects missing messages with 400 before any fetch", async () => {
    const tlsFetch = vi.fn(() => { throw new Error("Unexpected TLS fetch"); });
    __setTlsFetchOverrideForTesting(tlsFetch);
    try {
      const r = await new ChatGptWebHttpExecutor().execute({
        model: "gpt-5-6",
        body: {},
        stream: false,
        credentials: { apiKey: "cookie-val" },
      });
      expect(r.response.status).toBe(400);
      expect((await r.response.json()).error.message).toBe("Missing or empty messages array");
      expect(tlsFetch).not.toHaveBeenCalled();
      expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    } finally {
      __setTlsFetchOverrideForTesting(null);
    }
  });

  it("chatgpt-web http rejects a credential object without a cookie with 401 before any fetch", async () => {
    const tlsFetch = vi.fn(() => { throw new Error("Unexpected TLS fetch"); });
    __setTlsFetchOverrideForTesting(tlsFetch);
    try {
      // Production callers supply an object; null/undefined are unsupported direct-seam misuse.
      const r = await new ChatGptWebHttpExecutor().execute({
        model: "gpt-5-6",
        body: { messages: [{ role: "user", content: "ping" }] },
        stream: false,
        credentials: {},
      });
      expect(r.response.status).toBe(401);
      expect((await r.response.json()).error.message).toContain("session-token cookie value");
      expect(tlsFetch).not.toHaveBeenCalled();
      expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    } finally {
      __setTlsFetchOverrideForTesting(null);
    }
  });

  it("chatgpt-web http: cookie → session → sentinel → backend-api conversation, no codex endpoint, no Responses body", async () => {
    const m = installChatGptTls();
    try {
      const r = await new ChatGptWebHttpExecutor().execute({
        model: "gpt-5-6",
        body: { messages: [{ role: "user", content: "ping" }] },
        stream: false,
        credentials: { apiKey: "cookie-val" },
        signal: AbortSignal.timeout(10_000),
        log: null,
      });
      expect(r.response.status).toBe(200);
      expect((await r.response.json()).choices[0].message.content).toBe("pong");
      expect(m.urls.some((u) => u.includes("/backend-api/f/conversation"))).toBe(true);
      expect(m.urls.some((u) => u.includes("/backend-api/codex"))).toBe(false);
      const sessionIndex = m.urls.indexOf("https://chatgpt.com/api/auth/session");
      expect(sessionIndex).toBeGreaterThanOrEqual(0);
      expect(m.headers[sessionIndex].get("Cookie")).toBe("__Secure-next-auth.session-token=cookie-val");
      const conversationIndex = m.urls.findIndex((u) => u.includes("/backend-api/f/conversation"));
      expect(m.headers[conversationIndex].get("Cookie")).toBe("__Secure-next-auth.session-token=cookie-val");
      expect(m.headers[conversationIndex].get("Authorization")).toBe("Bearer jwt");
      const conv = JSON.parse(m.bodies[conversationIndex]);
      expect(conv).toHaveProperty("messages");
      expect(conv).not.toHaveProperty("input");
    } finally {
      __setTlsFetchOverrideForTesting(null);
    }
  });

  it("chatgpt-web http streaming ends with [DONE]; upstream 429 maps to 429", async () => {
    let m = installChatGptTls();
    try {
      const r = await new ChatGptWebHttpExecutor().execute({
        model: "gpt-5-6",
        body: { messages: [{ role: "user", content: "ping" }] },
        stream: true,
        credentials: { apiKey: "cookie-val" },
        signal: AbortSignal.timeout(10_000),
        log: null,
      });
      const text = await r.response.text();
      expect(text).toContain("pong");
      expect(text.trim().endsWith("data: [DONE]")).toBe(true);

      __resetChatGptWebCachesForTesting();
      m = installChatGptTls({
        conv: (h) => ({ status: 429, headers: h, body: null, text: JSON.stringify({ detail: "Too many requests" }) }),
      });
      const limited = await new ChatGptWebHttpExecutor().execute({
        model: "gpt-5-6",
        body: { messages: [{ role: "user", content: "ping" }] },
        stream: false,
        credentials: { apiKey: "cookie-val" },
        signal: AbortSignal.timeout(10_000),
        log: null,
      });
      expect(limited.response.status).toBe(429);
    } finally {
      __setTlsFetchOverrideForTesting(null);
    }
  });

  it("chatgpt-web auto transport sends tool requests through HTTP emulation, not the browser", async () => {
    const httpExecutor = { execute: vi.fn(async () => ({ response: new Response("http") })) };
    const runBrowser = vi.fn(async () => new Response("browser"));
    const ex = new ChatGptWebExecutor({ httpExecutor, runBrowser });
    await ex.execute({
      model: "gpt-5-6",
      body: { messages: [{ role: "user", content: "x" }], tools: [{ type: "function", function: { name: "f" } }] },
      credentials: { apiKey: "c", providerSpecificData: {} },
    });
    expect(httpExecutor.execute).toHaveBeenCalledOnce();
    expect(runBrowser).not.toHaveBeenCalled();
  });

  it("codex executor: Bearer OAuth to the Responses URL, never the cookie/conversation path", async () => {
    mocks.proxyAwareFetch.mockImplementation(async () => new Response(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));
    const r = await new CodexExecutor().execute({
      model: "gpt-5.5",
      body: { model: "gpt-5.5", input: [{ role: "user", content: "ping" }] },
      stream: true,
      credentials: { accessToken: "oauth-at", providerSpecificData: { workspaceId: "ws1" } },
    });
    await r.response.text();
    const [url, init] = mocks.proxyAwareFetch.mock.calls[0];
    expect(String(url)).toContain("/backend-api/codex/responses");
    expect(init.headers.Authorization).toBe("Bearer oauth-at");
    expect(init.headers.Cookie).toBeUndefined();
    expect(JSON.parse(init.body)).toHaveProperty("input");
  });
});

describe("#1162 model discovery", () => {
  beforeEach(() => mocks.proxyAwareFetch.mockReset());

  it("codex discovers its live catalog with a token; empty without one", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(json({ models: [{ slug: "gpt-5.5", priority: 1 }] }));
    expect((await getCodexModels("at", null, {})).map((x) => x.slug)).toEqual(["gpt-5.5"]);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledOnce();
    const [url, init] = mocks.proxyAwareFetch.mock.calls[0];
    const modelsUrl = new URL(url);
    expect(`${modelsUrl.origin}${modelsUrl.pathname}`).toBe("https://chatgpt.com/backend-api/codex/models");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer at");
    mocks.proxyAwareFetch.mockClear();
    expect(await getCodexModels("", null, {})).toEqual([]);
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });
});
