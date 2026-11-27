/**
 * #2311 item 3: the staged web-session executors share one base
 * (webSessionBase.js) for transport, cookie parsing, error sanitizing and
 * stream reading; each keeps its provider-private SSE field parser. Offline: every outbound send reaches a mocked proxyAwareFetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A metadata-only caller may mock default.js without exposing its executor class.
vi.mock("../../open-sse/executors/default.js", () => ({ normalizeAccountIdPlaceholder: vi.fn() }));

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: mocks.proxyAwareFetch }));

import { WebSessionExecutor } from "../../open-sse/executors/webSessionBase.js";
import { WebSessionExecutor as WebSessionTransport } from "../../open-sse/executors/web-session-executor.js";
import { readStreamLines } from "../../open-sse/executors/websession-utils.js";
import { sanitizeErrorMessage } from "../../open-sse/utils/error.js";
import { BlackboxWebExecutor } from "../../open-sse/executors/blackbox-web.js";
import { ConolWebExecutor } from "../../open-sse/executors/conol-web.js";
import { DoubaoWebExecutor } from "../../open-sse/executors/doubao-web.js";
import { NotrackWebExecutor } from "../../open-sse/executors/notrack-web.js";
import { TencentAIStudioWebExecutor } from "../../open-sse/executors/tencent-aistudio-web.js";

const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080", strictProxy: true };
const messages = [{ role: "user", content: "hi" }];
const SECRET = "synthetic-secret-c2311";
const encoder = new TextEncoder();
const json = (value, status = 200) => Response.json(value, { status });
const sse = (text) => new Response(text, { headers: { "content-type": "text/event-stream" } });

/** A body delivered in the given byte chunks, recording whether it was cancelled. */
function chunked(parts, state = {}) {
  const queue = parts.map((part) => (typeof part === "string" ? encoder.encode(part) : part));
  return new ReadableStream({
    pull(controller) { if (queue.length) controller.enqueue(queue.shift()); else controller.close(); },
    cancel() { state.cancelled = true; },
  });
}

const blackboxRoutes = (chat) => (url) => {
  if (url.endsWith("/api/auth/session")) return json({ user: { email: "user@example.invalid" } });
  if (url.endsWith("/api/check-subscription")) return json({ hasActiveSubscription: true });
  return chat();
};
const conolRoutes = (stream) => (url, init) => {
  if (url.endsWith("/api/sessions") && init.method === "POST") return json({ sessionId: "session-1" }, 201);
  if (url.endsWith("/model")) return json({ ok: true });
  if (url.includes("logDeltas=1")) return stream();
  return new Response(null, { status: 202 });
};
const dolaEvent = (text) => `data: ${JSON.stringify({ content: { content_block: [{ content: { text_block: { text } } }] } })}\n\n`;
const dolaPatch = (text) => `data: ${JSON.stringify({ patch_op: [{ patch_value: { content_block: [{ content: { text_block: { text } } }] } }] })}\n\n`;
const notrackLine = (event) => `data:${JSON.stringify(event)}\n`;
const openAiChunk = (content, finish = null) => `data: ${JSON.stringify({ id: "chatcmpl-up", created: 1, choices: [{ index: 0, delta: content == null ? {} : { content }, finish_reason: finish }] })}\n\n`;

