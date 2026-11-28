/**
 * Kiro EventStream terminal parity with OmniRoute #19723 (#2034).
 *
 * Real code: KiroExecutor's EventStream transform, an isolated SQLite database, two
 * Kiro accounts with their own proxy pools, the gateway chat handler (account loop,
 * early-EOF peek, SSE-to-JSON and Claude translation). Mocked: only the outbound
 * transport (`proxyAwareFetch`). Every frame, token and proxy URL is synthetic.
 *
 * Before/after evidence for each case is in
 * internal/docs/port-reports/kiro-exception-terminal-19723.md.
 */
import fs from "node:fs";
import { crc32 } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const boundary = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-exception-terminal-"));
  const savedEnv = { ...process.env };
  fs.mkdirSync(path.join(root, "home"));
  Object.assign(process.env, { DATA_DIR: path.join(root, "data"), HOME: path.join(root, "home"), DURINDOOR_DATABASE_ENGINE: "sqlite" });
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON", "DURINDOOR_KIRO_CREATE_RESPONSE"]) delete process.env[key];
  // proxyFetch keeps the global fetch it loads with as its direct transport; refuse it.
  const realFetch = globalThis.fetch;
  const refuse = async (url) => { throw new Error(`closed boundary: unexpected network access ${url}`); };
  globalThis.fetch = refuse;
  return { root, savedEnv, realFetch, refuse, send: vi.fn() };
});
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: boundary.send }));

const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
const { kiroExceptionStatus } = await import("../../open-sse/executors/kiroTerminal.js");

// ---------- synthetic AWS EventStream frames ----------

function frame(headers, payload) {
  const enc = new TextEncoder();
  const parts = Object.entries(headers).map(([name, value]) => {
    const n = enc.encode(name);
    const v = enc.encode(value);
    const bytes = new Uint8Array(1 + n.length + 1 + 2 + v.length);
    bytes[0] = n.length;
    bytes.set(n, 1);
    bytes[1 + n.length] = 7;
    new DataView(bytes.buffer).setUint16(2 + n.length, v.length);
    bytes.set(v, 4 + n.length);
    return bytes;
  });
  const headersLength = parts.reduce((sum, part) => sum + part.length, 0);
  const data = enc.encode(JSON.stringify(payload));
  const total = 12 + headersLength + data.length + 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total);
  view.setUint32(4, headersLength);
  view.setUint32(8, crc32(out.subarray(0, 8)));
  let offset = 12;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  out.set(data, offset);
  view.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
  return out;
}

const PROVIDER_SECRET = "provider-text-SYNTHETIC-7d1c";
const event = (type, payload = {}) => frame({ ":event-type": type, ":message-type": "event", ":content-type": "application/json" }, payload);
const exception = (name) => frame({ ":exception-type": name, ":message-type": "exception", ":content-type": "application/json" }, { message: `${PROVIDER_SECRET} for ${name}` });
const text = (content) => event("assistantResponseEvent", { content });
const stop = (stopReason) => event("messageStopEvent", stopReason ? { stopReason } : {});
const accounting = [event("meteringEvent", { usage: 0.25 }), event("contextUsageEvent", { contextUsagePercentage: 1 })];
const completed = (content = "sibling answer") => [text(content), stop(), ...accounting];

/** An upstream body. `open` never closes by itself; `cancelled` records release. */
function upstream(frames, { open = false, chunkSize = 0 } = {}) {
  const record = { cancelled: false };
  const bytes = chunkSize ? splitBytes(frames, chunkSize) : frames;
  record.body = new ReadableStream({
    start(controller) {
      for (const chunk of bytes) controller.enqueue(chunk);
      if (!open) controller.close();
    },
    cancel() { record.cancelled = true; },
  });
  return record;
}

function splitBytes(frames, size) {
  const all = new Uint8Array(frames.reduce((sum, f) => sum + f.length, 0));
  let offset = 0;
  for (const f of frames) { all.set(f, offset); offset += f.length; }
  const chunks = [];
  for (let i = 0; i < all.length; i += size) chunks.push(all.slice(i, i + size));
  return chunks;
}

async function readAll(response, { timeoutMs = 2000 } = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let timer;
    const next = await Promise.race([
      reader.read(),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ hung: true }), Math.max(1, deadline - Date.now())); }),
    ]);
    clearTimeout(timer);
    if (next.hung) { await reader.cancel().catch(() => {}); return { output, hung: true }; }
    if (next.done) return { output, hung: false };
    output += decoder.decode(next.value, { stream: true });
  }
}

