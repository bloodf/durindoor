// Native fal realtime transport: one schema-selected `wss://fal.run/{path}`
// session per call, MessagePack in both directions, the selected connection's
// key kept server-side. Staged and NOT registered (see ./registration.json).
// This is the provider's own realtime protocol, not a chat-backed text bridge
// and not OpenAI Realtime.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/fal/realtime.ts (connectFalRealtime: socket at
// `wss://fal.run/{falRealtimePath}`; `send(input)` writes `encode(input)`;
// every inbound frame is `decode`d, normalized with normalizeFalOutput, binary
// file objects (`content` bytes + `content_type`) become artifacts with a data
// URI or a stored-artifact URL, and remaining bytes are rendered as
// `{ binary_base64 }`; a frame that does not decode fails the session with
// "Invalid fal realtime output"), open-sse/handlers/fal/output.ts
// (normalizeFalOutput: `https://`, `data:` and `blob:` strings and `url`
// fields are listed as artifacts with their JSON path, values unchanged),
// src/lib/fal/realtime.ts (sendFalRealtime validates each message with the
// compiled realtime schema before it is sent) and src/lib/fal/runtime.ts
// (the token is `apiKey || accessToken` of the selected connection).
//
// Fork deviations: validation happens inside `send` (the source does it in
// the session registry); the encoded frame is size-bounded; the session's
// limits come from ./config.js; the MessagePack codec is ./msgpack.js.
import { isFunction, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { decodeMsgpack, encodeMsgpack } from "./msgpack.js";
import { FalRealtimeError, compileFalRealtimeInput, falRealtimeUrl } from "./schema.js";
import { openFalRealtimeSocket } from "./socket.js";

const FILE_URL_RE = /^(https:\/\/|data:|blob:)/;

/** The selected connection's key (source runtime.ts), or "" when none. */
export function falRealtimeToken(credentials) {
  const token = credentials?.apiKey || credentials?.accessToken;
  return isString(token) ? token.trim() : "";
}

/** Native output plus every downloadable file, values unchanged (source normalizeFalOutput). */
export function normalizeFalRealtimeOutput(payload) {
  const artifacts = [];
  const visit = (value, path) => {
    if (isString(value)) {
      if (FILE_URL_RE.test(value)) artifacts.push({ url: value, path });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }
    if (!isRecord(value) || value instanceof Uint8Array) return;
    if (isString(value.url) && FILE_URL_RE.test(value.url)) artifacts.push({ path, ...value });
    for (const [key, item] of Object.entries(value)) if (key !== "url") visit(item, `${path}.${key}`);
  };
  visit(payload, "$");
  return { artifacts, output: payload };
}

function binaryFiles(value, path, artifacts, artifact) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => binaryFiles(item, `${path}[${i}]`, artifacts, artifact));
    return;
  }
  if (!isRecord(value) || value instanceof Uint8Array) return;
  if (value.content instanceof Uint8Array && isString(value.content_type)) {
    const name = isString(value.file_name) ? value.file_name : "realtime-output";
    const url = artifact
      ? artifact(value.content, value.content_type, name)
      : `data:${value.content_type};base64,${Buffer.from(value.content).toString("base64")}`;
    artifacts.push({ ...value, content: undefined, path, url });
  }
  for (const [key, item] of Object.entries(value)) if (key !== "content") binaryFiles(item, `${path}.${key}`, artifacts, artifact);
}

/**
 * The JSON event for one inbound frame (source realtimeOutput): `{ artifacts,
 * output }` with binary values as `{ binary_base64 }`.
 *
 * @throws when the frame is not one valid MessagePack value
 */
export function falRealtimeFrameEvent(bytes, artifact) {
  const payload = decodeMsgpack(bytes);
  const normalized = normalizeFalRealtimeOutput(payload);
  binaryFiles(payload, "$", normalized.artifacts, artifact);
  // Keep native binary values alongside usable file downloads.
  // The raw holder value is checked so a Buffer's toJSON never wins.
  return JSON.parse(JSON.stringify(normalized, function binary(key, value) {
    const raw = this[key];
    return raw instanceof Uint8Array ? { binary_base64: Buffer.from(raw).toString("base64") } : value;
  }));
}

/**
 * Open one native fal realtime session for a discovered (or documented)
 * endpoint definition, with the selected connection's key.
 *
 * @param {object} args
 * @param {{ endpoint_id: string, openapi: object }} args.definition
 * @param {{ apiKey?: string, accessToken?: string }} args.credentials - the selected connection
 * @param {AbortSignal} [args.signal]
 * @param {() => void} [args.onClose]
 * @param {(bytes: Uint8Array, type: string, name: string) => string} [args.artifact] - stores binary files, returns their URL
 * @param {string|null} [args.proxyUrl] - HTTP(S) proxy resolved for https://fal.run; others are refused (409)
 * @param {Function} [args.agentFactory]
 * @param {Function} [args.socketFactory] - `(url, options) => ws-like socket`; tests use synthetic sockets
 * @param {object} [args.limits] - overrides of FAL_REALTIME_LIMITS
 * @returns {Promise<{ output: ReadableStream<Uint8Array>, send(input: object): void, close(): void, path: string, readonly closed: boolean }>}
 * @throws {FalRealtimeError} with an HTTP `status`, before any socket for 400/401/409
 */
export async function connectFalRealtime({ definition, credentials, signal, onClose, artifact, proxyUrl = null, agentFactory, socketFactory, limits }) {
  const url = falRealtimeUrl(definition);
  const validate = compileFalRealtimeInput(definition);
  const token = falRealtimeToken(credentials);
  if (!token) throw new FalRealtimeError("Fal API key is required", 401);
  if (artifact !== undefined && !isFunction(artifact)) throw new FalRealtimeError("Invalid fal artifact store", 500);
  const session = await openFalRealtimeSocket({
    url,
    token,
    signal,
    onClose,
    proxyUrl,
    agentFactory,
    socketFactory,
    limits,
    onFrame: (bytes) => ({ event: "message", data: falRealtimeFrameEvent(bytes, artifact) }),
  });
  return {
    path: url.slice("wss://fal.run/".length),
    output: session.output,
    close: session.close,
    get closed() { return session.closed; },
    /** Validate, encode and send one input; throws 400/410/413/429 without sending. */
    send(input) {
      if (session.closed) throw new FalRealtimeError("Fal WebSocket session has ended or expired", 410);
      let frame;
      try {
        frame = encodeMsgpack(validate(input));
      } catch (error) {
        if (error instanceof FalRealtimeError) throw error;
        throw new FalRealtimeError("Invalid fal input: not encodable", 400);
      }
      session.send(frame);
    },
  };
}
