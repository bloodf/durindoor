/** Internal ChatGPT Web images helpers; public compatibility exports live in ../chatgpt-web-http.js. */
import { storeChatGptImage } from "../../services/chatgptImageCache.js";
import { resolveWebSocketProxyRoute } from "../../utils/proxyFetch.js";
import { buildNextAuthSessionCookie } from "../../../src/lib/providers/webCookieAuth.js";
import { isObject, isRecord, isString } from "../../../src/shared/utils/typeChecks.js";
import { tlsFetchChatGpt, proxyAgentForWebSocket, CHATGPT_BASE, browserHeaders, oaiHeaders } from "./session.js";
import { imagePointerEntry, isImagePointer, extractImagePointers, delayWithAbort, fetchConversationDetail } from "./conversation-detail.js";
export function errorResponse(status, message, code) {
  const error = { message, type: "upstream_error" };
  if (code) error.code = code;
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function normalizePublicBaseUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

export function firstForwardedValue(value) {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

export function isLocalBaseUrl(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  } catch {
    console.warn("[chatgpt-web] URL parse failed, falling back to regex");
    return /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i.test(baseUrl);
  }
}

export function deriveHeaderBaseUrl(clientHeaders) {
  const headers = clientHeaders ?? {};
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  const forwardedHost = firstForwardedValue(lower["x-forwarded-host"]);
  const forwardedProto = firstForwardedValue(lower["x-forwarded-proto"]);
  const host = forwardedHost || firstForwardedValue(lower["host"]);
  if (!host) return null;

  // Default to http for IPs, localhost, and explicit host:port values where
  // TLS is not a safe assumption. Reverse proxies can override via
  // x-forwarded-proto, and deployments can force the exact value with
  // DURINDOOR_PUBLIC_BASE_URL.
  const isPlain =
    host.includes("localhost") ||
    /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(host) ||
    host.endsWith(".local") ||
    host.includes(":");
  const proto = forwardedProto || (isPlain ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Build the absolute base URL the client should use to fetch our cached
 * images at /v1/chatgpt-web/image/<id>. The most reliable value is an
 * explicit browser-facing origin because relay clients such as Open WebUI
 * often reach DurinDoor from a container while the user's browser needs a
 * LAN, tunnel, or reverse-proxy URL.
 */
export function derivePublicBaseUrl(clientHeaders, log) {
  const explicitPublicBase = normalizePublicBaseUrl(process.env.DURINDOOR_PUBLIC_BASE_URL);
  if (explicitPublicBase) {
    log?.debug?.("CGPT-WEB", `derivePublicBaseUrl: using DURINDOOR_PUBLIC_BASE_URL`);
    return explicitPublicBase;
  }

  const headerBase = deriveHeaderBaseUrl(clientHeaders);
  const configuredBase =
    normalizePublicBaseUrl(process.env.BASE_URL) ||
    normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);

  log?.debug?.(
    "CGPT-WEB",
    `derivePublicBaseUrl: configured=${configuredBase ?? "-"} header=${headerBase ?? "-"}`
  );

  if (configuredBase && (!headerBase || !isLocalBaseUrl(configuredBase))) return configuredBase;
  if (headerBase) return headerBase;
  if (configuredBase) return configuredBase;

  return `http://localhost:${process.env.PORT || 20128}`;
}

// ─── Image asset resolution ────────────────────────────────────────────────
// ChatGPT's image_gen tool emits `image_asset_pointer` parts whose
// `asset_pointer` is one of:
//
//   file-service://file-XXXX        → resolved via /backend-api/files/{id}/download
//   sediment://file-XXXX            → resolved via /backend-api/conversation/{conv_id}/attachment/{id}/download
//
// Both endpoints return JSON `{ download_url: "<azure-blob-sas-url>", ... }`.
// The signed URL has a limited lifetime (typically a few hours), but that's
// usually sufficient for the user to view the image in their UI right after
// generation. Persistent storage can be layered on later if needed.

export const FILE_SERVICE_PREFIX = "file-service://";
export const SEDIMENT_PREFIX = "sediment://";

export async function fetchDownloadUrl(endpoint, ctx) {
  const headers = {
    ...browserHeaders(),
    ...oaiHeaders(ctx.sessionId, ctx.deviceId),
    Accept: "application/json",
    Authorization: `Bearer ${ctx.accessToken}`,
    Cookie: buildNextAuthSessionCookie(ctx.cookie),
  };
  if (ctx.accountId) headers["chatgpt-account-id"] = ctx.accountId;

  const response = await tlsFetchChatGpt(endpoint, {
    method: "GET",
    headers,
    timeoutMs: 30_000,
    signal: ctx.signal,
  });
  if (response.status !== 200) {
    ctx.log?.warn?.(
      "CGPT-WEB",
      `Image download URL fetch failed (${response.status}) for ${endpoint}`
    );
    return null;
  }
  let parsed = {};
  try {
    parsed = JSON.parse(response.text || "{}");
  } catch {
    console.warn("[chatgpt-web] image download URL parse failed");
    return null;
  }
  return parsed.download_url ?? null;
}

/**
 * Download a chatgpt.com signed image URL and re-serve it from DurinDoor's
 * short-lived image cache. The URLs returned by /files/<id>/download and
 * /conversation/<cid>/attachment/<fid>/download point at chatgpt.com's
 * estuary endpoint, which 403s for any request without the user's session
 * cookie. Downstream clients (Open WebUI, OpenAI-compatible apps) won't
 * have those cookies, so we download once via the authenticated TLS client
 * and return a browser-fetchable DurinDoor URL.
 */
export const IMAGE_DOWNLOAD_MAX_BYTES = 8 * 1024 * 1024;

export async function imageUrlToCachedImageUrl(signedUrl, ctx, imageContext) {
  const headers = buildImageDownloadHeaders(signedUrl, ctx);
  if (!headers) return null;

  let response;
  try {
    response = await tlsFetchChatGpt(signedUrl, {
      method: "GET",
      headers,
      timeoutMs: 60_000,
      signal: ctx.signal,
      // Required for binary payloads; otherwise raw image bytes get mangled by UTF-8 decoding.
      byteResponse: true,
    });
  } catch (err) {
    ctx.log?.warn?.(
      "CGPT-WEB",
      `Image fetch failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }

  if (response.status !== 200) {
    ctx.log?.warn?.(
      "CGPT-WEB",
      `Image fetch returned HTTP ${response.status} (${(response.text || "").slice(0, 120)})`
    );
    return null;
  }

  if (response.text == null || response.text.length === 0) return null;

  // tls-client-node already returns binary bodies as a "data:<mime>;base64,..."
  // string (see node_modules/tls-client-node/dist/response.js — its bytes()
  // method splits on the comma to extract base64). Decode back into bytes
  // so we can hand them to the cache.
  let bytes;
  let mime;
  if (/^data:[^;]{1,256};base64,/.test(response.text)) {
    const commaIdx = response.text.indexOf(",");
    const header = response.text.slice(5, commaIdx); // strip "data:"
    mime = header.split(";")[0] || "image/png";
    bytes = Buffer.from(response.text.slice(commaIdx + 1), "base64");
  } else {
    // Plain-text body (shouldn't happen for binary downloads with
    // byteResponse:true, but handle defensively).
    bytes = Buffer.from(response.text, "binary");
    mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  }
  if (bytes.length === 0 || bytes.length > IMAGE_DOWNLOAD_MAX_BYTES) {
    if (bytes.length > IMAGE_DOWNLOAD_MAX_BYTES) {
      ctx.log?.warn?.(
        "CGPT-WEB",
        `Image too large to cache (${bytes.length} bytes > ${IMAGE_DOWNLOAD_MAX_BYTES}); skipping`
      );
    }
    return null;
  }
  // Cache the image and return a stable HTTP URL pointing at our own
  // /v1/chatgpt-web/image/<id> route. Streaming the raw base64 back via
  // SSE deltas works but Open WebUI's progressive markdown renderer shows
  // each chunk as plain text mid-stream — the user sees megabytes of
  // base64 scroll past before the image renders. URL-based delivery
  // produces a small markdown delta and renders instantly when the
  // browser fetches the URL.
  const id = storeChatGptImage(bytes, mime, undefined, imageContext);
  return `${ctx.publicBaseUrl}/v1/chatgpt-web/image/${id}`;
}

export function buildImageDownloadHeaders(signedUrl, ctx) {
  let url;
  try {
    url = new URL(signedUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const isChatGptHost = url.hostname === "chatgpt.com" || url.hostname.endsWith(".chatgpt.com");
  const headers = {
    ...browserHeaders(),
    Accept: "image/*,*/*;q=0.8",
  };
  if (isChatGptHost) {
    headers.Authorization = `Bearer ${ctx.accessToken}`;
    headers.Cookie = buildNextAuthSessionCookie(ctx.cookie);
    if (ctx.accountId) headers["chatgpt-account-id"] = ctx.accountId;
  }
  return headers;
}

export const __buildImageDownloadHeadersForTesting = buildImageDownloadHeaders;

/**
 * Resolve the async image_gen result by registering a WebSocket with
 * chatgpt.com and listening for the image_asset_pointer.
 *
 * Background: when chatgpt.com is busy ("Lots of people are creating images
 * right now") the image_gen tool defers — the initial SSE finishes with a
 * "Processing image..." placeholder and the real image arrives over a
 * WebSocket pubsub. (We checked: the conversation tree at
 * `/backend-api/conversation/{id}` is NOT updated when the image lands, so
 * polling that endpoint does nothing.)
 *
 * Flow:
 *   1. POST /backend-api/register-websocket → { wss_url, expires_at, ... }
 *   2. Open the wss_url with the standard WebSocket client.
 *      Auth lives in the URL (signed access token), so we don't need the
 *      TLS-impersonation transport here.
 *   3. Each WS message is JSON like { type: "wss-message", data: { ...
 *      conversation event ... } }. The conversation event has the same
 *      shape as the SSE events from /backend-api/f/conversation.
 *   4. Watch for assistant messages with multimodal_text + image_asset_pointer
 *      OR a `message_stream_complete` for the conversation. Resolve when
 *      either pointer arrives or the timeout fires.
 */
export async function registerWebSocket(ctx) {
  // chatgpt.com migrated from POST /backend-api/register-websocket to a
  // GET-only endpoint under /backend-api/celsius/ws/user. The response shape
  // also changed from `{ wss_url }` → `{ websocket_url }`. Newer codebases
  // (g4f, etc.) all hit the celsius path; the legacy path now 404s.
  // Keep the legacy path as a fallback for older deployments.
  const candidates = [
    { url: `${CHATGPT_BASE}/backend-api/celsius/ws/user`, method: "GET" },
    { url: `${CHATGPT_BASE}/backend-api/register-websocket`, method: "POST" },
  ];
  const headers = {
    ...browserHeaders(),
    ...oaiHeaders(ctx.sessionId, ctx.deviceId),
    Accept: "application/json",
    Authorization: `Bearer ${ctx.accessToken}`,
    Cookie: buildNextAuthSessionCookie(ctx.cookie),
  };
  if (ctx.accountId) headers["chatgpt-account-id"] = ctx.accountId;

  for (const { url, method } of candidates) {
    let r;
    try {
      r = await tlsFetchChatGpt(url, {
        method,
        headers,
        body: method === "POST" ? "" : undefined,
        timeoutMs: 30_000,
        signal: ctx.signal,
      });
    } catch (err) {
      ctx.log?.warn?.(
        "CGPT-WEB",
        `register-websocket fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    if (r.status === 200) {
      try {
        const data = JSON.parse(r.text || "{}");

        const ws = data.websocket_url ?? data.wss_url;
        if (ws) {
          ctx.log?.debug?.("CGPT-WEB", `Got WebSocket URL via ${url}`);
          return ws;
        }
      } catch {
        console.warn("[chatgpt-web] WebSocket URL parse failed, falling through");
        /* fall through */
      }
    }
    ctx.log?.warn?.(
      "CGPT-WEB",
      `register-websocket via ${url} → ${r.status}: ${(r.text || "").slice(0, 200)}`
    );
  }
  return null;
}

/**
 * Wait on the celsius WebSocket for an async image_gen asset pointer.
 * Non-object frames (e.g. JSON `null` or primitives) and per-frame handler
 * errors are skipped so a bad frame cannot escape `ws.onmessage` or abort
 * the wait.
 */
export async function waitForImageViaWebSocket(wssUrl, conversationId, timeoutMs, ctx) {
  let wsOptions;
  if (ctx.proxyOptions) {
    const route = resolveWebSocketProxyRoute(wssUrl, ctx.proxyOptions);
    if (route.enabled && route.url) {
      const agent = await proxyAgentForWebSocket(route.url);
      if (agent) wsOptions = { agent };
      else if (route.strict) throw new Error("WebSocket proxy required but unavailable");
    }
  }
  // Keep the global WebSocket when no agent is required so unit tests can stub
  // globalThis.WebSocket. Load `ws` only for proxied sockets that need an agent.
  let WebSocketCtor = WebSocket;
  if (wsOptions?.agent) {
    const wsModule = await import("ws");
    WebSocketCtor = wsModule.default;
  }

  return new Promise((resolve) => {
    const found = new Map();
    let resolved = false;
    let errored = false;
    let gotAnyMessage = false;
    const ws = wsOptions ? new WebSocketCtor(wssUrl, wsOptions) : new WebSocketCtor(wssUrl);
    const finish = () => {
      if (resolved) return;
      resolved = true;
      try {
        ws.close();
      } catch {
        console.warn("[chatgpt-web] ws.close failed");
        /* ignore */
      }
      resolve({
        pointers: Array.from(found.values()),
        errored,
        gotAnyMessage,
      });
    };
    const timer = setTimeout(() => {
      ctx.log?.warn?.("CGPT-WEB", `WebSocket image wait timed out after ${timeoutMs}ms`);
      finish();
    }, timeoutMs);
    const onAbort = () => {
      ctx.log?.debug?.("CGPT-WEB", "WebSocket aborted by client");
      finish();
    };
    ctx.signal?.addEventListener?.("abort", onAbort);
    ws.onopen = () => {
      gotAnyMessage = true;
      ctx.log?.debug?.("CGPT-WEB", "WebSocket open — waiting for image events");
    };
    ws.onerror = (e) => {
      errored = true;
      ctx.log?.warn?.("CGPT-WEB", `WebSocket error: ${e.message ?? "unknown"}`);
    };
    ws.onclose = () => {
      clearTimeout(timer);
      ctx.signal?.removeEventListener?.("abort", onAbort);
      finish();
    };
    ws.onmessage = (event) => {
      gotAnyMessage = true;
      let payload;
      try {
        const raw = isString(event?.data) ? event.data : event?.data?.toString?.();
        payload = JSON.parse(raw);
      } catch {
        console.warn("[chatgpt-web] WebSocket event JSON parse failed");
        return;
      }
      if (!isRecord(payload)) {
        return;
      }
      try {
        // chatgpt.com's celsius WS frames look like:
        //   { type: "conversation-update",
        //     payload: { conversation_id: "...",
        //                update_content: { message: { ... }, ... } } }
        // Older deployments wrapped the conversation event directly as { data }.
        const obj = payload;
        const candidates = [];
        const innerPayload = obj.payload;
        const updateContent = innerPayload?.update_content;
        if (updateContent?.message) {
          candidates.push({
            message: updateContent.message,
            conversation_id: innerPayload?.conversation_id,
          });
        }
        // OmniRoute #7357: some deployments deliver the completion via update_content.messages[]
        // (plural array of { message: {...} } wrappers), not the singular field above.
        for (const entry of Array.isArray(updateContent?.messages) ? updateContent.messages : []) {
          const wrapped = entry?.message;
          if (wrapped) {
            candidates.push({
              message: wrapped,
              conversation_id: innerPayload?.conversation_id,
            });
          }
        }
        if (innerPayload?.message) {
          candidates.push({
            message: innerPayload.message,
            conversation_id: innerPayload.conversation_id,
          });
        }
        if (obj.data?.message) {
          candidates.push(obj.data);
        }

        for (const data of candidates) {
          if (data?.conversation_id && data.conversation_id !== conversationId) continue;
          const m = data?.message;
          // The async image_gen result arrives as a TOOL-role message
          // ({"author":{"role":"tool","name":"t2uay3k.sj1i4kz"}}), so we
          // accept tool messages here too — extractImagePointers does the
          // actual content_type filtering.
          if (Array.isArray(m?.content?.parts)) {
            for (const ptr of extractImagePointers(m.content?.parts ?? [])) {
              const existing = found.get(ptr);
              found.set(
                ptr,
                existing?.messageId ? existing : imagePointerEntry(ptr, m?.id)
              );
            }
          }
          if (m?.metadata && isObject(m.metadata)) {
            const md = m.metadata;
            const ptr = md.asset_pointer ?? md.image_asset_pointer;
            if (isImagePointer(ptr)) {
              const existing = found.get(ptr);
              found.set(
                ptr,
                existing?.messageId ? existing : imagePointerEntry(ptr, m?.id)
              );
            }
          }
        }
        if (found.size > 0) finish();
      } catch (err) {
        ctx?.log?.debug?.(
          "CGPT-WEB",
          `WebSocket frame handling failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    };
  });
}

// Default 3-minute wait for the async image_gen tool to produce an image
// pointer over the celsius WebSocket. Tunable so deployments can stretch
// during chatgpt.com queue-deep windows ("Lots of people are creating
// images right now") without code changes.
export const DEFAULT_ASYNC_IMAGE_TIMEOUT_MS = 180_000;

export function configuredAsyncImageTimeoutMs() {
  const raw = Number(process.env.DURINDOOR_CGPT_WEB_IMAGE_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_ASYNC_IMAGE_TIMEOUT_MS;
  return Math.floor(raw);
}

export async function pollForAsyncImage(conversationId, ctx, opts = {}) {
  const totalTimeoutMs = opts.timeoutMs ?? configuredAsyncImageTimeoutMs();
  const deadline = Date.now() + totalTimeoutMs;

  // One reconnect attempt on transport error: the WS endpoint is signed and
  // short-lived, and a network blip during the long wait would otherwise
  // lose the image entirely. The deadline is shared across attempts so we
  // never exceed the caller's budget.
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const wssUrl = await registerWebSocket(ctx);
    if (!wssUrl) {
      ctx.log?.warn?.(
        "CGPT-WEB",
        attempt === 0
          ? "Could not register WebSocket — async image gen not retrievable"
          : `WebSocket re-registration failed on retry attempt ${attempt + 1}`
      );
      if (attempt === 0) continue; // try again — registration can be flaky
      break; // fall through to the conversation-poll fallback below
    }
    ctx.log?.debug?.(
      "CGPT-WEB",
      `Registered WebSocket for async image (attempt ${attempt + 1}, ${remaining}ms remaining)`
    );
    const outcome = await waitForImageViaWebSocket(wssUrl, conversationId, remaining, ctx);
    if (outcome.pointers.length > 0) return outcome.pointers;
    if (ctx.signal?.aborted) return [];
    // Only retry when the connection died before producing anything useful.
    // A clean close with no pointers (e.g., upstream cancellation) shouldn't
    // burn a second attempt — the result would be the same.
    if (!outcome.errored || outcome.gotAnyMessage) break;
    ctx.log?.warn?.(
      "CGPT-WEB",
      `WebSocket attempt ${attempt + 1} ended in transport error before any frame; retrying`
    );
  }

  // Fallback: the async image websocket is unreliable in some environments —
  // register-websocket is Cloudflare-sensitive and the plain WebSocket lacks the
  // browser TLS fingerprint the HTTP client uses, so it can error or receive no
  // frames even though the image was generated. The image still lands in the
  // conversation, so poll it over the same authenticated HTTP path used
  // everywhere else and read the image_asset_pointer directly. This is the
  // durable fallback recommended in OmniRoute #7357.
  const pollDeadline = Math.max(deadline, Date.now() + 60_000);
  while (Date.now() < pollDeadline && !ctx.signal?.aborted) {
    const { detail } = await fetchConversationDetail(conversationId, ctx);
    const mapping = detail?.mapping;
    if (mapping) {
      // Prefer the newest message carrying image pointers, so a reused
      // conversation doesn't surface a stale image from an earlier turn.
      let newest = null;
      for (const node of Object.values(mapping)) {
        const message = node?.message;
        const parts = message?.content?.parts;
        if (!Array.isArray(parts)) continue;
        const pointers = extractImagePointers(parts).map((pointer) => ({
          pointer,
          messageId: message?.id,
        }));
        if (pointers.length === 0) continue;
        const at = message?.create_time ?? 0;
        if (!newest || at >= newest.at) newest = { pointers, at };
      }
      if (newest) {
        ctx.log?.info?.(
          "CGPT-WEB",
          `Recovered ${newest.pointers.length} image pointer(s) via conversation poll (websocket yielded none)`
        );
        return newest.pointers;
      }
    }
    await delayWithAbort(3_000, ctx.signal);
  }
  return [];
}

export function makeImageResolver(ctx) {
  // Cache resolutions across the same request — the same pointer can show up
  // on multiple SSE events (in-progress + finished_successfully). One HTTP
  // round-trip per unique pointer is enough.
  const cache = new Map();

  return async (assetPointer, conversationId, parentMessageId) => {
    if (cache.has(assetPointer)) return cache.get(assetPointer) ?? null;

    let fileId = null;
    if (assetPointer.startsWith(FILE_SERVICE_PREFIX)) {
      fileId = assetPointer.slice(FILE_SERVICE_PREFIX.length);
    } else if (assetPointer.startsWith(SEDIMENT_PREFIX)) {
      fileId = assetPointer.slice(SEDIMENT_PREFIX.length);
    } else {
      ctx.log?.warn?.("CGPT-WEB", `Unknown asset_pointer scheme: ${assetPointer}`);
    }

    let signedUrl = null;
    if (fileId) {
      // Both endpoints return a chatgpt.com estuary URL signed for the
      // user's current session — that URL 403s without the cookie, so
      // downstream clients can't fetch it directly. We download once via
      // the authenticated TLS client and expose the bytes through
      // DurinDoor's short-lived image cache.
      //
      // /files/{id}/download is the historical path. It works for
      // chat-uploaded files and the older image_gen output format
      // (`file-XXXX`). Newer image-edit results from continued
      // conversations land with a `file_00000000XXXX` shape that 422s on
      // /files/{id}/download — they're conversation-scoped attachments
      // and only resolve through /conversation/{cid}/attachment/{fid}/
      // download. We try /files first because it's cheaper and works for
      // the common case, then fall through.
      signedUrl = await fetchDownloadUrl(
        `${CHATGPT_BASE}/backend-api/files/${encodeURIComponent(fileId)}/download`,
        ctx
      );
      if (!signedUrl && conversationId) {
        signedUrl = await fetchDownloadUrl(
          `${CHATGPT_BASE}/backend-api/conversation/${encodeURIComponent(conversationId)}/attachment/${encodeURIComponent(fileId)}/download`,
          ctx
        );
      }
    }

    let finalUrl = null;
    if (signedUrl) {
      // chatgpt.com signed URLs require the user's session cookie to fetch,
      // so we materialize the bytes into our own cache and emit an DurinDoor
      // URL. If that fails (oversize, network error, etc.) we return null —
      // never the signed URL — because handing it back would emit broken
      // markdown that 403s for the client. Better to drop the image silently
      // than render a broken link.
      finalUrl = await imageUrlToCachedImageUrl(
        signedUrl,
        ctx,
        conversationId && parentMessageId && ctx.imageContextOwner ? { conversationId, parentMessageId, owner: ctx.imageContextOwner } : undefined
      );
    }
    cache.set(assetPointer, finalUrl);
    if (finalUrl) {
      const preview = finalUrl.startsWith("data:")
        ? `data:... (${finalUrl.length} chars)`
        : finalUrl.slice(0, 80) + "...";
      ctx.log?.debug?.("CGPT-WEB", `Resolved ${assetPointer} → ${preview}`);
    }
    return finalUrl;
  };
}

// ─── Executor ───────────────────────────────────────────────────────────────


export const __derivePublicBaseUrlForTesting = derivePublicBaseUrl;
export const __waitForImageViaWebSocketForTesting = waitForImageViaWebSocket;
