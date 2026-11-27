// fal.ai HTTP over WebSockets, staged and unregistered. Synthetic sockets
// only: no socket ever leaves the process, every credential is synthetic, and
// passing here says nothing about the live service.
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  FAL_HTTP_WEBSOCKET_LIMITS,
  FAL_HTTP_WEBSOCKET_ORIGIN,
  FAL_HTTP_WEBSOCKET_PROVIDER_ID,
  FAL_HTTP_WEBSOCKET_PROVIDER_METADATA,
  FAL_HTTP_WEBSOCKET_PROXY_ORIGIN,
  FAL_HTTP_WEBSOCKET_TRANSPORT,
  FAL_LEGACY_ENDPOINTS,
  FalHttpWebsocketReply,
  canonicalFalDefinition,
  canonicalFalEndpoint,
  compileFalHttpWebsocketInput,
  connectFalHttpWebsocket,
  connectFalRealtimeCanonical,
  createFalEventParser,
  falHttpInputSchema,
  falHttpWebsocketUrl,
  falRealtimePathCanonical,
  falRealtimeUrlCanonical,
  isLegacyFalEndpoint,
} from "../../open-sse/services/providerParity/native-fal-http-websocket/index.js";
import { FalRealtimeError, falRealtimePath } from "../../open-sse/services/providerParity/native-fal-realtime/schema.js";
import falRegistry from "../../open-sse/providers/registry/fal-ai.js";

const KEY_A = "SYNTHETIC-fal-key-a:0001aaaa";
const KEY_B = "SYNTHETIC-fal-key-b:0002bbbb";
const ENDPOINT = "openai/gpt-image-2.5/flare/text-to-image";
const URL_A = `wss://ws.fal.run/${ENDPOINT}`;

const objectSchema = (properties, required = []) => ({ type: "object", properties, required });
const definitionFor = (endpoint, schema = objectSchema({ prompt: { type: "string" }, reasoning: { type: "boolean" } }, ["prompt"]), extraPaths = {}) => ({
  endpoint_id: endpoint,
  openapi: {
    openapi: "3.0.4",
    components: { schemas: { Input: schema } },
    paths: {
      [`/${endpoint}`]: { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Input" } } } } } },
      [`/${endpoint}/requests/{request_id}/status`]: { get: {} },
      ...extraPaths,
    },
  },
});
const DEFINITION = Object.freeze(definitionFor(ENDPOINT));

/** A synthetic `ws` client socket: records frames, never touches the network. */
class SyntheticSocket extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.frames = [];
    this.sendOptions = [];
    this.terminated = 0;
    this.paused = 0;
    this.resumed = 0;
    this.sendError = null;
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  send(data, options, callback) {
    this.frames.push(data);
    this.sendOptions.push(options);
    callback?.(this.sendError ?? undefined);
  }
  text(value) {
    this.emit("message", Buffer.from(typeof value === "string" ? value : JSON.stringify(value)), false);
  }
  body(bytes) {
    this.emit("message", Buffer.from(bytes), true);
  }
  pause() { this.paused++; }
  resume() { this.resumed++; }
  terminate() {
    this.terminated++;
    this.readyState = 3;
  }
}

function factory({ autoOpen = true } = {}) {
  const sockets = [];
  const socketFactory = vi.fn((url, options) => {
    const socket = new SyntheticSocket(url, options);
    sockets.push(socket);
    if (autoOpen) queueMicrotask(() => socket.open());
    return socket;
  });
  return { sockets, socketFactory };
}

async function connect(extra = {}) {
  const { sockets, socketFactory } = factory(extra.factory);
  const onClose = vi.fn();
  const connection = await connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, onClose, socketFactory, ...extra.args });
  return { connection, socket: sockets[0], sockets, socketFactory, onClose };
}

const decoder = new TextDecoder();
async function drain(stream) {
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return text;
    text += decoder.decode(chunk.value);
  }
}
function events(text) {
  return text.split("\n\n").filter(Boolean).map((block) => {
    const lines = block.split("\n");
    const event = lines[0].startsWith("event: ") ? lines.shift().slice(7) : "message";
    return { event, data: JSON.parse(lines.join("\n").slice(6)) };
  });
}
const start = (id, status, headers) => ({ type: "start", request_id: id, status, headers });
const end = (id, status, extra = {}) => ({ type: "end", request_id: id, status, ...extra });

