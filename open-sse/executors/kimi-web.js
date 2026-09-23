/**
 * KimiWebExecutor — Moonshot AI Chat via www.kimi.com (international)
 *
 * Routes requests through Kimi's consumer chat API on the international domain.
 * The www.kimi.com surface uses Connect-RPC over HTTP:
 *   - POST /apiv2/kimi.gateway.chat.v1.ChatService/Chat
 *   - 5-byte envelope (flags + 4-byte length) + JSON payload
 *   - Auth: `Authorization: Bearer <access_token>`
 *
 * Credentials: Kimi's web app keeps its session in localStorage
 * (`access_token` + `refresh_token`) and sends only the Bearer header; the old
 * `kimi-auth` cookie is no longer how the SPA authenticates. The user pastes
 * the JSON the registry `authSnippet` copies; a bare token or a legacy Cookie
 * header with `kimi-auth=` still parses (see `extractKimiTokens`). Only the
 * access token reaches the wire. On a 401, `refreshCredentials` trades the
 * refresh token at AuthService/RefreshToken on the auth host, the same call the
 * SPA makes, and chatCore retries once with the new access token.
 *
 * Kimi serves two deployments, www.kimi.com and the international www.kimi.ai,
 * each with its own auth host. The snippet records `location.origin`, and all
 * calls go to that origin; pastes without one (legacy cookies, bare tokens)
 * use www.kimi.com.
 */
import { BaseExecutor } from "./base.js";
import { errorResponse, sanitizeErrorMessage } from "../utils/error.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { createHash } from "node:crypto";
import { extractKimiJwt, extractKimiTokens, KIMI_WEB_ORIGINS } from "@/lib/providers/webCookieAuth";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { stripThinkingSuffix } from "../translator/concerns/thinkingSuffix.js";

export { extractKimiJwt };

const BASE_URL = KIMI_WEB_ORIGINS[0];
const CHAT_PATH = "/apiv2/kimi.gateway.chat.v1.ChatService/Chat";

/**
 * The SPA's refresh call: AUTH_API_HOST ("https://auth." + site domain) +
 * "/api" + the Connect path of account.gateway.v1.AuthService/RefreshToken.
 * @param {string} origin - one of KIMI_WEB_ORIGINS
 * @returns {string}
 */
export function kimiRefreshUrl(origin) {
  return `${origin.replace("://www.", "://auth.")}/api/account.gateway.v1.AuthService/RefreshToken`;
}
const USER_AGENT =
"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const EFFORT_NONE = "REASONING_EFFORT_NONE";
const EFFORT_LOW = "REASONING_EFFORT_LOW";
const EFFORT_HIGH = "REASONING_EFFORT_HIGH";
const EFFORT_MAX = "REASONING_EFFORT_MAX";

/**
 * Map a Kimi model id (the `key` field from `GetAvailableModels`) to the
 * upstream request shape. Values mirror the live catalog: `k3` runs under the
 * OK Computer scenario with LOW/HIGH/MAX effort; `k2d6` under K2D5 with
 * NONE/LOW. `k2d6-thinking` is the old id for K2.6 with reasoning on; Kimi no
 * longer lists it, so it maps to `k2d6` at LOW. Agent Swarm (`k3-agent-ultra`)
 * needs Kimi's parallel-agent protocol and is not routed; users who need
 * agentic Kimi should use the `kimi-coding` (api.kimi.com) provider.
 * @param {string} modelId
 * @returns {{ model: string, scenario: string, kimiplusId: string, efforts: string[], defaultEffort: string }}
 */
export function resolveModelConfig(modelId) {
  if (modelId === "k3") {
    return {
      model: "k3",
      scenario: "SCENARIO_OK_COMPUTER",
      kimiplusId: "ok-computer",
      efforts: [EFFORT_LOW, EFFORT_HIGH, EFFORT_MAX],
      defaultEffort: EFFORT_HIGH
    };
  }
  const k2d6 = { model: "k2d6", scenario: "SCENARIO_K2D5", kimiplusId: "", efforts: [EFFORT_NONE, EFFORT_LOW] };
  return { ...k2d6, defaultEffort: modelId === "k2d6-thinking" ? EFFORT_LOW : EFFORT_NONE };
}

