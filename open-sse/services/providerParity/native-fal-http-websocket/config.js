// fal.ai HTTP over WebSockets: provider metadata and limits for the staged,
// unregistered transport in ./httpWebsocket.js. Production code imports
// nothing here yet; see ./registration.json for the serial registration change.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/fal/httpWebsocket.ts (`wss://ws.fal.run/{endpoint}`),
// open-sse/handlers/fal/socket.ts (FalSocket: `Authorization: Key <token>`,
// followRedirects false, handshakeTimeout 15 s, maxPayload 32 MiB, send buffer
// 1 MiB), open-sse/handlers/fal/httpWebsocketReply.ts (32 MiB response body),
// open-sse/handlers/fal/events.ts (8 MiB SSE event buffer) and
// src/lib/fal/dispatch.ts (proxy resolved for https://ws.fal.run, invocation
// deadline from the configured upstream timeout, 120 s unless overridden).

/** The canonical provider id: the existing `fal-ai` API-key connection. */
export const FAL_HTTP_WEBSOCKET_PROVIDER_ID = "fal-ai";
/** Aliases of that provider in open-sse/providers/registry/fal-ai.js. */
export const FAL_HTTP_WEBSOCKET_PROVIDER_ALIASES = Object.freeze(["fal"]);
/** The source's transport name (open-sse/handlers/fal/schema.ts FalTransport). */
export const FAL_HTTP_WEBSOCKET_TRANSPORT = "http-websocket";
/** Every HTTP-WebSocket session goes to this origin and nowhere else. */
export const FAL_HTTP_WEBSOCKET_ORIGIN = "wss://ws.fal.run";
/** Origin the connection proxy is resolved for (source dispatch.ts openSocket). */
export const FAL_HTTP_WEBSOCKET_PROXY_ORIGIN = "https://ws.fal.run";

/**
 * Bounds of one HTTP-WebSocket session. Handshake, frame, send buffer,
 * response body and SSE buffer are the source's; the rest are fork additions
 * (the source has no input-size cap, output-queue cap or idle timer, and its
 * invocation deadline comes from the route's configured timeout).
 */
export const FAL_HTTP_WEBSOCKET_LIMITS = Object.freeze({
  handshakeTimeoutMs: 15_000,
  maxFrameBytes: 32 * 1024 * 1024,
  maxSendBufferBytes: 1024 * 1024,
  maxResponseBytes: 32 * 1024 * 1024,
  maxEventBytes: 8 * 1024 * 1024,
  maxInputBytes: 8 * 1024 * 1024,
  invocationTimeoutMs: 120_000,
  outputHighWaterBytes: 1024 * 1024,
  maxQueuedOutputBytes: 64 * 1024 * 1024,
  idleTimeoutMs: 120_000,
});

/** Catalog metadata the registration change adds to the `fal-ai` provider. */
export const FAL_HTTP_WEBSOCKET_PROVIDER_METADATA = Object.freeze({
  id: FAL_HTTP_WEBSOCKET_PROVIDER_ID,
  aliases: FAL_HTTP_WEBSOCKET_PROVIDER_ALIASES,
  transport: FAL_HTTP_WEBSOCKET_TRANSPORT,
  authType: "apikey",
  authHeader: "Authorization: Key <apiKey>",
  wireFormat: "json-http",
  httpWebsocketConfig: Object.freeze({ baseUrl: FAL_HTTP_WEBSOCKET_ORIGIN }),
  endpoints: Object.freeze({
    connect: "GET wss://ws.fal.run/{owner}/{app}[/subpath] (WebSocket upgrade)",
    input: "text frame: one JSON input object, validated with the endpoint's direct HTTP schema",
    output: "text frame {type:\"start\",request_id,status,headers}, raw body frames, text frame {type:\"end\",request_id,status,...}",
  }),
});
