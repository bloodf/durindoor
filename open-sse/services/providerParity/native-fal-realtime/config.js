// fal.ai native realtime WebSocket: provider metadata and limits for the
// staged, unregistered transport in ./realtime.js. Production code imports
// nothing here yet; see ./registration.json for the serial registration change.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/falEndpoint.ts (DOCUMENTED_REALTIME, falRealtimePath,
// canonicalFalEndpoint), open-sse/handlers/fal/realtime.ts (connectFalRealtime:
// `wss://fal.run/{path}`) and open-sse/handlers/fal/socket.ts (FalSocket:
// `Authorization: Key <token>`, followRedirects false, handshakeTimeout 15 s,
// maxPayload 32 MiB, send buffer 1 MiB).

/** The canonical provider id: the existing `fal-ai` API-key connection. */
export const FAL_REALTIME_PROVIDER_ID = "fal-ai";
/** Aliases of that provider in open-sse/providers/registry/fal-ai.js. */
export const FAL_REALTIME_PROVIDER_ALIASES = Object.freeze(["fal"]);
/** The source's transport name (open-sse/handlers/fal/schema.ts FalTransport). */
export const FAL_REALTIME_TRANSPORT = "realtime";
/** Every realtime socket goes to this origin and nowhere else. */
export const FAL_REALTIME_ORIGIN = "wss://fal.run";
/** Origin the connection proxy is resolved for (source dispatch.ts openSocket). */
export const FAL_REALTIME_PROXY_ORIGIN = "https://fal.run";

/** Endpoints whose `/realtime` path is documented by fal's realtime guide (source DOCUMENTED_REALTIME). */
export const FAL_DOCUMENTED_REALTIME_ENDPOINTS = Object.freeze(["fal-ai/fast-lcm-diffusion"]);

/**
 * Bounds of one realtime session. The handshake, frame and send-buffer
 * values are the source's; the rest are fork additions (the source has no
 * idle timer, output-queue cap or input-size cap).
 */
export const FAL_REALTIME_LIMITS = Object.freeze({
  handshakeTimeoutMs: 15_000,
  maxFrameBytes: 32 * 1024 * 1024,
  maxSendBufferBytes: 1024 * 1024,
  maxInputBytes: 8 * 1024 * 1024,
  outputHighWaterBytes: 1024 * 1024,
  maxQueuedOutputBytes: 64 * 1024 * 1024,
  idleTimeoutMs: 120_000,
});

/** Catalog metadata the registration change adds to the `fal-ai` provider. */
export const FAL_REALTIME_PROVIDER_METADATA = Object.freeze({
  id: FAL_REALTIME_PROVIDER_ID,
  aliases: FAL_REALTIME_PROVIDER_ALIASES,
  transport: FAL_REALTIME_TRANSPORT,
  authType: "apikey",
  authHeader: "Authorization: Key <apiKey>",
  wireFormat: "msgpack",
  realtimeConfig: Object.freeze({ baseUrl: FAL_REALTIME_ORIGIN }),
  documentedEndpoints: FAL_DOCUMENTED_REALTIME_ENDPOINTS,
  endpoints: Object.freeze({
    connect: "GET wss://fal.run/{owner}/{app}[/subpath]{x-fal-realtime.path | /realtime} (WebSocket upgrade)",
    input: "binary MessagePack frame: one schema-validated input object",
    output: "binary MessagePack frame: one output object (binary file content as bin)",
  }),
});
