/** ChatGPT Web async image wait: celsius WebSocket with a conversation-poll fallback. */
import { resolveWebSocketProxyRoute } from "../../utils/proxyFetch.js";
import { buildNextAuthSessionCookie } from "../../../src/lib/providers/webCookieAuth.js";
import { isObject, isRecord, isString } from "../../../src/shared/utils/typeChecks.js";
import { tlsFetchChatGpt, proxyAgentForWebSocket, CHATGPT_BASE, browserHeaders, oaiHeaders } from "./session.js";
import { delayWithAbort, fetchConversationDetail } from "./conversation.js";
import { isImagePointer, extractImagePointers, imagePointerEntry } from "./image-pointers.js";


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
async function registerWebSocket(ctx) {
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
async function waitForImageViaWebSocket(wssUrl, conversationId, timeoutMs, ctx) {
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
const DEFAULT_ASYNC_IMAGE_TIMEOUT_MS = 180_000;


function configuredAsyncImageTimeoutMs() {
  const raw = Number(process.env.DURINDOOR_CGPT_WEB_IMAGE_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_ASYNC_IMAGE_TIMEOUT_MS;
  return Math.floor(raw);
}


async function pollForAsyncImage(conversationId, ctx, opts = {}) {
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


const __waitForImageViaWebSocketForTesting = waitForImageViaWebSocket;


export { pollForAsyncImage, __waitForImageViaWebSocketForTesting };
