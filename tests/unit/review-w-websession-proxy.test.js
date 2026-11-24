import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyAgent } from "undici";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { ClaudeWebExecutor } from "../../open-sse/executors/claude-web.js";
import { NotionWebExecutor } from "../../open-sse/executors/notion-web.js";
import { HyperAgentExecutor } from "../../open-sse/executors/hyperagent.js";
import { DeepSeekWebExecutor } from "../../open-sse/executors/deepseek-web.js";
import { BlackboxWebExecutor } from "../../open-sse/executors/blackbox-web.js";
import { ConolWebExecutor } from "../../open-sse/executors/conol-web.js";
import { DoubaoWebExecutor } from "../../open-sse/executors/doubao-web.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { __setMuseSparkBrowserPoolForTesting, __resetMuseSparkTokenCacheForTesting, __setMuseSparkWebSocketForTesting } from "../../open-sse/executors/muse-spark-web.js";

// Review issues #2466 (web-session executors skip the connection proxy) and #2468
// (HyperAgent threads are not bound to the calling API key). All network is closed:
// proxyAwareFetch's underlying transport is replaced by a recorder.

const PROXY = { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9", strictProxy: true };
const STRICT_NO_ROUTE = { strictProxy: true, disableEnvProxy: true };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const sse = (text) => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
const messages = [{ role: "user", content: "hello" }];

function respond(url) {
  const target = new URL(url);
  const path = target.pathname;
  if (target.host === "claude.ai") return path.endsWith("/organizations") ? json([{ uuid: "org-1" }]) : sse('data: {"type":"completion","completion":"hi"}\n\n');
  if (target.host === "app.notion.com") return path.endsWith("getAvailableModels") ? json({ models: [{ model: "codename-one", modelMessage: "Model One" }] }) : new Response('{"value":{"text":"answer"}}\n');
  if (target.host === "hyperagent.com") {
    if (path === "/api/threads") return json({ id: "thread_contract_0001" });
    if (path.endsWith("/chat")) return sse(`data: ${JSON.stringify({ type: "text", content: "answer" })}\n\ndata: [DONE]\n\n`);
    return json({ ok: true });
  }
  if (target.host === "chat.deepseek.com") {
    if (path.endsWith("/users/current")) return json({ data: { biz_data: { token: "synthetic-access" } } });
    if (path.endsWith("/chat_session/create")) return json({ data: { biz_data: { chat_session: { id: "session-1" } } } });
    return sse(`data: ${JSON.stringify({ data: { biz_data: { response: "answer" } } })}\n\n`);
  }
  if (target.host === "app.blackbox.ai") {
    if (path.endsWith("/api/auth/session")) return json({ user: { email: "synthetic@example.invalid" } });
    if (path.endsWith("/api/check-subscription")) return json({ hasActiveSubscription: true });
    return new Response("answer", { status: 200 });
  }
  if (target.host === "conol.ai") {
    if (path === "/api/sessions") return json({ sessionId: "session-1" }, 201);
    if (path.endsWith("/model")) return json({ ok: true });
    if (target.search) return new Response(`data: ${JSON.stringify({ type: "assistant", text: "answer" })}\n\n`, { status: 200 });
    return new Response(null, { status: 202 });
  }
  if (target.host === "www.dola.com") return sse(`data: ${JSON.stringify({ content: { content_block: [{ content: { text_block: { text: "answer" } } }] } })}\n\n`);
  if (target.host.endsWith("meta.ai")) return new Response("{}", { status: 200 });
  throw new Error(`unexpected mocked URL ${url}`);
}

const CASES = [
  { name: "claude-web", min: 2, make: () => new ClaudeWebExecutor(), input: { credentials: { apiKey: "sessionKey=sk-ant-sid01-synthetic" }, model: "claude-sonnet-4-6" } },
  { name: "notion-web", min: 2, make: () => new NotionWebExecutor(), input: { credentials: { apiKey: "token_v2=synthetic; space_id=space-a; notion_user_id=user-a" }, model: "notion-web/model-one" } },
  { name: "hyperagent", min: 3, make: () => new HyperAgentExecutor(), input: { credentials: { apiKey: "session=synthetic-contract-cookie" }, model: "hyperagent/sonnet-latest" } },
  { name: "deepseek-web", min: 3, make: () => new DeepSeekWebExecutor(), input: { credentials: { apiKey: "synthetic-user-token" }, model: "deepseek-chat" } },
  { name: "blackbox-web", min: 3, make: () => new BlackboxWebExecutor(), input: { credentials: { apiKey: "next-auth.session-token=synthetic" }, model: "gpt-4" } },
  { name: "conol-web", min: 6, make: () => new ConolWebExecutor(), input: { credentials: { apiKey: "synthetic-session" }, model: "claude-sonnet-5" } },
  { name: "doubao-web", min: 1, make: () => new DoubaoWebExecutor(), input: { credentials: { apiKey: "sessionid=synthetic; s_v_web_id=synthetic" }, model: "dola-speed" } },
];

let recorded;
let restoreTransport;
beforeEach(() => {
  recorded = [];
  restoreTransport = __setOriginalFetchForTesting(async (url, init = {}) => {
    recorded.push({ url: String(url), dispatcher: init.dispatcher });
    return respond(String(url));
  });
});
afterEach(() => restoreTransport());

async function run(testCase, proxyOptions) {
  const outcome = await testCase.make().execute({ body: { messages }, stream: false, ...testCase.input, proxyOptions }).catch((error) => ({ rejected: error }));
  return outcome;
}

describe("web-session executors honour the connection proxy (#2466)", () => {
  for (const testCase of CASES) {
    it(`${testCase.name} sends every request through the connection proxy`, async () => {
      await run(testCase, PROXY);
      expect(recorded.length).toBeGreaterThanOrEqual(testCase.min);
      for (const call of recorded) expect(call.dispatcher, `${call.url} must use the proxy dispatcher`).toBeInstanceOf(ProxyAgent);
    });

    it(`${testCase.name} fails closed under strictProxy without a usable route`, async () => {
      const outcome = await run(testCase, STRICT_NO_ROUTE);
      expect(recorded).toEqual([]);
      if (!outcome.rejected) expect(outcome.response.status).toBeGreaterThanOrEqual(400);
    });
  }
});

describe("Muse Spark WebSocket honours the connection proxy (#2466)", () => {
  let sockets;
  let restoreSocket;
  class FakeSocket {
    constructor(url, options) {
      this.url = url; this.options = options; this.frames = []; sockets.push(this);
      queueMicrotask(() => this.onopen());
    }
    send(frame) {
      this.frames.push(frame);
      if (this.frames.length === 2) queueMicrotask(() => {
        this.onmessage({ data: JSON.stringify({ type: "full", response: { sections: [{ view_model: { primitive: { text: "Hello" } } }] } }) });
        this.onclose({ code: 1000 });
      });
    }
    on() {}
    close() {}
  }
  const credentials = (id) => ({ connectionId: id, apiKey: `ecto_1_sess=${id}`, providerSpecificData: { enableSessionDispatch: true } });
  const request = (id, proxyOptions) => getExecutor("muse-spark-web").execute({ model: "muse-spark", stream: false, body: { messages }, credentials: credentials(id), proxyOptions });

  beforeEach(() => {
    sockets = [];
    __setMuseSparkBrowserPoolForTesting({
      acquire: async (key) => {
        const pooled = { key, cookie: "", context: { addCookies: vi.fn(async (cookies) => { pooled.cookie = `ecto_1_sess=${cookies[0].value}`; }) } };
        return pooled;
      },
      openPage: async (pooled) => ({ route: vi.fn(async () => {}), routeWebSocket: vi.fn(), goto: vi.fn(), url: () => "https://www.meta.ai/", content: async () => `"accessToken":"ecto1:${pooled.cookie.split("=")[1]}"`, close: vi.fn(async () => {}) }),
    });
    restoreSocket = __setMuseSparkWebSocketForTesting(FakeSocket);
  });
  afterEach(() => { restoreSocket(); __setMuseSparkBrowserPoolForTesting(undefined); __resetMuseSparkTokenCacheForTesting(); });

  it("builds the socket with a proxy agent and sends the GraphQL calls through the proxy", async () => {
    const result = await request("proxied", PROXY);
    expect(result.response.status).toBe(200);
    expect(recorded.length).toBeGreaterThan(0);
    for (const call of recorded) expect(call.dispatcher).toBeInstanceOf(ProxyAgent);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].options.agent).toBeTruthy();
  });

  it("never opens a socket under strictProxy without a usable route", async () => {
    const result = await request("strict", STRICT_NO_ROUTE);
    expect(result.response.status).toBeGreaterThanOrEqual(400);
    expect(sockets).toHaveLength(0);
    expect(recorded).toEqual([]);
  });
});