const dataFrames = (sse) => sse.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
const finishReasons = (sse) => dataFrames(sse).map((chunk) => chunk.choices?.[0]?.finish_reason).filter(Boolean);
const errors = (sse) => dataFrames(sse).filter((chunk) => chunk.error).map((chunk) => chunk.error);

async function transform(frames, options) {
  const source = upstream(frames, options);
  const response = new KiroExecutor("kiro").transformEventStreamToSSE(new Response(source.body), "claude-sonnet-4.5");
  return { ...(await readAll(response)), source };
}

// ---------- executor ----------

describe("Kiro executor: AWS exception frames inside a 200 EventStream", () => {
  it.each([
    ["ThrottlingException", 429, "rate_limit_error"],
    ["ServiceQuotaExceededException", 429, "rate_limit_error"],
    ["UnauthorizedException", 401, "authentication_error"],
    ["AccessDeniedException", 403, "permission_error"],
    ["ValidationException", 400, "invalid_request_error"],
    ["InternalServerException", 502, "server_error"],
  ])("maps %s to status %i without provider text, finish, usage or [DONE]", async (name, status, type) => {
    const { output, hung } = await transform([exception(name)]);
    expect(hung).toBe(false);
    expect(errors(output)).toEqual([{ message: "Kiro upstream stream failed", type, code: "kiro_stream_exception", status, status_code: status }]);
    expect(output).not.toContain(PROVIDER_SECRET);
    expect(output).not.toContain("[DONE]");
    expect(output).not.toContain('"usage"');
    expect(finishReasons(output)).toEqual([]);
  });

  it("maps the remaining and unknown exception names", () => {
    expect(kiroExceptionStatus("")).toBe(502);
    expect(kiroExceptionStatus("ResourceNotFoundException")).toBe(404);
    expect(kiroExceptionStatus("ConflictException")).toBe(409);
  });

  it("ends the client stream and releases the upstream body when the upstream stays open after the exception", async () => {
    const { output, hung, source } = await transform([text("partial"), exception("ThrottlingException")], { open: true });
    expect(hung).toBe(false);
    expect(source.cancelled).toBe(true);
    expect(errors(output)).toHaveLength(1);
    expect(finishReasons(output)).toEqual([]);
    expect(output).not.toContain('"usage"');
  });

  it("parses exception and stop frames split across arbitrary byte boundaries", async () => {
    for (const chunkSize of [1, 7, 33]) {
      const failed = await transform([text("a"), exception("AccessDeniedException")], { chunkSize });
      expect(errors(failed.output).map((e) => e.status)).toEqual([403]);
      const truncated = await transform([text("a"), stop("MAX_TOKENS"), ...accounting], { chunkSize });
      expect(finishReasons(truncated.output)).toEqual(["length"]);
      expect(truncated.output).toContain("data: [DONE]");
    }
  });
});

