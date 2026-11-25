import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatGptWebCodexExecutor } from "../../open-sse/executors/chatgpt-web-codex.js";
import { ChatGptWebExecutor } from "../../open-sse/executors/chatgpt-web.js";
import { LmarenaExecutor } from "../../open-sse/executors/lmarena.js";
import { __setTlsFetchOverrideForTesting as setChat, tlsFetchChatGpt } from "../../open-sse/services/chatgptTlsClient.js";
import { __setTlsFetchOverrideForTesting as setArena } from "../../open-sse/services/lmarenaTlsClient.js";
import { __resetChatGptWebCachesForTesting } from "../../open-sse/executors/chatgpt-web-http.js";
import { PlaywrightChatGptWebBrowserSession } from "../../open-sse/utils/chatgptWebBrowserSession.js";
const body = { messages: [{ role: "user", content: "hello" }] };
const result = (status, text = "", headers = {}) => ({ status, text, headers: new Headers(headers), body: null });
const chatInput = { model: "instant", body, stream: false, credentials: { apiKey: "fixture", providerSpecificData: { transport: "http" } } };
const arenaInput = { model: "test", body, stream: false, credentials: { apiKey: "fixture" } };
const chatSse = 'data: {"message":{"id":"m","author":{"role":"assistant"},"content":{"content_type":"text","parts":["hello"]},"status":"finished_successfully"}}\n\ndata: [DONE]\n\n';
afterEach(() => { setChat(null); setArena(null); __resetChatGptWebCachesForTesting(); });
describe.each([
  ["ChatGPT Web Codex", setChat, () => new ChatGptWebCodexExecutor(), chatInput, "/backend-api/f/conversation"],
  ["LMArena", setArena, () => new LmarenaExecutor(), arenaInput, "/nextjs-api/stream/create-evaluation"],
])("%s shared TLS redirects", (name, install, executor, input, chatPath) => {
  it.each([[false, false], [true, false], [false, true], [true, true]])("handles same-origin redirect: %s (stream: %s)", async (sameOrigin, stream) => {
    const calls = [];
    install(async (url, options) => {
      calls.push({ url, options });
      const path = new URL(url).pathname;
      if (path === chatPath) return result(302, "", { location: sameOrigin ? "/redirected" : "https://other.invalid/collect" });
      if (path === "/redirected") return result(200, name === "LMArena" ? 'data: {"text":"hello"}\n' : chatSse);
      if (path === "/api/auth/session") return result(200, '{"accessToken":"fixture"}');
      if (path.includes("chat-requirements")) return result(200, '{"token":"fixture"}');
      return result(200, "<html></html>");
    });
    const { response } = await executor().execute({ ...input, stream });
    expect(response.status).toBe(sameOrigin ? 200 : 401);
    if (!sameOrigin) expect(await response.text()).toMatch(/session|auth|credential/i);
    const chatCalls = calls.filter(({ url }) => [chatPath, "/redirected"].includes(new URL(url).pathname) || new URL(url).hostname === "other.invalid");
    expect(chatCalls.map(({ url }) => new URL(url).pathname)).toEqual(sameOrigin ? [chatPath, "/redirected"] : [chatPath]);
    expect(chatCalls.every(({ options }) => options.redirect === "manual")).toBe(true);
  });
});
it("leaves ordinary ChatGPT Web TLS calls at their default redirect behavior", async () => {
  const wire = vi.fn(async () => result(302, "", { location: "https://other.invalid/" }));
  setChat(wire);
  expect((await tlsFetchChatGpt("https://chatgpt.com/test")).status).toBe(302);
  expect(wire).toHaveBeenCalledTimes(1);
  expect(wire.mock.calls[0][1].redirect).toBeUndefined();
});
it("guards ordinary ChatGPT Web TLS sends that carry the session cookie", async () => {
  const wire = vi.fn(async () => result(302, "", { location: "https://other.invalid/collect" }));
  setChat(wire);
  await new ChatGptWebExecutor().execute(chatInput);
  expect(wire.mock.calls[0][1]).toMatchObject({ sameOriginRedirects: true, redirect: "manual" });
  expect(wire.mock.calls.some(([url]) => new URL(url).hostname === "other.invalid")).toBe(false);
});
describe("ChatGPT Web Codex browser redirects", () => {
  it.each([false, true])("intercepts same-origin redirect: %s", async (sameOrigin) => {
    let paused;
    const send = vi.fn(async () => {});
    const cdp = { on: (_name, handler) => { paused = handler; }, send, detach: vi.fn(async () => {}) };
    const page = { url: () => "https://chatgpt.com/", context: () => ({ newCDPSession: async () => cdp }), close: vi.fn() };
    const session = new PlaywrightChatGptWebBrowserSession(page, {
      sameOriginRedirects: true, selection: {},
      executePageRequest: async () => {
        await paused({ request: { url: "https://chatgpt.com/backend-api/f/conversation" }, requestId: "chat", responseStatusCode: 302, responseHeaders: [{ name: "location", value: sameOrigin ? "/next" : "https://other.invalid/" }] });
        return "done";
      },
    });
    const cleanup = await session.start({});
    if (sameOrigin) await expect(session.submitPrompt({ prompt: "hello" })).resolves.toBe("done");
    else await expect(session.submitPrompt({ prompt: "hello" })).rejects.toThrow(/session cookie/i);
    expect(send.mock.calls[1][0]).toBe(sameOrigin ? "Fetch.continueResponse" : "Fetch.fulfillRequest");
    await cleanup();
  });
});

it("maps a guarded browser redirect to a Codex session error", async () => {
  let paused;
  const cdp = { on: (_name, handler) => { paused = handler; }, send: vi.fn(async () => {}), detach: vi.fn(async () => {}) };
  const page = { url: () => "https://chatgpt.com/", context: () => ({ newCDPSession: async () => cdp }) };
  const runBrowser = async (input) => {
    const session = new PlaywrightChatGptWebBrowserSession(page, {
      sameOriginRedirects: input.sameOriginRedirects, selection: {},
      executePageRequest: async () => {
        await paused({ request: { url: "https://chatgpt.com/backend-api/f/conversation" }, requestId: "chat", responseStatusCode: 302, responseHeaders: [{ name: "location", value: "https://other.invalid/" }] });
      },
    });
    const cleanup = await session.start({});
    try { return await session.submitPrompt({ prompt: "hello" }); } finally { await cleanup(); }
  };
  const { response } = await new ChatGptWebCodexExecutor({ runBrowser }).execute({ ...chatInput, credentials: { providerSpecificData: { transport: "browser" } } });
  expect(response.status).toBe(401);
  expect(await response.text()).toMatch(/session/i);
  expect(cdp.send.mock.calls[1][0]).toBe("Fetch.fulfillRequest");
});

it("does not install browser redirect interception for ordinary ChatGPT Web", async () => {
  const context = vi.fn();
  const page = { url: () => "https://chatgpt.com/", context };
  const session = new PlaywrightChatGptWebBrowserSession(page, { selection: {}, executePageRequest: async () => "done" });
  const cleanup = await session.start({});
  expect(await session.submitPrompt({ prompt: "hello" })).toBe("done");
  expect(context).not.toHaveBeenCalled();
  await cleanup();
});
