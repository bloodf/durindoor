// fal.ai native realtime WebSocket transport, staged and unregistered.
// Synthetic sockets only: no socket ever leaves the process, every credential
// is synthetic, and passing here says nothing about the live service.
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FAL_REALTIME_LIMITS,
  FAL_REALTIME_ORIGIN,
  FAL_REALTIME_PROVIDER_ALIASES,
  FAL_REALTIME_PROVIDER_ID,
  FAL_REALTIME_PROVIDER_METADATA,
  FAL_DOCUMENTED_REALTIME_ENDPOINTS,
} from "../../open-sse/services/providerParity/native-fal-realtime/config.js";
import {
  FalRealtimeError,
  canonicalFalRealtimeEndpoint,
  compileFalRealtimeInput,
  falRealtimeInputSchema,
  falRealtimePath,
  falRealtimeUrl,
} from "../../open-sse/services/providerParity/native-fal-realtime/schema.js";
import { decodeMsgpack, encodeMsgpack } from "../../open-sse/services/providerParity/native-fal-realtime/msgpack.js";
import {
  connectFalRealtime,
  falRealtimeFrameEvent,
  falRealtimeToken,
  normalizeFalRealtimeOutput,
} from "../../open-sse/services/providerParity/native-fal-realtime/realtime.js";
import { falRealtimeSseEvent } from "../../open-sse/services/providerParity/native-fal-realtime/socket.js";
import * as bundle from "../../open-sse/services/providerParity/native-fal-realtime/index.js";
import falRegistry from "../../open-sse/providers/registry/fal-ai.js";

const KEY_A = "SYNTHETIC-fal-key-a:0001aaaa";
const KEY_B = "SYNTHETIC-fal-key-b:0002bbbb";
const ENDPOINT = "fal-ai/fast-lcm-diffusion";
const PATH = "fal-ai/fast-lcm-diffusion/realtime";
const URL_A = `wss://fal.run/${PATH}`;
// The source fixture tests/fixtures/fal/realtime-1px.png, a 1x1 PNG.
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==";
const IMAGE = `data:image/png;base64,${PNG_1PX}`;

const DEFINITION = Object.freeze({
  endpoint_id: ENDPOINT,
  metadata: { category: "text-to-image" },
  openapi: { openapi: "3.0.4", paths: { [`/${ENDPOINT}`]: { post: {} } } },
});
const withOverride = (override, endpoint = ENDPOINT) => ({
  endpoint_id: endpoint,
  openapi: { openapi: "3.0.4", "x-fal-realtime": override },
});

const hex = (...parts) => Uint8Array.from(Buffer.from(parts.join("").replace(/\s+/g, ""), "hex"));
const toHex = (bytes) => Buffer.from(bytes).toString("hex");
const s = (text) => Buffer.from(text, "utf8").toString("hex");

// ---- wire fixtures, assembled by hand from the MessagePack spec ----
// { prompt: "a cube", seed: 0 }  (source test input shape)
const INPUT_SMALL = { prompt: "a cube", seed: 0 };
const INPUT_SMALL_WIRE = hex("82", "a6", s("prompt"), "a6", s("a cube"), "a4", s("seed"), "00");
// fixstr boundary, str8, true, float64, uint32 and a nested uint16 map.
const LONG_PROMPT = "a red cube on a white table, studio light"; // 41 bytes -> str8
const INPUT_WIDE = { prompt: LONG_PROMPT, sync_mode: true, guidance_scale: 1.5, seed: 70000, image_size: { width: 512, height: 512 } };
const INPUT_WIDE_WIRE = hex(
  "85",
  "a6", s("prompt"), "d9 29", s(LONG_PROMPT),
  "a9", s("sync_mode"), "c3",
  "ae", s("guidance_scale"), "cb 3ff8000000000000",
  "a4", s("seed"), "ce 00011170",
  "aa", s("image_size"), "82", "a5", s("width"), "cd 0200", "a6", s("height"), "cd 0200",
);
// Output with a raw image file (bin8), a negative fixint, float64 timings and an array of false.
const PNG_HEAD = "89504e47";
const OUTPUT_BINARY_WIRE = hex(
  "84",
  "a6", s("images"), "91", "84",
  "a7", s("content"), "c4 04", PNG_HEAD,
  "ac", s("content_type"), "a9", s("image/png"),
  "a5", s("width"), "01",
  "a6", s("height"), "01",
  "a4", s("seed"), "fb",
  "a7", s("timings"), "81", "a9", s("inference"), "cb 3fd0000000000000",
  "b1", s("has_nsfw_concepts"), "91", "c2",
);
// Output with a hosted URL: { images: [{ url, content_type }], seed: 0 }
const HOSTED = "https://v3.fal.media/files/zebra/out.png";
const OUTPUT_URL_WIRE = hex(
  "82",
  "a6", s("images"), "91", "82", "a3", s("url"), "d9", HOSTED.length.toString(16), s(HOSTED), "ac", s("content_type"), "a9", s("image/png"),
  "a4", s("seed"), "00",
);

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
    this.frames.push(Uint8Array.from(data));
    this.sendOptions.push(options);
    callback?.(this.sendError ?? undefined);
  }
  reply(bytes, isBinary = true) {
    this.emit("message", Buffer.from(bytes), isBinary);
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
  const connection = await connectFalRealtime({ definition: DEFINITION, credentials: { apiKey: KEY_A }, onClose, socketFactory, ...extra.args });
  return { connection, socket: sockets[0], sockets, socketFactory, onClose, reader: connection.output.getReader() };
}