/**
 * Map an OpenAI `reasoning_effort` onto the model's Kimi effort enum, nearest
 * supported tier. No effort → the model's default.
 * @param {ReturnType<typeof resolveModelConfig>} config
 * @param {unknown} requested
 * @returns {string}
 */
export function resolveReasoningEffort(config, requested) {
  if (!isString(requested) || !requested.trim()) return config.defaultEffort;
  const level = requested.trim().toLowerCase();
  const wanted =
    level === "none" ? EFFORT_NONE :
    level === "minimal" || level === "low" ? EFFORT_LOW :
    level === "xhigh" || level === "max" ? EFFORT_MAX :
    EFFORT_HIGH;
  if (config.efforts.includes(wanted)) return wanted;
  // Nearest tier: k3 has no NONE (→ LOW); k2d6 tops out at LOW.
  return wanted === EFFORT_NONE ? config.efforts[0] : config.efforts[config.efforts.length - 1];
}

/**
 * Fingerprint of the pasted refresh token. A rotated pair is only used while
 * the stored paste is the one it was rotated from, so re-pasting fresh tokens
 * always wins over an older rotation.
 * @param {string} refreshToken
 * @returns {string}
 */
export function sessionSource(refreshToken) {
  return createHash("sha256").update(refreshToken).digest("hex").slice(0, 16);
}

// Rotated pairs by session source. The same pair is persisted to the
// connection's encrypted accessToken/refreshToken columns (see
// refreshCredentials); this map serves the retry in the same request and
// saves a DB round trip.
const rotatedTokens = new Map();

/**
 * Current tokens and site for a connection: a rotation of the current paste
 * (in memory, else the persisted columns), otherwise the paste itself.
 * @param {object} credentials
 * @returns {{ accessToken: string, refreshToken: string, origin: string, source: string }}
 */
export function resolveKimiTokens(credentials) {
  const pasted = extractKimiTokens(String(credentials?.apiKey || ""));
  const origin = pasted.origin || BASE_URL;
  if (!pasted.refreshToken) return { ...pasted, origin, source: "" };
  const source = sessionSource(pasted.refreshToken);
  const persisted = credentials?.providerSpecificData?.kimiWebSessionSource === source && credentials?.accessToken ?
  { accessToken: credentials.accessToken, refreshToken: credentials.refreshToken } :
  null;
  const rotated = rotatedTokens.get(source) || persisted;
  return {
    accessToken: rotated?.accessToken || pasted.accessToken,
    refreshToken: rotated?.refreshToken || pasted.refreshToken,
    origin,
    source
  };
}

/**
 * Wrap a JSON message in the 5-byte Connect streaming envelope (flags + length).
 * @param {string} json
 * @returns {Uint8Array}
 */
export function frameConnectMessage(json) {
  const payload = new TextEncoder().encode(json);
  const framed = new Uint8Array(5 + payload.length);
  framed[0] = 0; // flags: 0 = uncompressed
  const len = payload.length;
  framed[1] = len >>> 24 & 0xff;
  framed[2] = len >>> 16 & 0xff;
  framed[3] = len >>> 8 & 0xff;
  framed[4] = len & 0xff;
  framed.set(payload, 5);
  return framed;
}

/**
 * Decode one Connect frame from a stream buffer.
 * @param {Uint8Array} buf
 * @param {number} byteOffset
 * @returns {{ consumed: number, frame: { flags: number, message: object|null }|null }}
 *   - consumed: 0  → need more bytes
 *   - consumed: -1 → oversized frame, treat as fatal
 *   - consumed: N  → frame parsed
 */