describe("Kiro executor: stop reasons", () => {
  it.each([
    ["MAX_TOKENS", "length"],
    ["max_tokens", "length"],
    ["MODEL_CONTEXT_WINDOW_EXCEEDED", "length"],
    ["CONTENT_FILTERED", "content_filter"],
    ["guardrail_intervened", "content_filter"],
    ["end_turn", "stop"],
    [null, "stop"],
  ])("stopReason %s finishes as %s with usage and [DONE]", async (reason, finish) => {
    const { output } = await transform([text("answer"), stop(reason), ...accounting]);
    expect(finishReasons(output)).toEqual([finish]);
    expect(dataFrames(output).at(-1).usage).toMatchObject({ kiro_credits: 0.25 });
    expect(output.trimEnd().endsWith("data: [DONE]")).toBe(true);
    expect(errors(output)).toEqual([]);
  });

  it.each(["MALFORMED_TOOL_USE", "malformed_model_output"])("fails a %s stop after content and a tool call without finish, usage or [DONE]", async (reason) => {
    const { output } = await transform([
      text("before"),
      event("toolUseEvent", { toolUseId: "toolu_bad", name: "read_file", input: "{\"pa" }),
      stop(reason),
      ...accounting,
    ]);
    expect(errors(output)).toEqual([{ message: "Kiro stopped with a malformed response", type: "server_error", code: "kiro_malformed_stop", status: 502, status_code: 502 }]);
    expect(finishReasons(output)).toEqual([]);
    expect(output).not.toContain('"usage"');
    expect(output).not.toContain("[DONE]");
  });

  it("keeps the one-shot wrapper repair when an invalid tool_call wrapper ends in a malformed stop", async () => {
    const wrapper = (toolUseId, input) => event("toolUseEvent", { toolUseId, name: "tool_call", input });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(upstream([wrapper("bad-wrapper", { arguments: { path: "/a" } }), stop("MALFORMED_TOOL_USE")]).body))
      .mockResolvedValueOnce(new Response(upstream([wrapper("good-wrapper", { name: "read_file", arguments: { path: "/a" } }), stop("tool_use"), ...accounting]).body));
    boundary.send.mockReset().mockImplementation(fetchMock);
    const result = await new KiroExecutor().execute({
      model: "claude-sonnet-4.5",
      stream: true,
      credentials: { accessToken: "synthetic-key", connectionId: "kiro-19723", providerSpecificData: { authMethod: "api_key" } },
      body: { conversationState: { conversationId: "turn-19723", currentMessage: { userInputMessage: { content: "go", modelId: "claude-sonnet-4.5" } }, history: [] } },
    });
    const { output } = await readAll(result.response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output).toContain("good-wrapper");
    expect(output).not.toContain("bad-wrapper");
    expect(errors(output)).toEqual([]);
    expect(finishReasons(output)).toEqual(["tool_calls"]);
  });

  it("keeps a valid tool stop structured: tool id, name, arguments and tool_calls", async () => {
    const { output } = await transform([
      text("Reading."),
      event("toolUseEvent", { toolUseId: "toolu_19723", name: "read_file", input: { path: "/x" } }),
      stop("tool_use"),
      ...accounting,
    ]);
    const calls = dataFrames(output).flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
    expect(calls[0]).toMatchObject({ id: "toolu_19723", type: "function", function: { name: "read_file" } });
    expect(JSON.parse(calls.map((call) => call.function?.arguments || "").join(""))).toEqual({ path: "/x" });
    expect(finishReasons(output)).toEqual(["tool_calls"]);
  });

  it("never treats accounting or metadata frames without messageStopEvent as success", async () => {
    for (const frames of [
      [text("partial"), ...accounting],
      [text("partial"), event("metricsEvent", { inputTokens: 5, outputTokens: 2 }), ...accounting],
      [text("partial"), event("metadataEvent", { metadataEvent: { stopReason: "end_turn" } }), ...accounting],
    ]) {
      const { output } = await transform(frames);
      expect(errors(output).map((e) => e.message)).toEqual(["Kiro stream ended before messageStopEvent"]);
      expect(finishReasons(output)).toEqual([]);
      expect(output).not.toContain('"usage"');
      expect(output).not.toContain("[DONE]");
    }
  });
});

// ---------- gateway ----------

const PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:123456789012:profile/SYNTHETIC";
let api;
/** Generation requests the transport saw, as `<account>@<proxy>`. */
let wire;
/** Upstream bodies handed out, in order. */
let served;
let replies;

function kiroTransport(url, init, proxyOptions) {
  const target = String(url);
  if (!target.endsWith("/generateAssistantResponse")) throw new Error(`closed boundary: ${target}`);
  const bearer = new Headers(init?.headers).get("authorization");
  wire.push(`${bearer.slice(-1)}@${proxyOptions?.connectionProxyUrl}`);
  const reply = replies.shift();
  if (!reply) throw new Error("closed boundary: no reply queued");
  const source = Array.isArray(reply) ? upstream(reply) : upstream(reply.frames, reply);
  served.push(source);
  return new Response(source.body, { status: 200, headers: { "content-type": "application/vnd.amazon.eventstream" } });
}

async function account(tag) {
  const proxyUrl = `http://proxy-${tag}.invalid:8080`;
  const pool = await api.createProxyPool({ name: `kiro-19723-${tag}-${Date.now()}`, proxyUrl, strictProxy: true });
  await api.localDb.createProviderConnection({
    provider: "kiro", authType: "oauth", name: `kiro-${tag}`,
    accessToken: `synthetic-bearer-${tag}`, refreshToken: `synthetic-refresh-${tag}`,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    providerSpecificData: { authMethod: "google", profileArn: PROFILE_ARN, proxyPoolId: pool.id },
  });
  return `${tag}@${proxyUrl}`;
}