describe("HyperAgent thread bindings are scoped to the API key (#2468)", () => {
  const cookie = "session=synthetic-binding-cookie";
  const makeHarness = () => {
    let created = 0;
    const calls = [];
    const fetch = vi.fn(async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method });
      if (path === "/api/threads" && init.method === "POST") return json({ id: `thread_binding_${String(++created).padStart(4, "0")}` });
      if (path.endsWith("/chat")) return sse(`data: ${JSON.stringify({ type: "text", content: "answer" })}\n\ndata: [DONE]\n\n`);
      return json({ ok: true });
    });
    const executor = new HyperAgentExecutor({ fetch });
    const send = (apiKeyId, extraBody = {}, conversation = messages) => executor.execute({
      apiKeyId, model: "hyperagent/sonnet-latest", stream: false, credentials: { apiKey: cookie }, body: { messages: conversation, ...extraBody },
    });
    const threadOf = async (result) => (await result.response.json()).hyperagent_thread_id;
    return { calls, send, threadOf, creates: () => calls.filter((call) => call.path === "/api/threads" && call.method === "POST").length };
  };
  const followUp = [{ role: "user", content: "hello" }, { role: "assistant", content: "answer" }, { role: "user", content: "more" }];

  it("does not let a second key continue the first key's thread with the same first message", async () => {
    const { send, threadOf, creates } = makeHarness();
    const first = await threadOf(await send("key-a"));
    expect(await threadOf(await send("key-a", {}, followUp))).toBe(first);
    expect(creates()).toBe(1);
    const other = await threadOf(await send("key-b", {}, followUp));
    expect(other).not.toBe(first);
    expect(creates()).toBe(2);
  });

  it("accepts a client-supplied thread id only from the key that created it", async () => {
    const { send, threadOf, creates } = makeHarness();
    const owned = await threadOf(await send("key-a"));
    expect(creates()).toBe(1);
    expect(await threadOf(await send("key-a", { hyperagent_thread_id: owned }))).toBe(owned);
    expect(creates()).toBe(1);
    expect(await threadOf(await send("key-b", { hyperagent_thread_id: owned }))).not.toBe(owned);
    expect(creates()).toBe(2);
    expect(await threadOf(await send("key-a", { thread_id: "thread_foreign_never_created" }))).not.toBe("thread_foreign_never_created");
  });
});