const EXECUTORS = [
  { name: "blackbox-web", make: () => new BlackboxWebExecutor(), input: { model: "gpt-4", credentials: { apiKey: "next-auth.session-token=synthetic" } }, ok: blackboxRoutes(() => new Response("answer")), failing: blackboxRoutes(() => new Response(`token=${SECRET}`, { status: 500 })) },
  { name: "conol-web", make: () => new ConolWebExecutor(), input: { model: "claude-sonnet-5", credentials: { apiKey: "synthetic-session" } }, ok: conolRoutes(() => sse(`data: ${JSON.stringify({ type: "assistant", text: "answer" })}\n\n`)), failing: conolRoutes(() => new Response(`cookie=${SECRET}`, { status: 500 })) },
  { name: "doubao-web", make: () => new DoubaoWebExecutor(), input: { model: "dola-speed", credentials: { apiKey: "sessionid=synthetic; s_v_web_id=fp-1" } }, ok: () => sse(dolaEvent("answer")), failing: () => new Response(`upstream rejected token=${SECRET}`, { status: 400 }) },
  { name: "notrack-web", make: () => new NotrackWebExecutor(), input: { model: "notrack-c", credentials: { apiKey: "uid=1; si_usr_id=2; si_ses_id=3" } }, ok: () => sse(notrackLine({ type: "delta", chunk: "answer" })), failing: () => { throw new Error(`socket closed for Bearer ${SECRET}`); } },
  { name: "tencent-aistudio-web", make: () => new TencentAIStudioWebExecutor(), input: { model: "hy3-g", credentials: { apiKey: "session=synthetic" } }, ok: () => json({ choices: [{ message: { content: "answer" }, finish_reason: "stop" }] }), failing: () => new Response(`api_key=${SECRET}`, { status: 500 }) },
];

const run = (testCase, extra = {}) => testCase.make().execute({ body: { messages }, stream: false, ...testCase.input, proxyOptions, ...extra });
const route = (handler) => mocks.proxyAwareFetch.mockImplementation(async (url, init) => handler(String(url), init));
const content = async (response) => (await response.json()).choices[0].message.content;
const streamed = async (response) => (await response.text()).split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)).choices[0].delta.content || "").join("");