async function rejects(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}
function throws(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("fal HTTP-WebSocket wire protocol (source httpWebsocket.ts / httpWebsocketReply.ts)", () => {
  it("connects to wss://ws.fal.run/{endpoint} with the key only in the upgrade header", async () => {
    const { socket, socketFactory } = await connect();
    expect(socketFactory).toHaveBeenCalledTimes(1);
    expect(socket.url).toBe(URL_A);
    expect(socket.url).not.toContain(KEY_A);
    expect(socket.options).toEqual({
      headers: { Authorization: `Key ${KEY_A}` },
      followRedirects: false,
      handshakeTimeout: 15_000,
      maxPayload: 32 * 1024 * 1024,
    });
  });

  it("sends the input as one JSON text frame and maps start/body/end to http-start and final", async () => {
    const { connection, socket, onClose } = await connect();
    const reading = drain(connection.output);
    connection.send({ prompt: "one" });
    expect(socket.frames).toEqual(['{"prompt":"one"}']);
    expect(socket.sendOptions).toEqual([{ binary: false }]);
    socket.text(start("one", 200, { "Content-Type": "application/json" }));
    socket.text('{"answer":');
    socket.text('"one","image":{"url":"https://v3.fal.media/files/a.png"}}');
    socket.text(end("one", 200, { time_to_first_byte_seconds: 0.1 }));
    expect(connection.pending).toBe(false);
    connection.close();
    const text = await reading;
    expect(text).toBe(
      `event: http-start\ndata: ${JSON.stringify(start("one", 200, { "Content-Type": "application/json" }))}\n\n` +
      `event: final\ndata: ${JSON.stringify({
        artifacts: [{ path: "$.image", url: "https://v3.fal.media/files/a.png" }],
        output: { answer: "one", image: { url: "https://v3.fal.media/files/a.png" } },
        http: { id: "one", status: 200, headers: { "Content-Type": "application/json" }, type: "end", request_id: "one", time_to_first_byte_seconds: 0.1 },
        partial: false,
      })}\n\n`,
    );
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("stores binary bodies through the artifact hook with the Content-Disposition name", async () => {
    const artifact = vi.fn(() => "/api/v1/fal/jobs/job?artifact=file");
    const { connection, socket } = await connect({ args: { artifact } });
    const reading = drain(connection.output);
    connection.send({ prompt: "two" });
    socket.text(start("two", 200, { "content-type": "image/png", "content-disposition": 'attachment; filename="test.png"' }));
    socket.body([0, 1]);
    socket.body([255]);
    socket.text(end("two", 200));
    connection.close();
    const final = events(await reading).at(-1);
    expect(artifact).toHaveBeenCalledTimes(1);
    expect(Buffer.from(artifact.mock.calls[0][0])).toEqual(Buffer.from([0, 1, 255]));
    expect(artifact.mock.calls[0].slice(1)).toEqual(["image/png", "test.png"]);
    expect(final.event).toBe("final");
    expect(final.data.output).toEqual({ file: { url: "/api/v1/fal/jobs/job?artifact=file", file_name: "test.png", content_type: "image/png" } });
    expect(final.data.artifacts).toEqual([{ url: "/api/v1/fal/jobs/job?artifact=file", file_name: "test.png", content_type: "image/png", path: "$.file" }]);
  });

  it("falls back to a data URI without an artifact hook and to fal-output without a filename", async () => {
    const { connection, socket } = await connect();
    const reading = drain(connection.output);
    connection.send({ prompt: "bin" });
    socket.text(start("bin", 200, {}));
    socket.body([1, 2, 3]);
    socket.text(end("bin", 200));
    connection.close();
    const final = events(await reading).at(-1);
    expect(final.data.output.file).toEqual({ url: "data:application/octet-stream;base64,AQID", file_name: "fal-output", content_type: "application/octet-stream" });
  });

  it("keeps native error text and HTTP status on a failed response and accepts the next invocation", async () => {
    const { connection, socket, onClose } = await connect();
    const reading = drain(connection.output);
    connection.send({ prompt: "bad" });
    socket.text(start("three", 422, { "Content-Type": "text/plain" }));
    socket.text("native validation message");
    socket.text(end("three", 422));
    expect(connection.closed).toBe(false);
    connection.send({ prompt: "again" });
    socket.text(start("four", 200, { "content-type": "application/problem+json" }));
    socket.text('{"ok":true}');
    socket.text(end("four", 500));
    connection.close();
    const list = events(await reading);
    expect(list.map((e) => e.event)).toEqual(["http-start", "error", "http-start", "error"]);
    expect(list[1].data).toMatchObject({ output: "native validation message", error: "Fal upstream HTTP response failed", partial: false, http: { status: 422, request_id: "three" } });
    expect(list[3].data).toMatchObject({ output: { ok: true }, http: { status: 500, id: "four" } });
    expect(socket.frames).toHaveLength(2);
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("parses an event-stream body byte by byte and ends it with http-end, not a final", async () => {
    const { connection, socket } = await connect();
    const reading = drain(connection.output);
    connection.send({ prompt: "test", reasoning: false });
    socket.text(start("sse", 200, { "Content-Type": "text/event-stream; charset=utf-8" }));
    const sse = 'event: token\r\ndata: {"partial":true,"output":"é"}\r\n\r\n: comment\nevent: final\ndata: {"partial":false,"output":"é cube"}\n\ndata: [DONE]\n\n';
    for (const byte of new TextEncoder().encode(sse)) socket.body([byte]);
    socket.text(end("sse", 200));
    connection.close();
    const list = events(await reading);
    expect(list.map((e) => e.event)).toEqual(["http-start", "token", "final", "message", "http-end"]);
    expect(list[1].data).toEqual({ partial: true, output: "é" });
    expect(list[2].data).toEqual({ partial: false, output: "é cube" });
    expect(list[3].data).toBe("[DONE]");
    expect(list[4].data).toEqual({ http: { id: "sse", status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" }, type: "end", request_id: "sse" } });
  });

  it("refuses a second input while one is pending (409) without sending it", async () => {
    const { connection, socket } = await connect();
    connection.send({ prompt: "one" });
    const error = throws(() => connection.send({ prompt: "duplicate while pending" }));
    expect(error).toMatchObject({ status: 409, message: "The previous Fal invocation has not ended" });
    expect(socket.frames).toHaveLength(1);
    connection.close();
  });

  it("reply state machine matches the source unit cases for SSE snapshots and failed status", () => {
    const seen = [];
    let completed = 0;
    const reply = new FalHttpWebsocketReply((event, data) => seen.push({ event, data }), undefined, () => completed++);
    reply.pending = true;
    reply.consume(Buffer.from(JSON.stringify(start("r", 200, { "content-type": "text/event-stream" }))), false);
    reply.consume(Buffer.from('event: final\ndata: {"output":"model answer"}\n\n'), true);
    reply.consume(Buffer.from(JSON.stringify(end("r", 500))), false);
    expect(seen.map((e) => e.event)).toEqual(["http-start", "final", "error"]);
    expect(seen[2].data.error).toBe("Fal upstream HTTP response failed");
    expect(seen[2].data.output).toBeUndefined();
    expect(reply.pending).toBe(false);
    expect(completed).toBe(1);
  });

  it("SSE parser drops ids with NUL, keeps ids and refuses an unterminated event", () => {
    const out = [];
    const parser = createFalEventParser((e) => out.push(e));
    parser.push("id: 7\ndata: 1\n\nid: x\0y\ndata: {\"a\":2}\n\n");
    parser.finish();
    expect(out).toEqual([{ event: "message", data: 1, id: "7" }, { event: "message", data: { a: 2 }, id: "7" }]);
    const partial = createFalEventParser(() => {});
    partial.push("data: half");
    expect(() => partial.finish()).toThrow("Invalid or oversized Fal HTTP WebSocket response");
  });
});

describe("input schema (source compileFalInput \"direct\")", () => {
  it("validates with the direct HTTP schema, refuses unknown keys and keeps the input unchanged", () => {
    const validate = compileFalHttpWebsocketInput(DEFINITION);
    const input = { prompt: "x", reasoning: false };
    expect(validate(input)).toBe(input);
    expect(throws(() => validate({ prompt: "x", extra: 1 }))).toMatchObject({ status: 400, message: "Unsupported fal input: extra" });
    expect(throws(() => validate({}))).toMatchObject({ status: 400 });
    expect(throws(() => validate([]))).toMatchObject({ status: 400 });
  });

  it("selects an exact /stream operation id and never the realtime schema", () => {
    const streamId = "fal-ai/any-llm/stream";
    const definition = definitionFor(streamId);
    expect(falHttpInputSchema(definition).path).toBe(`/${streamId}`);
    const withRealtime = { ...DEFINITION, openapi: { ...DEFINITION.openapi, "x-fal-realtime": { path: "/realtime", input_schema: objectSchema({ other: { type: "string" } }) } } };
    expect(falHttpInputSchema(withRealtime).schema.properties).toHaveProperty("prompt");
    expect(() => compileFalHttpWebsocketInput(withRealtime)({ other: "x" })).toThrow(/Unsupported/);
  });

  it("refuses an ambiguous or missing schema before any socket or key use", async () => {
    const { socketFactory } = factory();
    const missing = { endpoint_id: ENDPOINT, openapi: { paths: {} } };
    const error = await rejects(connectFalHttpWebsocket({ definition: missing, credentials: { apiKey: KEY_A }, socketFactory }));
    expect(error).toMatchObject({ status: 400, message: "No unambiguous direct input schema for this endpoint" });
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it("an invalid input throws 400 without a frame and leaves the session usable", async () => {
    const { connection, socket } = await connect();
    expect(throws(() => connection.send({ nope: true }))).toBeInstanceOf(FalRealtimeError);
    const bigint = definitionFor(ENDPOINT, { type: "object", additionalProperties: true });
    const second = await connect({ args: { definition: bigint } });
    expect(throws(() => second.connection.send({ n: 1n }))).toMatchObject({ status: 400, message: "Invalid fal input: not encodable" });
    expect(socket.frames).toHaveLength(0);
    expect(second.socket.frames).toHaveLength(0);
    connection.send({ prompt: "ok" });
    expect(socket.frames).toHaveLength(1);
    connection.close();
    second.connection.close();
  });
});

describe("endpoint aliases shared by both flows (source canonicalFalEndpoint)", () => {
  it("maps every legacy alias to its full id and leaves full ids unchanged", () => {
    expect(Object.keys(FAL_LEGACY_ENDPOINTS)).toHaveLength(18);
    for (const [alias, target] of Object.entries(FAL_LEGACY_ENDPOINTS)) {
      expect(canonicalFalEndpoint(alias)).toBe(target);
      expect(canonicalFalEndpoint(target)).toBe(target);
      expect(isLegacyFalEndpoint(alias)).toBe(true);
      expect(isLegacyFalEndpoint(target)).toBe(true);
    }
    expect(canonicalFalEndpoint("bytedance/seedance-2.5/text-to-video")).toBe("bytedance/seedance-2.5/text-to-video");
    expect(isLegacyFalEndpoint("bytedance/seedance-2.5/text-to-video")).toBe(false);
    expect(falHttpWebsocketUrl("flux/dev")).toBe("wss://ws.fal.run/fal-ai/flux/dev");
    expect(falHttpWebsocketUrl("ace-step")).toBe("wss://ws.fal.run/fal-ai/ace-step");
  });

  it("refuses ids that could leave the fixed origin, with 400", () => {
    for (const bad of ["ace", "constructor", "__proto__", "../x", "fal-ai/..", "fal-ai/./x", "evil.com/x", "@evil/x", "fal-ai//x", "fal-ai/x?y=1", "fal-ai/x#y", "https://evil/x", "fal-ai/x y", `fal-ai/${"a".repeat(300)}`, 7, null]) {
      expect(throws(() => canonicalFalEndpoint(bad))).toMatchObject({ status: 400 });
    }
  });

  it("the realtime wrapper resolves aliases to the source's wss://fal.run path without changing canonical ids", () => {
    const override = { path: "/realtime", input_schema: objectSchema({ prompt: { type: "string" } }) };
    const aliased = { endpoint_id: "ace-step", openapi: { "x-fal-realtime": override } };
    expect(falRealtimePathCanonical(aliased)).toBe("fal-ai/ace-step/realtime");
    expect(falRealtimeUrlCanonical(aliased)).toBe("wss://fal.run/fal-ai/ace-step/realtime");
    const full = { endpoint_id: "fal-ai/fast-lcm-diffusion", openapi: {} };
    expect(falRealtimePathCanonical(full)).toBe(falRealtimePath(full));
    expect(canonicalFalDefinition(aliased)).toEqual({ ...aliased, endpoint_id: "fal-ai/ace-step" });
    expect(aliased.endpoint_id).toBe("ace-step");
  });

  it("connectFalRealtimeCanonical opens the canonical realtime URL", async () => {
    const { sockets, socketFactory } = factory();
    const definition = { endpoint_id: "flux/dev", openapi: { "x-fal-realtime": { path: "/realtime", input_schema: objectSchema({ prompt: { type: "string" } }) } } };
    const session = await connectFalRealtimeCanonical({ definition, credentials: { apiKey: KEY_A }, socketFactory });
    expect(sockets[0].url).toBe("wss://fal.run/fal-ai/flux/dev/realtime");
    expect(session.path).toBe("fal-ai/flux/dev/realtime");
    session.close();
  });

  it("an HTTP-WebSocket alias connects to the canonical endpoint", async () => {
    const definition = { ...definitionFor("fal-ai/flux/dev"), endpoint_id: "flux/dev" };
    const { connection, socket } = await connect({ args: { definition } });
    expect(socket.url).toBe("wss://ws.fal.run/fal-ai/flux/dev");
    expect(connection.endpoint).toBe("fal-ai/flux/dev");
    connection.close();
  });
});

describe("credentials and egress isolation", () => {
  it("two connections each send only their own key through their own proxy", async () => {
    const { sockets, socketFactory } = factory();
    const agents = [];
    const agentFactory = vi.fn((proxyUrl) => {
      const agent = { proxyUrl };
      agents.push(agent);
      return agent;
    });
    const a = await connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, proxyUrl: "http://proxy-a.invalid:8080", agentFactory, socketFactory });
    const b = await connectFalHttpWebsocket({ definition: DEFINITION, credentials: { accessToken: KEY_B }, proxyUrl: "https://proxy-b.invalid:8443", agentFactory, socketFactory });
    expect(sockets.map((s) => s.options.headers)).toEqual([{ Authorization: `Key ${KEY_A}` }, { Authorization: `Key ${KEY_B}` }]);
    expect(sockets[0].options.agent).toBe(agents[0]);
    expect(sockets[1].options.agent).toBe(agents[1]);
    expect(agentFactory.mock.calls).toEqual([["http://proxy-a.invalid:8080"], ["https://proxy-b.invalid:8443"]]);
    expect(JSON.stringify(sockets[0].options)).not.toContain(KEY_B);
    expect(JSON.stringify(sockets[1].options)).not.toContain(KEY_A);
    a.send({ prompt: "a" });
    b.send({ prompt: "b" });
    expect(sockets[0].frames).toEqual(['{"prompt":"a"}']);
    expect(sockets[1].frames).toEqual(['{"prompt":"b"}']);
    a.close();
    b.close();
    expect(FAL_HTTP_WEBSOCKET_PROXY_ORIGIN).toBe("https://ws.fal.run");
  });

  it("refuses a missing key (401), a non-HTTP proxy (409) and a failing proxy (502) before any socket", async () => {
    const { socketFactory } = factory();
    expect(await rejects(connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: "  " }, socketFactory }))).toMatchObject({ status: 401 });
    expect(await rejects(connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, proxyUrl: "socks5://p.invalid:1080", socketFactory }))).toMatchObject({ status: 409 });
    expect(await rejects(connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, proxyUrl: "not a url", socketFactory }))).toMatchObject({ status: 409 });
    const failing = await rejects(connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, proxyUrl: "http://p.invalid", agentFactory: () => { throw new Error(`boom ${KEY_A}`); }, socketFactory }));
    expect(failing).toMatchObject({ status: 502, message: "Fal WebSocket proxy unavailable" });
    expect(await rejects(connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, artifact: "nope", socketFactory }))).toMatchObject({ status: 500 });
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it("does not follow a redirect: the upgrade fails once with a fixed message and no second socket", async () => {
    const { sockets, socketFactory } = factory({ autoOpen: false });
    const pending = connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, socketFactory });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].emit("error", new Error(`Unexpected server response: 302 Location: https://evil.invalid/?k=${KEY_A}`));
    const error = await rejects(pending);
    expect(error).toMatchObject({ status: 502, message: "Fal WebSocket connection failed" });
    expect(error.message).not.toContain("evil");
    expect(error.message).not.toContain(KEY_A);
    expect(sockets[0].options.followRedirects).toBe(false);
    expect(sockets[0].terminated).toBe(1);
    expect(socketFactory).toHaveBeenCalledTimes(1);
  });
});

