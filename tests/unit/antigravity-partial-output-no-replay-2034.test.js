/**
 * #2034: an Antigravity failure after generated output must never be replayed.
 *
 * Reachable path (traced on the public route): a non-streaming client request
 * goes to `v1internal:generateContent`. When the backend answers with an event
 * stream that carries text or tool parts and then a trailing `{"error":{"code":504}}`,
 * nonStreamingHandler returns a 504 result flagged `upstreamPartialOutput`.
 * postProcess used to test that flag only after the Antigravity 504 timeout
 * replay and the request-buffer (507) replay, so the generation ran again on a
 * sibling (504) or on the same account (507). Streaming clients already get the
 * trailing error in-band from the empty-stream guard and are covered here too.
 *
 * Real: sqlite DB, handleChat, account selection, the executor, the translators.
 * Synthetic: every token and outbound byte. No live provider traffic.
 */
import "../translator/registerAll.js";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-antigravity-machine-id" }));
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({ ...(await importOriginal()), appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn(() => "synthetic-session"), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), saveRequestDetail: vi.fn(() => Promise.resolve()), saveRequestUsage: vi.fn(() => Promise.resolve()) }));
const wire = vi.hoisted(() => ({ send: null }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (url, init) => wire.send(url, init),
}));

const MODEL = "gemini-3.1-flash-lite";
const TOKEN_A = "synthetic-antigravity-token-a";
const TOKEN_B = "synthetic-antigravity-token-b";
const accountOf = { [`Bearer ${TOKEN_A}`]: "A", [`Bearer ${TOKEN_B}`]: "B" };

const TEXT = 'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"half an answer — é"}]}}]}}\n\n';
const TOOL = 'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"lookup","args":{"q":"x"}}}]}}]}}\n\n';
const TIMEOUT = 'data: {"error":{"code":504,"message":"backend timeout","status":"DEADLINE_EXCEEDED"}}\n\n';
const BUFFER = 'data: {"error":{"code":507,"message":"exceeded request buffer limit while retrying upstream"}}\n\n';
const STOP = '{"role":"model","parts":[{"text":"sibling answer"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"totalTokenCount":5}}';