export function decodeConnectFrame(buf, byteOffset) {
  if (byteOffset + 5 > buf.length) return { consumed: 0, frame: null };
  const flags = buf[byteOffset];
  const len =
  buf[byteOffset + 1] << 24 |
  buf[byteOffset + 2] << 16 |
  buf[byteOffset + 3] << 8 |
  buf[byteOffset + 4];
  const msgLen = len < 0 ? len + 0x100000000 : len;
  if (msgLen > MAX_FRAME_LEN) return { consumed: -1, frame: null };
  if (byteOffset + 5 + msgLen > buf.length) return { consumed: 0, frame: null };

  const payload = buf.subarray(byteOffset + 5, byteOffset + 5 + msgLen);
  let message = null;
  if (msgLen > 0) {
    try {
      message = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      message = null;
    }
  }
  return { consumed: 5 + msgLen, frame: { flags, message } };
}

/**
 * Extract a content delta + kind from a Connect frame message.
 * @param {object|null} msg
 * @returns {{ kind: "text"|"think"|null, text: string }|null}
 */
export function extractDelta(msg) {
  if (!msg) return null;
  const op = String(msg.op ?? "");
  const mask = String(msg.mask ?? "");
  const block = msg.block || {};

  if (op === "append") {
    if (mask === "block.text.content") {
      const text = String((block.text || {}).content || "");
      return text ? { kind: "text", text } : null;
    }
    if (mask === "block.think.content") {
      const text = String((block.think || {}).content || "");
      return text ? { kind: "think", text } : null;
    }
    return null;
  }

  if (op === "set") {
    if (mask === "block.text") {
      const text = String((block.text || {}).content || "");
      return text ? { kind: "text", text } : null;
    }
    if (mask === "block.think") {
      const text = String((block.think || {}).content || "");
      return text ? { kind: "think", text } : null;
    }
  }
  return null;
}

/**
 * Detect the end-of-stream marker in a Connect frame.
 * @param {object|null} msg
 * @returns {boolean}
 */
export function isEndOfStream(msg) {
  if (!msg) return false;
  const message = msg.message || null;
  if (
  message &&
  String(message.status || "") === "MESSAGE_STATUS_COMPLETED" &&
  String(message.role || "") === "assistant")
  {
    return true;
  }
  return false;
}

/**
 * Detect a Connect end-stream/error trailer. The Connect streaming protocol
 * marks the final frame with flag bit 0x02; an error envelope carries an
 * `error` object (`{ code, message }`). Returns the error message when the
 * trailer signals a failure, or null for a clean end / non-trailer frame — so
 * callers can surface upstream errors instead of a silent `finish_reason:"stop"`.
 * @param {number} flags
 * @param {object|null} msg
 * @returns {string|null}
 */
export function getConnectError(flags, msg) {
  if (((flags || 0) & 0x02) === 0) return null;
  const err = msg && (msg.error || msg.Error);
  if (!err) return null;
  const detail = isString(err) ? err : err.message || err.msg || err.code || "upstream error";
  return String(detail);
}

/**
 * Render one OpenAI message `content` value to plain text for the Kimi prompt.
 * String content is returned as-is. Array content (multimodal parts) folds
 * `{type:"text", text}` parts joined by newline and annotates any unsupported
 * media part as `[unsupported-part: <type>]` rather than emitting the raw JSON.
 * @param {unknown} content
 * @returns {string}
 */
export function contentToText(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content.
  map((part) => {
    if (part && isObject(part)) {
      if (part.type === "text" && isString(part.text)) return part.text;
      return `[unsupported-part: ${part.type ?? "unknown"}]`;
    }
    return isString(part) ? part : "";
  }).
  filter(Boolean).
  join("\n");
}

/**
 * Fold a multi-turn OpenAI `messages` array into a single Kimi user turn.
 * Kimi web chat is single-turn; tool/function messages are dropped.
 * @param {Array<{role: string, content: unknown}>} messages
 * @returns {string}
 */
export function foldMessages(messages) {
  let system = "";
  let user = "";
  for (const m of messages || []) {
    const text = contentToText(m.content);
    if (m.role === "system") {
      system += (system ? "\n\n" : "") + text;
    } else if (m.role === "user") {
      user = user ? `${user}\n\n${text}` : text;
    } else if (m.role === "assistant") {
      user = user ? `${user}\n\nAssistant: ${text}` : `Assistant: ${text}`;
    }
  }
  return system ? `${system}\n\n${user}` : user;
}