describe("malformed and oversized output fail the session once and never replay", () => {
  const cases = {
    "body before start": (s) => s.text("body before start"),
    "start before any input is checked separately": null,
    "end with another request id": (s) => { s.text(start("a", 200, {})); s.text(end("b", 200)); },
    "end before start": (s) => s.text(end("a", 200)),
    "start twice": (s) => { s.text(start("a", 200, {})); s.text(start("a", 200, {})); },
    "start with a non-integer status": (s) => s.text(start("a", 200.5, {})),
    "start with a status out of range": (s) => s.text(start("a", 99, {})),
    "start without headers": (s) => s.text({ type: "start", request_id: "a", status: 200 }),
    "start with array headers": (s) => s.text(start("a", 200, [])),
    "start with a numeric request id": (s) => s.text(start(1, 200, {})),
    "start with an oversized request id": (s) => s.text(start("r".repeat(257), 200, {})),
    "end with an invalid status": (s) => { s.text(start("a", 200, {})); s.text(end("a", "200")); },
    "a truncated SSE event at end": (s) => { s.text(start("a", 200, { "content-type": "text/event-stream" })); s.body(Buffer.from("data: half")); s.text(end("a", 200)); },
    "a non-buffer frame": (s) => s.emit("message", "text", false),
  };
  for (const [name, act] of Object.entries(cases)) {
    if (!act) continue;
    it(name, async () => {
      const { connection, socket, onClose } = await connect();
      const reading = drain(connection.output);
      connection.send({ prompt: "bill once" });
      act(socket);
      const list = events(await reading);
      expect(list.at(-1)).toEqual({ event: "error", data: { error: "Invalid or oversized Fal HTTP WebSocket response", status: "SUBMISSION_UNKNOWN" } });
      expect(socket.terminated).toBe(1);
      expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
      expect(socket.frames).toHaveLength(1);
      expect(throws(() => connection.send({ prompt: "again" }))).toMatchObject({ status: 410 });
      expect(socket.frames).toHaveLength(1);
    });
  }

  it("a start frame with no invocation pending fails as FAILED", async () => {
    const { connection, socket, onClose } = await connect();
    const reading = drain(connection.output);
    socket.text(start("a", 200, {}));
    expect(events(await reading)).toEqual([{ event: "error", data: { error: "Invalid or oversized Fal HTTP WebSocket response", status: "FAILED" } }]);
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("caps the response body, the SSE event buffer and the frame size", async () => {
    for (const [limits, act] of [
      [{ maxResponseBytes: 4 }, (s) => { s.text(start("a", 200, {})); s.body([1, 2, 3]); s.body([4, 5]); }],
      [{ maxEventBytes: 8 }, (s) => { s.text(start("a", 200, { "content-type": "text/event-stream" })); s.body(Buffer.from("data: 0123456789")); }],
      [{ maxFrameBytes: 4 }, (s) => { s.text(start("a", 200, {})); s.body([1, 2, 3, 4, 5]); }],
    ]) {
      const { connection, socket, onClose } = await connect({ args: { limits } });
      const reading = drain(connection.output);
      connection.send({ prompt: "x" });
      act(socket);
      expect(events(await reading).at(-1).data).toEqual({ error: "Invalid or oversized Fal HTTP WebSocket response", status: "SUBMISSION_UNKNOWN" });
      expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
    }
  });

  it("an artifact hook failure fails the session without leaking its text", async () => {
    const artifact = () => { throw new Error(`store failed ${KEY_A}`); };
    const { connection, socket } = await connect({ args: { artifact } });
    const reading = drain(connection.output);
    connection.send({ prompt: "x" });
    socket.text(start("a", 200, { "content-type": "image/png" }));
    socket.body([1]);
    socket.text(end("a", 200));
    const text = await reading;
    expect(text).not.toContain(KEY_A);
    expect(events(text).at(-1).data.status).toBe("SUBMISSION_UNKNOWN");
  });
});

describe("failures before and after submit", () => {
  it("a handshake error, an early close and a throwing factory reject with 502 and fixed messages", async () => {
    for (const act of [(s) => s.emit("error", new Error(`ECONNREFUSED ${KEY_A}`)), (s) => s.emit("close", 1006, Buffer.from(KEY_A))]) {
      const { sockets, socketFactory } = factory({ autoOpen: false });
      const onClose = vi.fn();
      const pending = connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, onClose, socketFactory });
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      act(sockets[0]);
      const error = await rejects(pending);
      expect(error.status).toBe(502);
      expect(error.message).not.toContain(KEY_A);
      expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
    }
    const thrown = await rejects(connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, socketFactory: () => { throw new Error(KEY_A); } }));
    expect(thrown).toMatchObject({ status: 502, message: "Fal WebSocket connection failed" });
  });

  it("a handshake that never opens times out with 504", async () => {
    const { sockets, socketFactory } = factory({ autoOpen: false });
    const error = await rejects(connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, socketFactory, limits: { handshakeTimeoutMs: 10 } }));
    expect(error).toMatchObject({ status: 504, message: "Fal WebSocket handshake timed out" });
    expect(sockets[0].terminated).toBe(1);
  });

  it("a connection loss after submit is SUBMISSION_UNKNOWN; while idle it just ends the stream", async () => {
    const lost = await connect();
    const reading = drain(lost.connection.output);
    lost.connection.send({ prompt: "x" });
    lost.socket.emit("close", 1006);
    expect(events(await reading)).toEqual([{ event: "error", data: { error: "Fal connection lost", status: "SUBMISSION_UNKNOWN" } }]);
    expect(lost.onClose).toHaveBeenCalledExactlyOnceWith(true);
    const idle = await connect();
    const idleReading = drain(idle.connection.output);
    idle.socket.emit("close", 1000);
    expect(await idleReading).toBe("");
    expect(idle.onClose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("a socket error after submit and a failed send callback are SUBMISSION_UNKNOWN", async () => {
    const errored = await connect();
    const reading = drain(errored.connection.output);
    errored.connection.send({ prompt: "x" });
    errored.socket.emit("error", new Error(KEY_A));
    expect(events(await reading).at(-1).data).toEqual({ error: "Fal WebSocket connection failed", status: "SUBMISSION_UNKNOWN" });
    const callback = await connect();
    callback.socket.sendError = new Error("write EPIPE");
    const callbackReading = drain(callback.connection.output);
    callback.connection.send({ prompt: "x" });
    expect(events(await callbackReading).at(-1).data).toEqual({ error: "Fal WebSocket submission is uncertain", status: "SUBMISSION_UNKNOWN" });
    expect(callback.socket.frames).toHaveLength(1);
  });

  it("a synchronous send failure is not a submission: 502, not pending, session still open", async () => {
    const { connection, socket } = await connect();
    socket.send = () => { throw new Error("not open"); };
    expect(throws(() => connection.send({ prompt: "x" }))).toMatchObject({ status: 502, message: "Fal WebSocket send failed" });
    expect(connection.pending).toBe(false);
    expect(connection.closed).toBe(false);
    connection.close();
  });

  it("refuses sends after close (410), past the send buffer (429) and over the input cap (413)", async () => {
    const { connection, socket } = await connect({ args: { limits: { maxInputBytes: 32 } } });
    socket.bufferedAmount = FAL_HTTP_WEBSOCKET_LIMITS.maxSendBufferBytes + 1;
    expect(throws(() => connection.send({ prompt: "x" }))).toMatchObject({ status: 429 });
    socket.bufferedAmount = 0;
    expect(throws(() => connection.send({ prompt: "x".repeat(40) }))).toMatchObject({ status: 413 });
    expect(socket.frames).toHaveLength(0);
    expect(connection.pending).toBe(false);
    connection.close();
    expect(throws(() => connection.send({ prompt: "x" }))).toMatchObject({ status: 410 });
  });
});

describe("deadlines, cancellation and backpressure", () => {
  it("the invocation deadline fails a pending invocation as SUBMISSION_UNKNOWN", async () => {
    const { connection, socket, onClose } = await connect({ args: { limits: { invocationTimeoutMs: 10 } } });
    const reading = drain(connection.output);
    connection.send({ prompt: "x" });
    expect(events(await reading)).toEqual([{ event: "error", data: { error: "Fal HTTP WebSocket invocation timed out", status: "SUBMISSION_UNKNOWN" } }]);
    expect(socket.terminated).toBe(1);
    expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("a completed invocation clears its deadline; an idle session ends with IDLE_TIMEOUT", async () => {
    const { connection, socket, onClose } = await connect({ args: { limits: { invocationTimeoutMs: 20, idleTimeoutMs: 60 } } });
    const reading = drain(connection.output);
    connection.send({ prompt: "x" });
    socket.text(start("a", 200, { "content-type": "text/plain" }));
    socket.text("ok");
    socket.text(end("a", 200));
    const list = events(await reading);
    expect(list.map((e) => e.event)).toEqual(["http-start", "final", "error"]);
    expect(list[2].data).toEqual({ error: "Fal HTTP WebSocket session was idle too long", status: "IDLE_TIMEOUT" });
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("an abort while pending is SUBMISSION_UNKNOWN; an abort while idle just closes", async () => {
    for (const pending of [true, false]) {
      const abort = new AbortController();
      const { connection, socket, onClose } = await connect({ args: { signal: abort.signal } });
      const reading = drain(connection.output);
      if (pending) connection.send({ prompt: "x" });
      abort.abort();
      const list = events(await reading);
      expect(list).toEqual(pending ? [{ event: "error", data: { error: "Fal WebSocket stopped; upstream completion is unknown", status: "SUBMISSION_UNKNOWN" } }] : []);
      expect(socket.terminated).toBe(1);
      expect(onClose).toHaveBeenCalledExactlyOnceWith(pending);
      expect(socket.frames).toHaveLength(pending ? 1 : 0);
    }
  });

  it("an abort before connect or during the handshake rejects with 499", async () => {
    const { socketFactory, sockets } = factory({ autoOpen: false });
    expect(await rejects(connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, signal: AbortSignal.abort(), socketFactory }))).toMatchObject({ status: 499 });
    expect(socketFactory).not.toHaveBeenCalled();
    const abort = new AbortController();
    const pending = connectFalHttpWebsocket({ definition: DEFINITION, credentials: { apiKey: KEY_A }, signal: abort.signal, socketFactory });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    abort.abort();
    expect(await rejects(pending)).toMatchObject({ status: 499 });
    expect(sockets[0].terminated).toBe(1);
  });

  it("cancelling the output stream closes the socket once", async () => {
    const { connection, socket, onClose } = await connect();
    connection.send({ prompt: "x" });
    await connection.output.cancel();
    expect(socket.terminated).toBe(1);
    expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
    connection.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pauses the socket when the output is full, resumes on read, and fails past the queue cap", async () => {
    const { connection, socket } = await connect({ args: { limits: { outputHighWaterBytes: 16, maxQueuedOutputBytes: 1024 } } });
    connection.send({ prompt: "x" });
    socket.text(start("a", 200, { "content-type": "text/event-stream" }));
    expect(socket.paused).toBeGreaterThan(0);
    const reader = connection.output.getReader();
    await reader.read();
    expect(socket.resumed).toBeGreaterThan(0);
    socket.body(Buffer.from(`data: "${"y".repeat(2048)}"\n\n`));
    let text = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(events(text).at(-1).data).toEqual({ error: "Fal HTTP WebSocket output queue is full", status: "SUBMISSION_UNKNOWN" });
    expect(connection.closed).toBe(true);
  });
});

describe("no credential in URL, output or errors", () => {
  it("every event and error of a full session is free of the key", async () => {
    const { connection, socket } = await connect();
    const reading = drain(connection.output);
    connection.send({ prompt: "x" });
    socket.text(start("a", 200, { "content-type": "application/json" }));
    socket.text('{"ok":1}');
    socket.text(end("a", 200));
    const errors = [throws(() => connection.send({ bad: 1 }))];
    socket.text("garbage");
    const text = await reading;
    errors.push(throws(() => connection.send({ prompt: "x" })));
    for (const value of [text, socket.url, ...errors.map((e) => `${e.message} ${JSON.stringify(e)}`)]) expect(value).not.toContain(KEY_A);
  });
});

describe("staging metadata (pre-registration only)", () => {
  const registration = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-fal-http-websocket/registration.json", import.meta.url), "utf8"));

  it("declares the fixed origin, the transport and the source pin", () => {
    expect(FAL_HTTP_WEBSOCKET_ORIGIN).toBe("wss://ws.fal.run");
    expect(FAL_HTTP_WEBSOCKET_TRANSPORT).toBe("http-websocket");
    expect(FAL_HTTP_WEBSOCKET_PROVIDER_ID).toBe("fal-ai");
    expect(FAL_HTTP_WEBSOCKET_PROVIDER_METADATA.httpWebsocketConfig).toEqual({ baseUrl: "wss://ws.fal.run" });
    expect(registration).toMatchObject({ issue: "#2034", status: "staged-unregistered", source: { repository: "OmniRoute", commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad" }, transport: { name: "http-websocket", url: "wss://ws.fal.run/{endpoint_id}" } });
    expect(Object.keys(registration.exports)).toEqual(expect.arrayContaining(["module", "connect", "aliases", "realtimeAliases"]));
  });

  it("the fal-ai registry entry is unchanged by this bundle", () => {
    const entry = falRegistry.default ?? falRegistry;
    expect(JSON.stringify(entry)).not.toContain("ws.fal.run");
    expect(JSON.stringify(entry)).not.toContain("httpWebsocketConfig");
  });
});