const encoder = new TextEncoder();
const eventStream = (text, split = false) => () => new Response(new ReadableStream({
  start(controller) {
    const bytes = encoder.encode(text);
    if (split) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(bytes);
    controller.close();
  },
}), { status: 200, headers: { "content-type": "text/event-stream" } });
// generateContent answers one JSON document; streamGenerateContent answers SSE.
const answer = (url) => String(url).includes(":streamGenerateContent") ?
  new Response(`data: {"response":{"candidates":[{"content":${STOP}}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } }) :
  new Response(`{"response":{"candidates":[{"content":${STOP}}`, { status: 200, headers: { "content-type": "application/json" } });
const noOutputTimeout = () => new Response(JSON.stringify({ error: { code: 504, message: "deadline before output", status: "DEADLINE_EXCEEDED" } }), { status: 504, headers: { "content-type": "application/json" } });
const noOutputBuffer = () => new Response(JSON.stringify({ error: { code: 507, message: "exceeded request buffer limit while retrying upstream" } }), { status: 507, headers: { "content-type": "application/json" } });

let root, db, handleChat, usage;
let sent = [];
let replies = {};
let dialled = [];

async function upstream(url, init = {}) {
  if (!String(url).includes(":streamGenerateContent") && !String(url).includes(":generateContent")) {
    return new Response("{}", { status: 404 });
  }
  const account = accountOf[new Headers(init.headers).get("authorization")];
  sent.push(account);
  const queue = replies[account];
  return (queue.length > 1 ? queue.shift() : queue[0])(url);
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ag-partial-2034-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  vi.clearAllMocks();
  sent = [];
  dialled = [];
  wire.send = upstream;
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function refuse(...args) {
    dialled.push(JSON.stringify(args[0]?.host ?? args[0]?.[0]?.host ?? args[1] ?? "unknown"));
    process.nextTick(() => this.destroy(new Error("offline test: outbound connection refused")));
    return this;
  });
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  db = await import("../../src/lib/db/repos/connectionsRepo.js");
  usage = await import("@/lib/usageDb.js");
  const settings = await import("../../src/lib/db/repos/settingsRepo.js");
  await settings.updateSettings({ requireApiKey: false });
  vi.stubGlobal("fetch", vi.fn(upstream));
}, 60000);

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  expect(dialled).toEqual([]);
});

const connect = (name, accessToken, priority, provider = "antigravity") => db.createProviderConnection({
  provider, authType: "oauth", name, email: `${name}@example.test`, accessToken, priority,
  refreshToken: `refresh-${name}`, expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  projectId: `project-${name}`, isActive: true,
});

const ROUTES = {
  openai: (stream, prefix) => ["/v1/chat/completions", {
    model: `${prefix}/${MODEL}`, stream, messages: [{ role: "user", content: "ping" }],
    tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: { q: { type: "string" } } } } }],
  }],
  anthropic: (stream, prefix) => ["/v1/messages", {
    model: `${prefix}/${MODEL}`, stream, max_tokens: 64, messages: [{ role: "user", content: "ping" }],
    tools: [{ name: "lookup", description: "look up", input_schema: { type: "object", properties: { q: { type: "string" } } } }],
  }],
};

async function call(route, { stream, prefix = "antigravity", headers = {} }) {
  const [pathname, body] = ROUTES[route](stream, prefix);
  const response = await handleChat(new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
  const text = await response.text();
  // Let fire-and-forget bookkeeping settle before counting it.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { response, text };
}

/** Pending-request bookkeeping: [started, finished] counts. */
function lifecycle() {
  const calls = usage.trackPendingRequest.mock.calls;
  return [calls.filter((args) => args[3] === true).length, calls.filter((args) => args[3] === false).length];
}

function expectNoSuccess(text) {
  expect(text).not.toContain("sibling answer");
  expect(text).not.toMatch(/"finish_reason":"(stop|tool_calls)"/);
  expect(text).not.toMatch(/"stop_reason":"(end_turn|tool_use)"/);
  expect(text).not.toContain("[DONE]");
  expect(usage.saveRequestUsage).not.toHaveBeenCalled();
}

describe("#2034: partial Antigravity output is never replayed (public routes)", () => {
  const fixtures = [["text", TEXT], ["tool", TOOL], ["text+tool", TEXT + TOOL]];
  const cases = [];
  for (const route of ["openai", "anthropic"]) {
    for (const [label, parts] of fixtures) for (const split of [false, true]) cases.push([route, label, split, parts]);
  }

  it.each(cases)("%s JSON route: %s then trailing 504, split=%s, ends on the selected account", async (route, _label, split, parts) => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [eventStream(parts + TIMEOUT, split)], B: [answer] };
    const { response, text } = await call(route, { stream: false });
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(504);
    const body = JSON.parse(text);
    expect(body.error.message).toBe("backend timeout");
    expect(text).not.toContain("half an answer");
    expect(text).not.toContain("upstreamPartialOutput");
    expect([...response.headers.keys()].join(",")).not.toMatch(/partial|replay/i);
    expectNoSuccess(text);
    expect(lifecycle()).toEqual([1, 1]);
    expect(usage.finishActiveSession).toHaveBeenCalledOnce();
  }, 60000);

  it.each([["openai"], ["anthropic"]])("%s JSON route: a trailing request-buffer 507 after output is not replayed on the same account", async (route) => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [eventStream(TEXT + TOOL + BUFFER, true), answer], B: [answer] };
    const { response, text } = await call(route, { stream: false });
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(507);
    expect(JSON.parse(text).error.message).toBe("exceeded request buffer limit while retrying upstream");
    expectNoSuccess(text);
    expect(lifecycle()).toEqual([1, 1]);
  }, 60000);

  it("the agy alias and a single account do not replay through the outer transient retry", async () => {
    await connect("a", TOKEN_A, 1, "agy");
    replies = { A: [eventStream(TEXT + TIMEOUT, true), answer] };
    const { response, text } = await call("openai", { stream: false, prefix: "agy" });
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(504);
    expect(JSON.parse(text).error.message).toBe("backend timeout");
    expectNoSuccess(text);
    expect(lifecycle()).toEqual([1, 1]);
  }, 60000);

  it("a pinned account ends with the same backend error", async () => {
    const a = await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [eventStream(TOOL + TIMEOUT, true), answer], B: [answer] };
    const { response, text } = await call("anthropic", { stream: false, headers: { "x-connection-id": a.id } });
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(504);
    expect(JSON.parse(text).error.message).toBe("backend timeout");
    expectNoSuccess(text);
  }, 60000);

  it.each([["openai"], ["anthropic"]])("%s SSE route: the trailing 504 stays in-band on the selected account", async (route) => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [eventStream(TEXT + TOOL + TIMEOUT, true)], B: [answer] };
    const { response, text } = await call(route, { stream: true });
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(200);
    expect(text).toContain("half an answer");
    expect(text).toContain("backend timeout");
    expect(text).not.toContain("upstreamPartialOutput");
    expect(text).not.toContain("sibling answer");
    expect(text).not.toMatch(/"stop_reason":"(end_turn|tool_use)"/);
    expect(usage.saveRequestUsage).not.toHaveBeenCalled();
    expect(lifecycle()).toEqual([1, 1]);
    expect(usage.finishActiveSession).toHaveBeenCalledOnce();
  }, 60000);
});

describe("#2034: no-output failures keep the existing bounded retry policy", () => {
  it.each([["openai"], ["anthropic"]])("%s: a pre-response 504 moves to one sibling", async (route) => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [noOutputTimeout], B: [answer] };
    const { response, text } = await call(route, { stream: false });
    expect(sent).toEqual(["A", "B"]);
    expect(response.status).toBe(200);
    expect(text).toContain("sibling answer");
  }, 60000);

  it("a pinned pre-response 504 stays on the pinned account and ends there", async () => {
    const a = await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [noOutputTimeout, answer], B: [answer] };
    const { response } = await call("openai", { stream: false, headers: { "x-connection-id": a.id } });
    expect(sent).toEqual(["A"]);
    expect(response.status).toBe(504);
  }, 60000);

  it("a request-buffer 507 without output replays once on the same account", async () => {
    await connect("a", TOKEN_A, 1);
    await connect("b", TOKEN_B, 2);
    replies = { A: [noOutputBuffer, answer], B: [answer] };
    const { response, text } = await call("openai", { stream: false });
    expect(sent).toEqual(["A", "A"]);
    expect(response.status).toBe(200);
    expect(text).toContain("sibling answer");
  }, 60000);
});
