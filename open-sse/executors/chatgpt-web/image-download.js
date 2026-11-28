/** ChatGPT Web image download and resolution into DurinDoor's short-lived image cache. */
import { storeChatGptImage } from "../../services/chatgptImageCache.js";
import { buildNextAuthSessionCookie } from "../../../src/lib/providers/webCookieAuth.js";
import { tlsFetchChatGpt, CHATGPT_BASE, browserHeaders, oaiHeaders } from "./session.js";


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

const FILE_SERVICE_PREFIX = "file-service://";

const SEDIMENT_PREFIX = "sediment://";


async function fetchDownloadUrl(endpoint, ctx) {
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
const IMAGE_DOWNLOAD_MAX_BYTES = 8 * 1024 * 1024;


async function imageUrlToCachedImageUrl(signedUrl, ctx, imageContext) {
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


function buildImageDownloadHeaders(signedUrl, ctx) {
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


const __buildImageDownloadHeadersForTesting = buildImageDownloadHeaders;


function makeImageResolver(ctx) {
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


export { makeImageResolver, __buildImageDownloadHeadersForTesting };