beforeEach(() => {
  vi.clearAllMocks();
  // Nothing may bypass the mocked proxy transport.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network is closed in this test"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("webSessionBase", () => {
  it.each(EXECUTORS.map((testCase) => [testCase.name, testCase]))("%s extends the shared base", (_name, testCase) => {
    const executor = testCase.make();
    expect(executor).toBeInstanceOf(WebSessionExecutor);
    expect(executor).toBeInstanceOf(WebSessionTransport);
  });

  it.each(EXECUTORS.map((testCase) => [testCase.name, testCase]))("%s sends every request through the configured proxy", async (_name, testCase) => {
    route(testCase.ok);
    const result = await run(testCase);
    expect(result.response.status).toBe(200);
    expect(await content(result.response)).toBe("answer");
    expect(mocks.proxyAwareFetch).toHaveBeenCalled();
    for (const [, init, proxy] of mocks.proxyAwareFetch.mock.calls) {
      expect(proxy).toBe(proxyOptions);
      expect(init.redirect).toBe("manual");
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(EXECUTORS.map((testCase) => [testCase.name, testCase]))("%s answers an upstream failure with the shared sanitized envelope", async (_name, testCase) => {
    route(testCase.failing);
    const { response } = await run(testCase);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(body.error.message).not.toContain(SECRET);
    expect(sanitizeErrorMessage(body.error.message)).toBe(body.error.message);
  });

  it("keeps the upstream detail it echoed, redacted by the shared sanitizer", async () => {
    route(EXECUTORS[2].failing);
    const { response } = await run(EXECUTORS[2]);
    expect((await response.json()).error.message).toBe(sanitizeErrorMessage(`Dola error: upstream rejected token=${SECRET}`));
    route(EXECUTORS[3].failing);
    const notrack = await run(EXECUTORS[3]);
    expect((await notrack.response.json()).error.message).toBe(sanitizeErrorMessage(`Notrack connection failed: socket closed for Bearer ${SECRET}`));
  });
});

describe("SSE fixtures parse as before", () => {
  it("blackbox-web re-frames its text reply as SSE", async () => {
    route(EXECUTORS[0].ok);
    const { response } = await run(EXECUTORS[0], { stream: true });
    expect(await streamed(response)).toBe("answer");
  });

  it("conol-web stops at the done event and cancels the rest of the stream", async () => {
    const state = {};
    const history = JSON.stringify({ type: "history_delta", stages: [{ logs: [{ role: "assistant", content: [{ type: "text", text: "final answer" }] }] }] });
    route(conolRoutes(() => new Response(chunked([`data: ${JSON.stringify({ type: "stream_event", delta: { text: "partial" } })}\n${history.slice(0, 20)}`, `${history.slice(20)}\n${JSON.stringify({ type: "done" })}\n`, "never read\n"], state))));
    const { response } = await run(EXECUTORS[1]);
    expect(await content(response)).toBe("final answer");
    expect(state.cancelled).toBe(true);
  });

  it("doubao-web joins block and patch deltas across events", async () => {
    route(() => sse(`${dolaEvent("Hel")}${dolaPatch("lo")}data: not-json\n\ndata: [DONE]\n\n`));
    expect(await content((await run(EXECUTORS[2])).response)).toBe("Hello");
    route(() => sse(`${dolaEvent("Hel")}${dolaPatch("lo")}`));
    expect(await streamed((await run(EXECUTORS[2], { stream: true })).response)).toBe("Hello");
  });

  it("notrack-web joins a line split across chunks, in both reply shapes", async () => {
    const text = `${notrackLine({ type: "delta", chunk: "hello " })}${notrackLine({ type: "delta", chunk: "world" })}`;
    const body = () => new Response(chunked([text.slice(0, 25), text.slice(25)]));
    route(body);
    expect(await content((await run(EXECUTORS[3])).response)).toBe("hello world");
    route(body);
    expect(await streamed((await run(EXECUTORS[3], { stream: true })).response)).toBe("hello world");
  });

  it("notrack-web ignores a final line the upstream never terminated", async () => {
    route(() => new Response(`${notrackLine({ type: "delta", chunk: "kept" })}data:${JSON.stringify({ type: "delta", chunk: "cut" })}`));
    expect(await content((await run(EXECUTORS[3])).response)).toBe("kept");
  });

  it("tencent-aistudio-web folds an SSE body into one completion", async () => {
    route(() => sse(`${openAiChunk("Hun")}${openAiChunk("yuan")}${openAiChunk(null, "stop")}data: [DONE]\n\n`));
    const body = await (await run(EXECUTORS[4])).response.json();
    expect(body).toMatchObject({ id: "chatcmpl-up", created: 1, choices: [{ message: { content: "Hunyuan" }, finish_reason: "stop" }] });
  });
});

describe("shared helpers", () => {
  it("decodes a character split across chunks", async () => {
    const bytes = encoder.encode("olá\n");
    const out = [];
    for await (const line of readStreamLines(chunked([bytes.slice(0, 3), bytes.slice(3)]))) out.push(line);
    expect(out).toEqual(["olá"]);
  });

  it("reads lines with or without the unterminated tail", async () => {
    const lines = async (options) => { const out = []; for await (const line of readStreamLines(chunked(["a\r\nb", "\nc"]), options)) out.push(line); return out; };
    expect(await lines()).toEqual(["a", "b", "c"]);
    expect(await lines({ tail: false })).toEqual(["a", "b"]);
  });

  it("stops on an aborted signal and cancels the body", async () => {
    const state = {};
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect((async () => { for await (const line of readStreamLines(chunked(["a\n"], state), { signal: controller.signal })) void line; })()).rejects.toThrow("stop");
    expect(state.cancelled).toBe(true);
  });

  it("parses pasted cookies the same way for every executor", () => {
    const executor = new NotrackWebExecutor();
    expect(executor.cookieInput("Cookie: a=1; b=2")).toBe("a=1; b=2");
    expect(executor.cookieInput(undefined)).toBe("");
    expect(executor.cookieValue("Cookie: a=1; b=2", "b")).toBe("2");
    expect(executor.storedCookie({ providerSpecificData: { cookie: "uid=9" } })).toBe("uid=9");
  });
});

import { readStreamLines } from "../../open-sse/executors/websession-utils.js";

it("cancels a pending stream read on abort", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel });
  const controller = new AbortController();
  const reading = readStreamLines(body, { signal: controller.signal }).next();
  const assertion = expect(reading).rejects.toMatchObject({ name: "AbortError" });
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  } finally { clearTimeout(timer); }
}, 1000);