const OPENAI = "/v1/chat/completions";
const ANTHROPIC = "/v1/messages";
function chat(path, stream, { signal } = {}) {
  return api.handleChat(new Request(`http://gateway.invalid${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "kr/claude-sonnet-4.5", stream, messages: [{ role: "user", content: "synthetic prompt" }] }),
    signal,
  }));
}

const claudeEvents = (sse) => sse.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));

let A;
let B;
beforeAll(async () => {
  const localDb = await import("@/lib/localDb");
  await (await import("@/lib/db/index.js")).initDb();
  api = {
    localDb,
    createProxyPool: (await import("@/lib/db/repos/proxyPoolsRepo.js")).createProxyPool,
    handleChat: (await import("@/sse/handlers/chat.js")).handleChat,
  };
  vi.stubGlobal("fetch", boundary.refuse);
}, 90_000);

beforeEach(async () => {
  for (const connection of await api.localDb.getProviderConnections()) await api.localDb.deleteProviderConnection(connection.id);
  wire = [];
  served = [];
  replies = [];
  boundary.send.mockReset().mockImplementation(kiroTransport);
  A = await account("a");
  B = await account("b");
  const logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  return () => { for (const spy of logs) spy.mockRestore(); };
});

afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  globalThis.fetch = boundary.realFetch;
  for (const key of Object.keys(process.env)) if (!(key in boundary.savedEnv)) delete process.env[key];
  Object.assign(process.env, boundary.savedEnv);
  fs.rmSync(boundary.root, { recursive: true, force: true });
});

describe("gateway: exception before any content", () => {
  it.each([OPENAI, ANTHROPIC])("%s buffered: a throttled pair returns HTTP 429, each account on its own proxy", async (path) => {
    replies = [[exception("ThrottlingException")], [exception("ThrottlingException")]];
    const response = await chat(path, false);
    const body = await response.text();
    expect(response.status).toBe(429);
    expect(JSON.parse(body).error.type).toBe("rate_limit_error");
    expect(body).not.toContain(PROVIDER_SECRET);
    expect(wire).toEqual([A, B]);
  });

  it.each([OPENAI, ANTHROPIC])("%s streamed: the sibling answers a throttled first account, on its own proxy", async (path) => {
    replies = [[exception("ThrottlingException")], completed()];
    const response = await chat(path, true);
    const body = (await readAll(response)).output;
    expect(response.status).toBe(200);
    expect(body).toContain("sibling answer");
    expect(body).not.toContain(PROVIDER_SECRET);
    expect(wire).toEqual([A, B]);
  });

  it("streamed: an upstream left open after the exception still fails over instead of holding the client", async () => {
    replies = [{ frames: [exception("ThrottlingException")], open: true }, completed()];
    const response = await chat(OPENAI, true);
    const { output, hung } = await readAll(response, { timeoutMs: 5000 });
    expect(hung).toBe(false);
    expect(output).toContain("sibling answer");
    expect(served[0].cancelled).toBe(true);
    expect(wire).toEqual([A, B]);
  });

  it.each([[OPENAI, false], [OPENAI, true], [ANTHROPIC, false], [ANTHROPIC, true]])(
    "%s stream=%s: a ValidationException is request-scoped and never tried on the sibling",
    async (path, stream) => {
      replies = [[exception("ValidationException")], completed()];
      const response = await chat(path, stream);
      const body = (await readAll(response)).output;
      if (stream) {
        expect(response.status).toBe(200);
        expect(body).toMatch(/"type":"invalid_request_error"/);
      } else {
        expect(response.status).toBe(400);
      }
      expect(body).not.toContain("sibling answer");
      expect(body).not.toContain(PROVIDER_SECRET);
      expect(wire).toEqual([A]);
    },
  );
});

describe("gateway: failure after content is never replayed (streamed)", () => {
  it("OpenAI: partial text, then one in-band rate-limit error; no finish, usage or sibling", async () => {
    replies = [[text("partial"), exception("ThrottlingException")], completed()];
    const body = (await readAll(await chat(OPENAI, true))).output;
    expect(body).toContain("partial");
    expect(errors(body).map((e) => e.type)).toEqual(["rate_limit_error"]);
    expect(finishReasons(body)).toEqual([]);
    expect(body).not.toContain('"usage"');
    expect(body).not.toContain("sibling answer");
    expect(wire).toEqual([A]);
  });

  it("Anthropic: partial text, then event: error; no message_delta or sibling", async () => {
    replies = [[text("partial"), exception("ThrottlingException")], completed()];
    const body = (await readAll(await chat(ANTHROPIC, true))).output;
    const events = claudeEvents(body);
    expect(events.some((e) => e.delta?.text === "partial")).toBe(true);
    expect(events.filter((e) => e.type === "error").map((e) => e.error.type)).toEqual(["rate_limit_error"]);
    expect(events.some((e) => e.type === "message_delta")).toBe(false);
    expect(body).not.toContain(PROVIDER_SECRET);
    expect(wire).toEqual([A]);
  });

  it("OpenAI: a malformed stop after content is an error, not a success", async () => {
    replies = [[text("partial"), stop("MALFORMED_TOOL_USE"), ...accounting], completed()];
    const body = (await readAll(await chat(OPENAI, true))).output;
    expect(body).toContain("partial");
    expect(errors(body).map((e) => e.type)).toEqual(["server_error"]);
    expect(finishReasons(body)).toEqual([]);
    expect(body).not.toContain('"usage"');
    expect(wire).toEqual([A]);
  });

  it("Anthropic: a malformed stop after content is event: error, not end_turn", async () => {
    replies = [[text("partial"), stop("MALFORMED_TOOL_USE"), ...accounting], completed()];
    const events = claudeEvents((await readAll(await chat(ANTHROPIC, true))).output);
    expect(events.filter((e) => e.type === "error")).toHaveLength(1);
    expect(events.some((e) => e.type === "message_delta")).toBe(false);
    expect(wire).toEqual([A]);
  });

  it.each([OPENAI, ANTHROPIC])("%s: a cut stream after content keeps the missing-messageStopEvent failure", async (path) => {
    replies = [[text("partial"), ...accounting], completed()];
    const body = (await readAll(await chat(path, true))).output;
    expect(body).toContain("partial");
    expect(body).not.toContain('"finish_reason":"stop"');
    expect(body).not.toContain('"stop_reason":"end_turn"');
    expect(body).not.toContain("sibling answer");
    expect(wire).toEqual([A]);
  });

  it("a caller abort releases the upstream and tries no sibling", async () => {
    replies = [{ frames: [text("partial")], open: true }, completed()];
    const controller = new AbortController();
    const response = await chat(OPENAI, true, { signal: controller.signal });
    const reader = response.body.getReader();
    let seen = "";
    while (!seen.includes("partial")) seen += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    await reader.cancel("client gone");
    await vi.waitFor(() => expect(served[0].cancelled).toBe(true));
    expect(wire).toEqual([A]);
  });
});

describe("gateway: completed stop shapes", () => {
  it.each([[false], [true]])("OpenAI stream=%s: MAX_TOKENS reaches the client as length", async (stream) => {
    replies = [[text("part"), stop("MAX_TOKENS"), ...accounting]];
    const body = (await readAll(await chat(OPENAI, stream))).output;
    if (stream) expect(finishReasons(body)).toEqual(["length"]);
    else expect(JSON.parse(body).choices[0].finish_reason).toBe("length");
    expect(wire).toEqual([A]);
  });

  it.each([[false], [true]])("Anthropic stream=%s: MAX_TOKENS reaches the client as max_tokens", async (stream) => {
    replies = [[text("part"), stop("MAX_TOKENS"), ...accounting]];
    const body = (await readAll(await chat(ANTHROPIC, stream))).output;
    if (stream) expect(claudeEvents(body).find((e) => e.type === "message_delta").delta.stop_reason).toBe("max_tokens");
    else expect(JSON.parse(body).stop_reason).toBe("max_tokens");
    expect(wire).toEqual([A]);
  });

  it.each([[false], [true]])("OpenAI stream=%s: an empty content-filtered turn is a safety stop, not replayed", async (stream) => {
    replies = [[stop("CONTENT_FILTERED"), ...accounting], completed()];
    const body = (await readAll(await chat(OPENAI, stream))).output;
    if (stream) expect(finishReasons(body)).toEqual(["content_filter"]);
    else expect(JSON.parse(body).choices[0].finish_reason).toBe("content_filter");
    expect(body).not.toContain("sibling answer");
    expect(wire).toEqual([A]);
  });

  it("OpenAI streamed: a normal stop keeps finish, credit usage and [DONE]", async () => {
    replies = [completed("plain answer")];
    const body = (await readAll(await chat(OPENAI, true))).output;
    expect(body).toContain("plain answer");
    expect(finishReasons(body)).toEqual(["stop"]);
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);
    expect(wire).toEqual([A]);
  });
});
