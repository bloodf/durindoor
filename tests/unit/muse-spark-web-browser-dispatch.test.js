import "../translator/registerAll.js";
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExecutor } from "open-sse/executors/index.js";
import { __setMuseSparkBrowserPoolForTesting, __resetMuseSparkTokenCacheForTesting, __setMuseSparkWebSocketForTesting } from "open-sse/executors/muse-spark-web.js";

const credentials = (id, enabled = true) => ({ connectionId: id, apiKey: `ecto_1_sess=${id}`, providerSpecificData: { enableSessionDispatch: enabled } });
const request = (id, model = "muse-spark", stream = false) => getExecutor("muse-spark-web").execute({ model, stream, body: { messages: [{ role: "user", content: "hello" }] }, credentials: credentials(id) });
let calls, contexts, sockets, restoreSocket, responseStatus, routeHandler, wsHttpStatus;
class FakeSocket {
  constructor(url, options) { this.url = url; this.options = options; this.frames = []; sockets.push(this); queueMicrotask(() => wsHttpStatus ? this.unexpected(null, { statusCode: wsHttpStatus }) : this.onopen()); }
  send(frame) { this.frames.push(frame); if (this.frames.length === 2) queueMicrotask(() => { this.onmessage({ data: JSON.stringify({ type: "full", response: { sections: [{ view_model: { primitive: { text: "Hello" } } }] } }) }); this.onmessage({ data: JSON.stringify({ type: "patch", operations: [{ op: "delta", path: "/sections/0/view_model/primitive/text", value: " world" }] }) }); this.onclose({ code: responseStatus }); }); }
  on(name, handler) { if (name === "unexpected-response") this.unexpected = handler; }
  close() {}
}
beforeEach(() => {
  calls = []; contexts = []; sockets = []; responseStatus = 1000; routeHandler = null; wsHttpStatus = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); return new Response("{}", { status: 200 }); }));
  __setMuseSparkBrowserPoolForTesting({ acquire: async (key, options) => { const pooled = { key, options, cookie: "", context: { addCookies: vi.fn(async (cookies) => { pooled.cookie = `ecto_1_sess=${cookies[0].value}`; }) } }; contexts.push(pooled); return pooled; }, openPage: async (pooled) => ({ route: vi.fn(async (_pattern, handler) => { routeHandler = handler; }), routeWebSocket: vi.fn(), goto: vi.fn(), url: () => "https://www.meta.ai/", content: async () => `"accessToken":"ecto1:${pooled.cookie.split("=")[1]}"`, close: vi.fn(async () => {}) }) });
  restoreSocket = __setMuseSparkWebSocketForTesting(FakeSocket);
});
afterEach(() => { restoreSocket(); __setMuseSparkBrowserPoolForTesting(undefined); __resetMuseSparkTokenCacheForTesting(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("Muse Spark browser dispatch", () => {
  it("keeps disabled connections on the 501 guard", async () => { const result = await getExecutor("muse-spark-web").execute({ credentials: credentials("off", false) }); expect(result.response.status).toBe(501); expect(fetch).not.toHaveBeenCalled(); });
  it.each([["muse-spark", "think_fast", false], ["muse-spark-thinking", "think_hard", true]])("dispatches %s with %s", async (model, mode, stream) => {
    const result = await request("a", model, stream); expect(result.response.status).toBe(200); const text = await result.response.text(); expect(text).toContain("Hello"); expect(text).toContain("world");
    expect(calls[2].body.variables.input.mode).toBe(mode); expect(calls.every(c => c.options.redirect === "manual")).toBe(true); expect(sockets[0].frames).toHaveLength(2); expect(sockets[0].options.headers.Cookie).toBeUndefined(); expect(result.headers).toEqual({});
  });
  it.each([["/v1/chat/completions", FORMATS.OPENAI], ["/v1/messages", FORMATS.CLAUDE]])("serves JSON and streaming through %s", async (endpoint, format) => {
    for (const stream of [false, true]) {
      const body = { model: "muse-spark-web/muse-spark", messages: [{ role: "user", content: "hello" }], stream, ...(format === FORMATS.CLAUDE ? { max_tokens: 64 } : {}) };
      const result = await handleChatCore({ body, modelInfo: { provider: "muse-spark-web", model: "muse-spark" }, credentials: credentials("route"), clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: format, connectionId: "route", log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
      expect(result.response.status).toBe(200); const text = await result.response.text(); expect(text).toContain("Hello"); expect(text).toContain("world");
    }
  });
  it("refreshes stale tokens and isolates connections", async () => { vi.useFakeTimers(); await request("a"); await request("b"); await request("a"); expect(contexts).toHaveLength(2); expect(contexts[0].key).not.toBe(contexts[1].key); expect(sockets[0].url).toContain("ecto1%3Aa"); expect(sockets[1].url).toContain("ecto1%3Ab"); vi.advanceTimersByTime(241000); await request("a"); expect(contexts).toHaveLength(3); });
  it("maps expired sessions and rate limits", async () => { fetch.mockResolvedValueOnce(new Response("", { status: 401 })); const expired = await request("a"); expect(expired.response.status).toBe(401); expect(await expired.response.text()).toContain("re-import"); fetch.mockResolvedValueOnce(new Response("", { status: 429 })); expect((await request("b")).response.status).toBe(429); });
  it("blocks off-origin browser requests and never follows redirects", async () => {
    await request("a"); const abort = vi.fn(), proceed = vi.fn(); await routeHandler({ request: () => ({ url: () => "https://elsewhere.invalid/" }), abort, continue: proceed }); expect(abort).toHaveBeenCalled(); expect(proceed).not.toHaveBeenCalled(); expect(sockets[0].options.followRedirects).toBe(false);
  });
  it("maps WebSocket handshake rate limits", async () => { wsHttpStatus = 429; expect((await request("a")).response.status).toBe(429); });
  it("maps abnormal WebSocket closure to an upstream error", async () => { responseStatus = 1006; expect((await request("a")).response.status).toBe(502); });
});