// ponytail: cap a single Connect frame at 8 MiB. Kimi's legitimate events are
// small; anything larger is a misbehaving upstream or an OOM attempt. Raise the
// ceiling if you see legitimate production frames near this limit, but never
// remove the guard.
const MAX_FRAME_LEN = 8 * 1024 * 1024;

export class KimiWebExecutor extends BaseExecutor {
  constructor() {
    super("kimi-web", { id: "kimi-web", baseUrl: BASE_URL });
  }

  /**
   * @param {string} accessToken
   * @param {string} [origin]
   * @returns {Record<string,string>}
   */
  buildKimiHeaders(accessToken, origin = BASE_URL) {
    const headers = {
      "Content-Type": "application/connect+json",
      Accept: "*/*",
      "User-Agent": USER_AGENT,
      Origin: origin,
      Referer: `${origin}/`,
      "connect-protocol-version": "1"
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  }

  /**
   * Shape mirrors the web app's ChatRequest: `thinking` is always true and
   * `reasoning_effort` decides how much reasoning runs.
   * @param {string} prompt
   * @param {ReturnType<typeof resolveModelConfig>} config
   * @param {string} reasoningEffort
   * @returns {string}
   */
  buildRequestBody(prompt, config, reasoningEffort) {
    return JSON.stringify({
      chat_id: "",
      kimiplus_id: config.kimiplusId,
      scenario: config.scenario,
      project_id: "",
      tools: [{ type: "TOOL_TYPE_SEARCH", search: {} }, { type: "TOOL_TYPE_CRON_JOB" }],
      message: {
        role: "user",
        blocks: [{ message_id: "", text: { content: prompt } }],
        scenario: config.scenario
      },
      options: { thinking: true, reasoning_effort: reasoningEffort, enable_plugin: true, model: config.model }
    });
  }

  /**
   * Trade the refresh token for a new pair (the SPA's RefreshToken call).
   * chatCore calls this on a 401 and retries; the returned pair plus the
   * `providerSpecificPatch` are what chat.js persists on the connection.
   * @param {object} credentials
   * @param {object} [log]
   * @param {object|null} [proxyOptions]
   * @returns {Promise<{accessToken: string, refreshToken: string, providerSpecificPatch: object}|null>}
   */
  async refreshCredentials(credentials, log, proxyOptions = null) {
    const { refreshToken, origin, source } = resolveKimiTokens(credentials);
    if (!refreshToken) return null;
    try {
      const res = await proxyAwareFetch(kimiRefreshUrl(origin), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "connect-protocol-version": "1",
          "User-Agent": USER_AGENT,
          Origin: origin,
          Referer: `${origin}/`
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS)
      }, proxyOptions);
      if (!res.ok) {
        log?.warn?.("TOKEN", `kimi-web refresh failed: HTTP ${res.status}`);
        return null;
      }
      const data = await res.json();
      const accessToken = data?.access_token || data?.accessToken;
      if (!isString(accessToken) || !accessToken) return null;
      const next = { accessToken, refreshToken: data?.refresh_token || data?.refreshToken || refreshToken };
      rotatedTokens.set(source, next);
      return { ...next, providerSpecificPatch: { kimiWebSessionSource: source } };
    } catch (err) {
      log?.warn?.("TOKEN", `kimi-web refresh failed: ${err instanceof Error ? err.message : "unknown"}`);
      return null;
    }
  }

  /**
   * @param {object} input
   * @param {object} input.body
   * @param {object} input.credentials
   * @param {boolean} input.stream
   * @param {AbortSignal} [input.signal]
   * @param {object|null} [input.proxyOptions]
   * @returns {Promise<{response: Response, url: string, headers: Record<string,string>, transformedBody: object}>}
   */
  async execute({ body, credentials, stream: wantStream, signal, proxyOptions = null }) {
    const bodyObj = body || {};

    const { accessToken: jwt, origin } = resolveKimiTokens(credentials);
    const chatUrl = `${origin}${CHAT_PATH}`;
    if (!jwt) {
      return {
        response: errorResponse(
          400,
          "Missing Kimi access_token — log in at www.kimi.com or www.kimi.ai and paste the JSON the connect dialog's console snippet copies (or the access_token from localStorage)."
        ),
        url: chatUrl,
        headers: {},
        transformedBody: bodyObj
      };
    }

    const messages = bodyObj.messages || [];
    // Strip the repo-wide thinking suffix (e.g. `k2d6-thinking(high)`) that
    // getModelUpstreamId preserves, so resolveModelConfig resolves the correct
    // tier. applyThinking has already set reasoning_effort from the suffix.
    const modelId = stripThinkingSuffix(bodyObj.model || "k2d6");
    const modelConfig = resolveModelConfig(modelId);
    const reasoningEffort = resolveReasoningEffort(modelConfig, bodyObj.reasoning_effort);

    const prompt = foldMessages(messages);
    const reqBody = this.buildRequestBody(prompt, modelConfig, reasoningEffort);
    const reqHeaders = this.buildKimiHeaders(jwt, origin);
    const framedBody = frameConnectMessage(reqBody);

    // Combine chatCore's client-disconnect signal with a connect timeout so a
    // stalled TCP/TLS/proxy handshake before response headers cannot hold the
    // provider slot indefinitely (mirrors BaseExecutor's fetch guard).
    const connectCtrl = new AbortController();
    const connectTimer = setTimeout(
      () => connectCtrl.abort(new Error("fetch connect timeout")),
      FETCH_CONNECT_TIMEOUT_MS
    );
    const mergedSignal = signal ?
    AbortSignal.any([signal, connectCtrl.signal]) :
    connectCtrl.signal;

    let upstream;
    try {
      upstream = await proxyAwareFetch(chatUrl, {
        method: "POST",
        headers: reqHeaders,
        body: new Uint8Array(framedBody),
        signal: mergedSignal
      }, proxyOptions);
    } catch (err) {
      return {
        response: errorResponse(502, `Kimi fetch failed: ${err instanceof Error ? err.message : "unknown"}`),
        url: chatUrl,
        headers: {},
        transformedBody: bodyObj
      };
    } finally {
      // Headers have arrived (or fetch rejected) — stop the connect timer so it
      // cannot abort the body stream mid-read.
      clearTimeout(connectTimer);
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      // An upstream that echoes the access token bare (not behind an
      // Authorization key) would slip past the generic sanitizer, so redact
      // the known credential first.
      const scrubbed = jwt ? errText.split(jwt).join("[redacted]") : errText;
      return {
        response: errorResponse(upstream.status, `Kimi error: ${sanitizeErrorMessage(scrubbed)}`),
        url: chatUrl,
        headers: reqHeaders,
        transformedBody: bodyObj
      };
    }

    const encoder = new TextEncoder();
    const id = `chatcmpl-kimi-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    const emitChunk = (controller, delta, finish = null) => {
      const chunk = {
        id,
        object: "chat.completion.chunk",
        created,
        model: modelId,
        choices: [{ index: 0, delta, finish_reason: finish }]
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    };

    const sourceStream = upstream.body || new ReadableStream({ start: (c) => c.close() });

    if (wantStream) {
      const outStream = new ReadableStream({
        async start(controller) {
          const reader = sourceStream.getReader();
          let buffer = new Uint8Array(0);
          let emittedRole = false;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                const merged = new Uint8Array(buffer.length + value.length);
                merged.set(buffer, 0);
                merged.set(value, buffer.length);
                buffer = merged;

                let offset = 0;
                while (offset < buffer.length) {
                  const { consumed, frame } = decodeConnectFrame(buffer, offset);
                  if (consumed === -1) {
                    controller.error(new Error("Kimi Connect frame exceeded MAX_FRAME_LEN"));
                    return;
                  }
                  if (consumed === 0) break;
                  offset += consumed;

                  // Surface a Connect error trailer instead of ending cleanly.
                  const connectErr = getConnectError(frame?.flags, frame?.message);
                  if (connectErr) {
                    if (!emittedRole) {
                      emittedRole = true;
                      emitChunk(controller, { role: "assistant", content: "" });
                    }
                    emitChunk(controller, { content: `\n[kimi-web upstream error: ${connectErr}]` }, "stop");
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                    return;
                  }

                  if (!frame?.message) continue;

                  const delta = extractDelta(frame.message);
                  if (delta) {
                    if (!emittedRole) {
                      emittedRole = true;
                      emitChunk(controller, { role: "assistant", content: "" });
                    }
                    if (delta.kind === "think") {
                      emitChunk(controller, { reasoning_content: delta.text });
                    } else {
                      emitChunk(controller, { content: delta.text });
                    }
                  }
                  if (isEndOfStream(frame.message)) {
                    emitChunk(controller, {}, "stop");
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                    return;
                  }
                }
                buffer = buffer.subarray(offset);
              }
            }
            if (!emittedRole) {
              emitChunk(controller, { role: "assistant", content: "" });
            }
            emitChunk(controller, {}, "stop");
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (err) {
            if (!signal?.aborted) {
              try {
                controller.error(err);
              } catch {

                /* controller already closed */}
            }
          }
        }
      });

      return {
        response: new Response(outStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          }
        }),
        url: chatUrl,
        headers: reqHeaders,
        transformedBody: JSON.parse(reqBody)
      };
    }

    // Non-streaming: collect all deltas into a single chat.completion JSON.
    let answer = "";
    let reasoning = "";
    const reader = sourceStream.getReader();
    let buffer = new Uint8Array(0);
    let upstreamError = null;
    let completed = false;
    try {
      while (!completed) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer, 0);
        merged.set(value, buffer.length);
        buffer = merged;

        let offset = 0;
        while (offset < buffer.length) {
          const { consumed, frame } = decodeConnectFrame(buffer, offset);
          if (consumed === -1) {
            // Mirror the streaming path: an oversized Connect frame is fatal
            // rather than leaving it in the buffer where it could be re-parsed
            // indefinitely or produce a partial bogus 200.
            await reader.cancel().catch(() => {});
            return {
              response: errorResponse(503, "kimi-web oversized frame"),
              url: chatUrl,
              headers: reqHeaders,
              transformedBody: JSON.parse(reqBody)
            };
          }
          if (consumed === 0) break;
          offset += consumed;

          // Surface a Connect error trailer instead of returning a clean 200.
          const connectErr = getConnectError(frame?.flags, frame?.message);
          if (connectErr) {
            upstreamError = connectErr;
            completed = true;
            break;
          }
          if (!frame?.message) continue;
          const delta = extractDelta(frame.message);
          if (delta) {
            if (delta.kind === "think") reasoning += delta.text;else
            answer += delta.text;
          }
          if (isEndOfStream(frame.message)) {
            // Stop the OUTER read loop too: once the assistant message is
            // complete we have the full answer and must not wait for the
            // upstream to close the HTTP stream (it may keep it open).
            completed = true;
            break;
          }
        }
        buffer = completed ? buffer : buffer.subarray(offset);
      }
    } catch {

      /* best-effort — return what we have */} finally {
      // Release the upstream connection promptly when we stop early.
      await reader.cancel().catch(() => {});
    }

    if (upstreamError) {
      const scrubbed = jwt ? upstreamError.split(jwt).join("[redacted]") : upstreamError;
      return {
        response: errorResponse(502, `Kimi error: ${sanitizeErrorMessage(scrubbed)}`),
        url: chatUrl,
        headers: reqHeaders,
        transformedBody: JSON.parse(reqBody)
      };
    }

    const message = { role: "assistant", content: answer };
    if (reasoning) message.reasoning_content = reasoning;
    const completion = {
      id,
      object: "chat.completion",
      created,
      model: modelId,
      choices: [{ index: 0, message, finish_reason: "stop" }]
    };
    return {
      response: new Response(JSON.stringify(completion), {
        headers: { "Content-Type": "application/json" }
      }),
      url: chatUrl,
      headers: reqHeaders,
      transformedBody: JSON.parse(reqBody)
    };
  }
}