const decoder = new TextDecoder();
function parseSse(chunk) {
  const text = decoder.decode(chunk);
  const match = /^(?:event: (\S+)\n)?data: (.*)\n\n$/s.exec(text);
  if (!match) throw new Error(`not one SSE event: ${text}`);
  return { event: match[1] ?? "message", data: JSON.parse(match[2]) };
}
async function drain(reader) {
  const events = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return events;
    events.push(parseSse(value));
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------------
// Staging state (pre-registration only). This block is the ONLY place that
// asserts the transport is unregistered. The registration change replaces it
// with positive identity assertions; no other block depends on it.
// -------------------------------------------------------------------------
describe("staging state (pre-registration only)", () => {
  it("is staged and unregistered on the shared fal-ai provider", () => {
    const registration = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-fal-realtime/registration.json", import.meta.url), "utf8"));
    expect(registration.status).toBe("staged-unregistered");
    expect(falRegistry.serviceKinds).not.toContain("realtime");
    expect(falRegistry.realtimeConfig).toBeUndefined();
    for (const file of ["open-sse/handlers/realtimeCore.js", "open-sse/handlers/nativeRealtimeRelay.js", "open-sse/providers/registry/fal-ai.js"]) {
      expect(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")).not.toContain("native-fal-realtime");
    }
  });
});

describe("metadata and registration contract", () => {
  it("reuses the canonical fal-ai provider id, alias and API-key auth", () => {
    expect(FAL_REALTIME_PROVIDER_ID).toBe(falRegistry.id);
    expect(FAL_REALTIME_PROVIDER_ALIASES).toEqual(falRegistry.aliases);
    expect(falRegistry.authType).toBe("apikey");
    expect(FAL_REALTIME_ORIGIN).toBe("wss://fal.run");
    expect(FAL_DOCUMENTED_REALTIME_ENDPOINTS).toEqual([ENDPOINT]);
    expect(FAL_REALTIME_PROVIDER_METADATA).toMatchObject({ id: "fal-ai", transport: "realtime", wireFormat: "msgpack", realtimeConfig: { baseUrl: "wss://fal.run" } });
    expect(Object.isFrozen(FAL_REALTIME_LIMITS)).toBe(true);
    expect(FAL_REALTIME_LIMITS).toMatchObject({ handshakeTimeoutMs: 15_000, maxFrameBytes: 32 * 1024 * 1024, maxSendBufferBytes: 1024 * 1024 });
  });

  it("documents every export and the source in registration.json", () => {
    const registration = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-fal-realtime/registration.json", import.meta.url), "utf8"));
    expect(registration.issue).toBe("#2034");
    expect(registration.source).toMatchObject({ repository: "OmniRoute", commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad" });
    expect(registration.source.files).toEqual(expect.arrayContaining(["src/lib/fal/dispatch.ts", "open-sse/handlers/fal/realtime.ts", "open-sse/config/falEndpoint.ts"]));
    expect(registration.provider.canonicalId).toBe("fal-ai");
    for (const name of ["connectFalRealtime", "encodeMsgpack", "decodeMsgpack", "compileFalRealtimeInput", "falRealtimePath", "FAL_REALTIME_LIMITS"]) {
      expect(bundle[name]).toBeDefined();
      expect(JSON.stringify(registration.exports)).toContain(name);
    }
    // Provider-specific transport only: OpenAI Realtime and chat bridges are declared out of scope.
    expect(registration.transport.name).toBe("realtime");
    expect(registration.transport.url).toBe("wss://fal.run/{endpoint_id}{path}");
    expect(registration.provider.notCovered.join("\n")).toMatch(/OpenAI Realtime/);
    expect(registration.provider.notCovered.join("\n")).toMatch(/chat-backed/);
    expect(registration.publicHandlerIntegration.map((entry) => entry.file).join("\n")).not.toMatch(/v1\/realtime(?!\/)|realtimeCore|nativeRealtimeRelay/);
  });
});

describe("path selection (source falRealtimePath)", () => {
  it("selects /realtime only for documented endpoints", () => {
    expect(falRealtimePath(DEFINITION)).toBe(PATH);
    expect(falRealtimeUrl(DEFINITION)).toBe(URL_A);
    expect(falRealtimePath({ endpoint_id: "fal-ai/any-llm", openapi: {} })).toBeNull();
    expect(() => falRealtimeUrl({ endpoint_id: "fal-ai/any-llm", openapi: {} })).toThrow(/no documented realtime/);
  });

  it("honors a schema x-fal-realtime.path and refuses malformed ones", () => {
    expect(falRealtimePath(withOverride({ path: "/ws/v2" }, "acme/app"))).toBe("acme/app/ws/v2");
    for (const path of ["realtime", "/../x", "//x", "/a//b", "/x?y=1", "/x#y", "/x.y", "/%2e%2e", `/${"a".repeat(201)}`]) {
      expect(() => falRealtimePath(withOverride({ path }))).toThrow(FalRealtimeError);
    }
  });

  it("refuses endpoint ids that are not owner/app[/subpath]", () => {
    for (const id of ["fast-lcm", "fal-ai/../x", "fal-ai/./x", "/fal-ai/x", "fal-ai/x/", "fal ai/x", "fal-ai/x?y", "wss://fal.run/x", "a/" + "b".repeat(300), 42, null]) {
      expect(() => canonicalFalRealtimeEndpoint(id)).toThrow(/owner\/app/);
    }
    expect(canonicalFalRealtimeEndpoint("fal-ai/flux/v1.1")).toBe("fal-ai/flux/v1.1");
    expect(() => falRealtimePath({ endpoint_id: ENDPOINT })).toThrow(/OpenAPI/);
  });
});

describe("input schema (source compileFalInput realtime)", () => {
  const validate = compileFalRealtimeInput(DEFINITION);

  it("accepts the source's documented input unchanged", () => {
    const input = { prompt: "a cube", sync_mode: true, image_url: IMAGE, seed: 0 };
    expect(validate(input)).toBe(input);
    expect(input).toEqual({ prompt: "a cube", sync_mode: true, image_url: IMAGE, seed: 0 });
    expect(validate({ prompt: "x", seed: null, image_size: "square" })).toBeTruthy();
    expect(validate({ prompt: "x", image_size: { width: 512, height: 768 } })).toBeTruthy();
    expect(validate({ prompt: "x", format: "png", num_images: 8, guidance_scale: 0 })).toBeTruthy();
  });

  it("refuses out-of-range, mistyped, unknown and missing fields before any send", () => {
    const base = { prompt: "a cube" };
    expect(() => validate({ ...base, num_images: 9 })).toThrow(/Invalid/);
    expect(() => validate({ ...base, image_url: false })).toThrow(/Invalid/);
    expect(() => validate({ ...base, image_url: "not a uri" })).toThrow(/URI/);
    expect(() => validate({ ...base, seed: 1.5 })).toThrow(/Invalid/);
    expect(() => validate({ ...base, format: "gif" })).toThrow(/allowed/);
    expect(() => validate({ ...base, image_size: "huge" })).toThrow(/anyOf/);
    expect(() => validate({ ...base, image_size: { width: 0, height: 1 } })).toThrow(/anyOf/);
    expect(() => validate({ ...base, guidance_scale: 21 })).toThrow(/<= 20/);
    expect(() => validate({ ...base, account_field: false })).toThrow(/Unsupported fal input: account_field/);
    expect(() => validate({ seed: 1 })).toThrow(/prompt is required/);
    expect(() => validate([base])).toThrow(/must be an object/);
    expect(() => validate(null)).toThrow(/must be an object/);
    try {
      validate({ ...base, num_images: 9 });
    } catch (error) {
      expect(error).toBeInstanceOf(FalRealtimeError);
      expect(error.status).toBe(400);
    }
  });

  it("requires an explicit input_schema once a realtime override exists", () => {
    expect(() => compileFalRealtimeInput(withOverride({ path: "/realtime" }))).toThrow(/No verified realtime input schema/);
    expect(() => compileFalRealtimeInput(withOverride({ path: "/realtime" }, "acme/app"))).toThrow(/No verified realtime input schema/);
    const upgraded = withOverride({
      path: "/realtime",
      input_schema: { type: "object", properties: { account_field: { type: "boolean" }, mode: { $ref: "#/components/schemas/Mode" } }, required: ["account_field"] },
    });
    upgraded.openapi.components = { schemas: { Mode: { type: "string", enum: ["a", "b"] } } };
    const check = compileFalRealtimeInput(upgraded);
    expect(check({ account_field: false, mode: "a" })).toEqual({ account_field: false, mode: "a" });
    expect(() => check({ account_field: false, mode: "c" })).toThrow(/allowed/);
    expect(() => check({ account_field: false, prompt: "x" })).toThrow(/Unsupported/);
    expect(() => compileFalRealtimeInput(DEFINITION)({ account_field: false })).toThrow(/Unsupported/);
    expect(falRealtimeInputSchema(upgraded).path).toBe(PATH);
  });

  it("refuses external or unresolved references", () => {
    const external = withOverride({ input_schema: { type: "object", properties: { a: { $ref: "https://evil.example/x.json" } } } }, "acme/app");
    external.openapi["x-fal-realtime"].path = "/realtime";
    expect(() => compileFalRealtimeInput(external)({ a: 1 })).toThrow(/External/);
    const missing = withOverride({ path: "/realtime", input_schema: { type: "object", properties: { a: { $ref: "#/components/schemas/Nope" } } } }, "acme/app");
    expect(() => compileFalRealtimeInput(missing)({ a: 1 })).toThrow(/Unresolved/);
  });
});

describe("MessagePack wire contract", () => {
  it("encodes inputs to the exact wire bytes", () => {
    expect(toHex(encodeMsgpack(INPUT_SMALL))).toBe(toHex(INPUT_SMALL_WIRE));
    expect(toHex(encodeMsgpack(INPUT_WIDE))).toBe(toHex(INPUT_WIDE_WIRE));
  });

  it("decodes the wire fixtures", () => {
    expect(decodeMsgpack(INPUT_SMALL_WIRE)).toEqual(INPUT_SMALL);
    expect(decodeMsgpack(INPUT_WIDE_WIRE)).toEqual(INPUT_WIDE);
    const binary = decodeMsgpack(OUTPUT_BINARY_WIRE);
    expect(binary.images[0].content).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(decodeMsgpack(Buffer.from(OUTPUT_BINARY_WIRE)).images[0].content)).toBe(false);
    expect(toHex(binary.images[0].content)).toBe(PNG_HEAD);
    expect(binary).toMatchObject({ seed: -5, timings: { inference: 0.25 }, has_nsfw_concepts: [false] });
    expect(decodeMsgpack(OUTPUT_URL_WIRE)).toEqual({ images: [{ url: HOSTED, content_type: "image/png" }], seed: 0 });
  });

  it("chooses the smallest integer and length forms", () => {
    const cases = [
      [127, "7f"], [128, "cc80"], [256, "cd0100"], [65536, "ce00010000"], [2 ** 32, "cf0000000100000000"],
      [-1, "ff"], [-32, "e0"], [-33, "d0df"], [-129, "d1ff7f"], [-32769, "d2ffff7fff"], [-(2 ** 31) - 1, "d3ffffffff7fffffff"],
      [0.5, "cb3fe0000000000000"], [null, "c0"], [undefined, "c0"], [false, "c2"], [true, "c3"],
      ["", "a0"], ["x".repeat(31), "bf" + s("x".repeat(31))], ["x".repeat(32), "d920" + s("x".repeat(32))],
      ["x".repeat(256), "da0100" + s("x".repeat(256))], ["é", "a2c3a9"],
      [new Uint8Array([1, 2]), "c4020102"], [new Uint8Array(256).buffer, "c50100" + "00".repeat(256)],
      [[], "90"], [new Array(16).fill(0), "dc0010" + "00".repeat(16)], [{}, "80"],
    ];
    for (const [value, wire] of cases) expect(toHex(encodeMsgpack(value)), String(value)).toBe(wire);
    const map16 = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i.toString(16)}`, i]));
    expect(toHex(encodeMsgpack(map16)).slice(0, 6)).toBe("de0010");
    expect(decodeMsgpack(encodeMsgpack(map16))).toEqual(map16);
  });

  it("decodes every other standard family", () => {
    expect(decodeMsgpack(hex("ca 3fc00000"))).toBe(1.5);
    expect(decodeMsgpack(hex("cf 0000000000000100"))).toBe(256);
    expect(decodeMsgpack(hex("d3 ffffffffffffff00"))).toBe(-256);
    expect(decodeMsgpack(hex("da 0002", s("hi")))).toBe("hi");
    expect(decodeMsgpack(hex("db 00000002", s("hi")))).toBe("hi");
    expect(decodeMsgpack(hex("dd 00000001 c0"))).toEqual([null]);
    expect(decodeMsgpack(hex("df 00000001 a1", s("a"), "01"))).toEqual({ a: 1 });
    expect(decodeMsgpack(hex("81 07 a1", s("n")))).toEqual({ 7: "n" });
    expect(decodeMsgpack(hex("c6 00000001 ff"))).toEqual(new Uint8Array([255]));
    expect(decodeMsgpack(hex("d6 ff 00000001")).getTime()).toBe(1000);
    expect(decodeMsgpack(hex("d7 ff 00000000 00000002")).getTime()).toBe(2000);
    expect(decodeMsgpack(hex("c7 0c ff 00000000 0000000000000003")).getTime()).toBe(3000);
    const proto = decodeMsgpack(hex("81 a9", s("__proto__"), "01"));
    expect(Object.hasOwn(proto, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(proto)).toBe(Object.prototype);
  });

  it("refuses malformed or unbounded frames before allocating", () => {
    const bad = [
      "", "c1", "0000", "a561", "dc0005c0", "dd ffffffff", "df ffffffff", "c6 ffffffff 00", "db ffffffff",
      "cf ffffffffffffffff", "d3 8000000000000000", "d4 05 00", "c7 02 01 0000", "d6 ff 0000", "81 c0 01",
      "82 a161 01 a161 02", "a1ff", "81 91 c0 01",
    ];
    for (const wire of bad) expect(() => decodeMsgpack(hex(wire)), wire).toThrow(TypeError);
    expect(() => decodeMsgpack(hex("91".repeat(65), "c0"))).toThrow(/deeply/);
    expect(decodeMsgpack(hex("91".repeat(64), "c0"))).toBeTruthy();
    expect(() => decodeMsgpack("82")).toThrow(/bytes/);
  });

  it("refuses values that are not JSON-like or bytes", () => {
    for (const value of [() => 1, Symbol("x"), 1n, new Date(0), new Map(), new Int16Array(2), new (class Foo {})()]) {
      expect(() => encodeMsgpack(value)).toThrow(TypeError);
    }
    let deep = 0;
    for (let i = 0; i < 70; i++) deep = [deep];
    expect(() => encodeMsgpack(deep)).toThrow(/deeply/);
    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => encodeMsgpack(cyclic)).toThrow(/deeply/);
  });
});

describe("auth and handshake", () => {
  it("opens wss://fal.run/{path} with the selected key as a header only", async () => {
    const { socket, socketFactory, connection } = await connect();
    expect(socketFactory).toHaveBeenCalledTimes(1);
    expect(socket.url).toBe(URL_A);
    expect(socket.url).not.toContain(KEY_A);
    expect(socket.options).toMatchObject({
      headers: { Authorization: `Key ${KEY_A}` },
      followRedirects: false,
      handshakeTimeout: 15_000,
      maxPayload: 32 * 1024 * 1024,
    });
    expect(socket.options.agent).toBeUndefined();
    expect(connection.path).toBe(PATH);
    connection.close();
  });

  it("selects apiKey, else accessToken, and refuses a missing key before any socket", async () => {
    expect(falRealtimeToken({ apiKey: KEY_A, accessToken: KEY_B })).toBe(KEY_A);
    expect(falRealtimeToken({ accessToken: KEY_B })).toBe(KEY_B);
    expect(falRealtimeToken({ apiKey: "  " })).toBe("");
    expect(falRealtimeToken(null)).toBe("");
    const b = await connect({ args: { credentials: { accessToken: KEY_B } } });
    expect(b.socket.options.headers.Authorization).toBe(`Key ${KEY_B}`);
    b.connection.close();
    const { socketFactory } = factory();
    for (const credentials of [{}, { apiKey: "" }, { apiKey: 7 }, undefined]) {
      await expect(connectFalRealtime({ definition: DEFINITION, credentials, socketFactory })).rejects.toMatchObject({ status: 401 });
    }
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it("validates the definition before using the key or opening a socket", async () => {
    const { socketFactory } = factory();
    await expect(connectFalRealtime({ definition: { endpoint_id: "fal-ai/any-llm", openapi: {} }, credentials: { apiKey: KEY_A }, socketFactory })).rejects.toMatchObject({ status: 400 });
    await expect(connectFalRealtime({ definition: withOverride({ path: "/realtime" }), credentials: { apiKey: KEY_A }, socketFactory })).rejects.toMatchObject({ status: 400 });
    await expect(connectFalRealtime({ definition: withOverride({ path: "/../x" }), credentials: { apiKey: KEY_A }, socketFactory })).rejects.toMatchObject({ status: 400 });
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it("routes through an HTTP(S) proxy agent and refuses other proxies before any socket", async () => {
    const agent = { synthetic: true };
    const agentFactory = vi.fn(async () => agent);
    const a = await connect({ args: { proxyUrl: "http://127.0.0.1:3128", agentFactory } });
    expect(agentFactory).toHaveBeenCalledWith("http://127.0.0.1:3128");
    expect(a.socket.options.agent).toBe(agent);
    a.connection.close();
    const { socketFactory } = factory();
    for (const proxyUrl of ["socks5://127.0.0.1:1080", "ftp://x", "not a url"]) {
      await expect(connectFalRealtime({ definition: DEFINITION, credentials: { apiKey: KEY_A }, socketFactory, proxyUrl, agentFactory })).rejects.toMatchObject({ status: 409 });
    }
    await expect(connectFalRealtime({ definition: DEFINITION, credentials: { apiKey: KEY_A }, socketFactory, proxyUrl: "http://p", agentFactory: async () => { throw new Error(KEY_A); } })).rejects.toMatchObject({ status: 502, message: "Fal WebSocket proxy unavailable" });
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it("times out a handshake that never opens, terminating the socket once", async () => {
    vi.useFakeTimers();
    const { sockets, socketFactory } = factory({ autoOpen: false });
    const onClose = vi.fn();
    const pending = connectFalRealtime({ definition: DEFINITION, credentials: { apiKey: KEY_A }, socketFactory, onClose, limits: { handshakeTimeoutMs: 50 } });
    const outcome = expect(pending).rejects.toMatchObject({ status: 504, message: "Fal WebSocket handshake timed out" });
    await vi.advanceTimersByTimeAsync(49);
    expect(sockets[0].terminated).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(sockets[0].terminated).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    sockets[0].open(); // a late open changes nothing
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rejects an error or close before open with a fixed message", async () => {
    for (const event of ["error", "close"]) {
      const { sockets, socketFactory } = factory({ autoOpen: false });
      const onClose = vi.fn();
      const pending = connectFalRealtime({ definition: DEFINITION, credentials: { apiKey: KEY_A }, socketFactory, onClose });
      await flush();
      sockets[0].emit(event, Object.assign(new Error(`upstream said ${KEY_A}`), { code: "ECONNRESET" }));
      const error = await pending.catch((e) => e);
      expect(error).toBeInstanceOf(FalRealtimeError);
      expect(error.status).toBe(502);
      expect(error.message).toBe(event === "error" ? "Fal WebSocket connection failed" : "Fal WebSocket connection closed");
      expect(JSON.stringify({ ...error, message: error.message })).not.toContain(KEY_A);
      expect(sockets[0].terminated).toBe(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it("aborts before and during the handshake", async () => {
    const { socketFactory } = factory();
    const before = new AbortController();
    before.abort();
    await expect(connectFalRealtime({ definition: DEFINITION, credentials: { apiKey: KEY_A }, socketFactory, signal: before.signal })).rejects.toMatchObject({ status: 499 });
    expect(socketFactory).not.toHaveBeenCalled();

    const late = factory({ autoOpen: false });
    const during = new AbortController();
    const onClose = vi.fn();
    const pending = connectFalRealtime({ definition: DEFINITION, credentials: { apiKey: KEY_A }, socketFactory: late.socketFactory, signal: during.signal, onClose });
    await flush();
    during.abort();
    await expect(pending).rejects.toMatchObject({ status: 499, message: "Fal WebSocket aborted" });
    expect(late.sockets[0].terminated).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("session: send, events and binary mapping", () => {
  it("sends each validated input as one binary MessagePack frame (source contract)", async () => {
    const { connection, socket } = await connect();
    const input = { prompt: "a cube", sync_mode: true, image_url: IMAGE, seed: 0 };
    connection.send(input);
    connection.send({ ...input, prompt: "later image" });
    expect(socket.frames).toHaveLength(2);
    expect(decodeMsgpack(socket.frames[0])).toEqual(input);
    expect(decodeMsgpack(socket.frames[1])).toEqual({ ...input, prompt: "later image" });
    expect(socket.sendOptions[0]).toEqual({ binary: true });
    connection.send(INPUT_SMALL);
    expect(toHex(socket.frames[2])).toBe(toHex(INPUT_SMALL_WIRE));
    connection.close();
  });

  it("refuses invalid input without sending", async () => {
    const { connection, socket } = await connect();
    expect(() => connection.send({ prompt: "x", num_images: 9 })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => connection.send({ prompt: "x", account_field: 1 })).toThrow(/Unsupported/);
    expect(() => connection.send("prompt")).toThrow(/object/);
    expect(socket.frames).toHaveLength(0);
    connection.close();
  });

  it("maps a hosted-URL output frame to a message event (source normalizeFalOutput)", async () => {
    const { connection, socket, reader } = await connect();
    connection.send(INPUT_SMALL);
    socket.reply(OUTPUT_URL_WIRE);
    const chunk = (await reader.read()).value;
    expect(decoder.decode(chunk).startsWith("data: ")).toBe(true);
    const { event, data } = parseSse(chunk);
    expect(event).toBe("message");
    expect(data).toEqual({
      artifacts: [{ path: "$.images[0]", url: HOSTED, content_type: "image/png" }],
      output: { images: [{ url: HOSTED, content_type: "image/png" }], seed: 0 },
    });
    connection.close();
  });

  it("maps raw binary files to data URIs and keeps bytes as binary_base64", async () => {
    const { connection, socket, reader } = await connect();
    socket.reply(OUTPUT_BINARY_WIRE);
    const { data } = parseSse((await reader.read()).value);
    const b64 = Buffer.from(PNG_HEAD, "hex").toString("base64");
    expect(data.artifacts).toEqual([{ content_type: "image/png", width: 1, height: 1, path: "$.images[0]", url: `data:image/png;base64,${b64}` }]);
    expect(data.output.images[0].content).toEqual({ binary_base64: b64 });
    expect(data.output).toMatchObject({ seed: -5, timings: { inference: 0.25 }, has_nsfw_concepts: [false] });
    connection.close();
  });

  it("stores binary files through the artifact hook when given", async () => {
    const artifact = vi.fn(() => "/v1/fal/artifacts/one");
    const { connection, socket, reader } = await connect({ args: { artifact } });
    socket.reply(OUTPUT_BINARY_WIRE);
    const { data } = parseSse((await reader.read()).value);
    expect(artifact).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png", "realtime-output");
    expect(toHex(artifact.mock.calls[0][0])).toBe(PNG_HEAD);
    expect(data.artifacts[0].url).toBe("/v1/fal/artifacts/one");
    connection.close();
    await expect(connectFalRealtime({ definition: DEFINITION, credentials: { apiKey: KEY_A }, artifact: "nope", socketFactory: factory().socketFactory })).rejects.toMatchObject({ status: 500 });
  });

  it("accepts fragmented and ArrayBuffer frames", async () => {
    const { connection, socket, reader } = await connect();
    socket.emit("message", [Buffer.from(OUTPUT_URL_WIRE.slice(0, 5)), Buffer.from(OUTPUT_URL_WIRE.slice(5))], true);
    expect(parseSse((await reader.read()).value).data.output.seed).toBe(0);
    socket.emit("message", OUTPUT_URL_WIRE.slice().buffer, true);
    expect(parseSse((await reader.read()).value).data.output.seed).toBe(0);
    connection.close();
  });

  it("fails the session on an undecodable frame without echoing it", async () => {
    const { connection, socket, reader, onClose } = await connect();
    socket.reply(Buffer.from(`{"error":"${KEY_A}"}`), false);
    const events = await drain(reader);
    expect(events).toEqual([{ event: "error", data: { error: "Invalid fal realtime output", status: "FAILED" } }]);
    expect(JSON.stringify(events)).not.toContain(KEY_A);
    expect(socket.terminated).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(() => connection.send(INPUT_SMALL)).toThrow(expect.objectContaining({ status: 410 }));
  });

  it("normalizes outputs without changing signed URLs", () => {
    const signed = "https://v3.fal.media/files/x.png?sig=abc&exp=1";
    expect(normalizeFalRealtimeOutput({ a: signed, b: ["data:x", "http://insecure"], c: { url: "blob:z", n: 1 } })).toEqual({
      artifacts: [{ url: signed, path: "$.a" }, { url: "data:x", path: "$.b[0]" }, { path: "$.c", url: "blob:z", n: 1 }],
      output: { a: signed, b: ["data:x", "http://insecure"], c: { url: "blob:z", n: 1 } },
    });
    expect(falRealtimeFrameEvent(OUTPUT_URL_WIRE).artifacts[0].url).toBe(HOSTED);
    expect(decoder.decode(falRealtimeSseEvent("error", { a: 1 }))).toBe('event: error\ndata: {"a":1}\n\n');
    expect(decoder.decode(falRealtimeSseEvent("message", { a: 1 }))).toBe('data: {"a":1}\n\n');
  });
});

describe("session limits", () => {
  it("refuses sends when the socket buffer is full (429) or the frame is too large (413)", async () => {
    const { connection, socket } = await connect({ args: { limits: { maxInputBytes: 64 } } });
    socket.bufferedAmount = 1024 * 1024 + 1;
    expect(() => connection.send(INPUT_SMALL)).toThrow(expect.objectContaining({ status: 429 }));
    socket.bufferedAmount = 0;
    expect(() => connection.send({ prompt: "x".repeat(100) })).toThrow(expect.objectContaining({ status: 413 }));
    expect(socket.frames).toHaveLength(0);
    connection.send(INPUT_SMALL);
    expect(socket.frames).toHaveLength(1);
    connection.close();
  });

  it("fails a frame larger than maxFrameBytes", async () => {
    const { socket, reader } = await connect({ args: { limits: { maxFrameBytes: 16 } } });
    socket.reply(OUTPUT_URL_WIRE);
    expect(await drain(reader)).toEqual([{ event: "error", data: { error: "Invalid fal realtime output", status: "FAILED" } }]);
    expect(socket.terminated).toBe(1);
  });

  it("pauses the socket when the reader falls behind and resumes on pull", async () => {
    const { connection, socket, reader } = await connect({ args: { limits: { outputHighWaterBytes: 64 } } });
    socket.reply(OUTPUT_URL_WIRE);
    expect(socket.paused).toBeGreaterThan(0);
    const resumedBefore = socket.resumed;
    await reader.read();
    await flush();
    expect(socket.resumed).toBeGreaterThan(resumedBefore);
    connection.close();
  });

  it("closes the session when unread output exceeds the queue bound", async () => {
    const { socket, reader, onClose } = await connect({ args: { limits: { outputHighWaterBytes: 64, maxQueuedOutputBytes: 400 } } });
    for (let i = 0; i < 10; i++) socket.reply(OUTPUT_URL_WIRE);
    const events = await drain(reader);
    expect(events.at(-1)).toEqual({ event: "error", data: { error: "Fal realtime output queue is full", status: "FAILED" } });
    expect(events.filter((e) => e.event === "message").length).toBeLessThan(10);
    expect(socket.terminated).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes an idle session; traffic in either direction re-arms the timer", async () => {
    vi.useFakeTimers();
    const { sockets, socketFactory } = factory({ autoOpen: false });
    const pending = connectFalRealtime({ definition: DEFINITION, credentials: { apiKey: KEY_A }, socketFactory, limits: { idleTimeoutMs: 100 } });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    const connection = await pending;
    const reader = connection.output.getReader();
    await vi.advanceTimersByTimeAsync(90);
    connection.send(INPUT_SMALL);
    await vi.advanceTimersByTimeAsync(90);
    sockets[0].reply(OUTPUT_URL_WIRE);
    await vi.advanceTimersByTimeAsync(90);
    expect(connection.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(connection.closed).toBe(true);
    vi.useRealTimers();
    const events = await drain(reader);
    expect(events.at(-1)).toEqual({ event: "error", data: { error: "Fal realtime session was idle too long", status: "IDLE_TIMEOUT" } });
    expect(sockets[0].terminated).toBe(1);
  });
});

describe("close, abort and uncertain submissions (never retried)", () => {
  it("abort with an input in flight reports SUBMISSION_UNKNOWN and ends the stream once", async () => {
    const abort = new AbortController();
    const { connection, socket, reader, onClose, socketFactory } = await connect({ args: { signal: abort.signal } });
    connection.send(INPUT_SMALL);
    abort.abort();
    const events = await drain(reader);
    expect(events).toEqual([{ event: "error", data: { error: "Fal WebSocket stopped; upstream completion is unknown", status: "SUBMISSION_UNKNOWN" } }]);
    expect(socket.terminated).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(() => connection.send(INPUT_SMALL)).toThrow(/ended/);
    expect(socket.frames).toHaveLength(1);
    expect(socketFactory).toHaveBeenCalledTimes(1);
  });

  it("abort after every input was answered ends quietly", async () => {
    const abort = new AbortController();
    const { connection, socket, reader, onClose } = await connect({ args: { signal: abort.signal } });
    connection.send(INPUT_SMALL);
    socket.reply(OUTPUT_URL_WIRE);
    abort.abort();
    const events = await drain(reader);
    expect(events.map((e) => e.event)).toEqual(["message"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an upstream close with an input in flight is reported, never reconnected or replayed", async () => {
    const { connection, socket, reader, onClose, socketFactory } = await connect();
    connection.send(INPUT_SMALL);
    socket.readyState = 3;
    socket.emit("close", 1006, Buffer.from(KEY_A));
    const events = await drain(reader);
    expect(events).toEqual([{ event: "error", data: { error: "Fal connection lost", status: "SUBMISSION_UNKNOWN" } }]);
    expect(JSON.stringify(events)).not.toContain(KEY_A);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(socketFactory).toHaveBeenCalledTimes(1);
    expect(socket.frames).toHaveLength(1);
  });

  it("a failed send callback marks the submission uncertain", async () => {
    const { connection, socket, reader } = await connect();
    socket.sendError = new Error(`write EPIPE ${KEY_A}`);
    connection.send(INPUT_SMALL);
    const events = await drain(reader);
    expect(events).toEqual([{ event: "error", data: { error: "Fal WebSocket submission is uncertain", status: "SUBMISSION_UNKNOWN" } }]);
    expect(socket.terminated).toBe(1);
  });

  it("a socket error after open fails with a fixed message", async () => {
    const { socket, reader } = await connect();
    socket.emit("error", new Error(`TLS ${KEY_A}`));
    const events = await drain(reader);
    expect(events).toEqual([{ event: "error", data: { error: "Fal WebSocket connection failed", status: "FAILED" } }]);
  });

  it("close() and reader.cancel() clean up exactly once", async () => {
    const a = await connect();
    a.connection.close();
    a.connection.close();
    a.socket.emit("close");
    expect(a.socket.terminated).toBe(1);
    expect(a.onClose).toHaveBeenCalledTimes(1);
    expect((await a.reader.read()).done).toBe(true);
    a.socket.reply(OUTPUT_URL_WIRE); // late frames are dropped

    const b = await connect();
    await b.reader.cancel();
    expect(b.socket.terminated).toBe(1);
    expect(b.onClose).toHaveBeenCalledTimes(1);
    expect(() => b.connection.send(INPUT_SMALL)).toThrow(expect.objectContaining({ status: 410 }));
  });
});

describe("two connections", () => {
  it("keep separate sockets, keys, inputs, outputs and lifecycles", async () => {
    const { sockets, socketFactory } = factory();
    const closes = [vi.fn(), vi.fn()];
    const a = await connectFalRealtime({ definition: DEFINITION, credentials: { apiKey: KEY_A }, socketFactory, onClose: closes[0] });
    const b = await connectFalRealtime({ definition: withOverride({ path: "/rt", input_schema: { type: "object", properties: { q: { type: "string" } } } }, "acme/app"), credentials: { apiKey: KEY_B }, socketFactory, onClose: closes[1] });
    expect(sockets).toHaveLength(2);
    expect(sockets[0].url).toBe(URL_A);
    expect(sockets[1].url).toBe("wss://fal.run/acme/app/rt");
    expect(sockets[0].options.headers.Authorization).toBe(`Key ${KEY_A}`);
    expect(sockets[1].options.headers.Authorization).toBe(`Key ${KEY_B}`);

    a.send(INPUT_SMALL);
    b.send({ q: "hi" });
    expect(() => b.send(INPUT_SMALL)).toThrow(/Unsupported/);
    expect(decodeMsgpack(sockets[0].frames[0])).toEqual(INPUT_SMALL);
    expect(sockets[1].frames.map((f) => decodeMsgpack(f))).toEqual([{ q: "hi" }]);

    const ra = a.output.getReader();
    const rb = b.output.getReader();
    sockets[1].reply(encodeMsgpack({ text: "for b" }));
    sockets[0].reply(OUTPUT_URL_WIRE);
    expect(parseSse((await ra.read()).value).data.output.seed).toBe(0);
    expect(parseSse((await rb.read()).value).data.output).toEqual({ text: "for b" });

    a.close();
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(closes[1]).not.toHaveBeenCalled();
    expect(sockets[1].terminated).toBe(0);
    b.send({ q: "still open" });
    expect(sockets[1].frames).toHaveLength(2);
    b.close();
    expect(closes[1]).toHaveBeenCalledTimes(1);
  });
});
