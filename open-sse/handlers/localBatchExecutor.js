// Default batch executor: re-dispatch each JSONL row through the real route
// handlers (handleChat / handleEmbeddings) via an internal Request. Auth
// headers captured at batch creation are forwarded. Stored-key batches also
// retain their admitted identity and recheck it for every row.
//
// ponytail: in-process self-dispatch; upgrade path = provider-native batch.

import { initTranslators } from "open-sse/translator/index.js";
import { getApiKeyById } from "@/lib/localDb";
import { bindBatchRequestKey, getAdmittedRequestKeyId } from "@/sse/services/batchKeyIdentity.js";
import { isApiKeyExpired } from "@/shared/utils/apiKeyExpiry";

let initialized = false;
async function ensureInit() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Build an executor bound to the creating request's admitted identity and headers.
 * @param {Request|Headers|object} authSource - request or headers to forward
 * @returns {(row:{url,method,body,custom_id}) => Promise<{status_code,body}>}
 */
export function makeDefaultExecutor(authSource) {
  // Snapshot only the auth-relevant headers; never trust row bodies to set them.
  const forward = new Headers();
  const sourceRequest = authSource instanceof Request ? authSource : null;
  const admittedKeyId = sourceRequest ? getAdmittedRequestKeyId(sourceRequest) : null;
  const src = sourceRequest
    ? sourceRequest.headers
    : (authSource instanceof Headers ? authSource : new Headers(authSource || {}));
  for (const name of ["authorization", "x-api-key", "x-goog-api-key", "x-9r-cli-token", "anthropic-version", "user-agent"]) {
    const v = src.get(name);
    if (v) forward.set(name, v);
  }
  if (sourceRequest && !forward.has("authorization") && !forward.has("x-api-key") && !forward.has("x-goog-api-key")) {
    const queryKey = new URL(sourceRequest.url).searchParams.get("key");
    if (queryKey) forward.set("x-goog-api-key", queryKey);
  }

  return async ({ url, body }) => {
    const headers = new Headers(forward);
    if (admittedKeyId) {
      // Re-read the admitted identity on every row so rotation preserves the
      // current policy while deletion, deactivation and expiry fail closed.
      const key = await getApiKeyById(admittedKeyId);
      if (!key || key.isActive !== true || isApiKeyExpired(key.expiresAt, Date.now())) {
        return { status_code: 401, body: { error: { message: "Invalid API key" } } };
      }
      for (const name of ["authorization", "x-api-key", "x-goog-api-key", "x-9r-cli-token"]) headers.delete(name);
      headers.set("authorization", `Bearer ${key.key}`);
    }
    await ensureInit();
    headers.set("content-type", "application/json");
    headers.set("accept", "application/json");

    const req = new Request(`http://localhost${url}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (admittedKeyId) bindBatchRequestKey(req, admittedKeyId);

    let res;
    if (url === "/v1/embeddings") {
      const { handleEmbeddings } = await import("@/sse/handlers/embeddings.js");
      res = await handleEmbeddings(req);
    } else {
      // /v1/chat/completions and /v1/messages both flow through handleChat
      // (translator detects source format from the body).
      const { handleChat } = await import("@/sse/handlers/chat.js");
      res = await handleChat(req);
    }

    const status_code = res.status;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let outBody;
    if (ct.includes("application/json")) {
      outBody = await res.json().catch(() => null);
    } else {
      // Streaming or non-JSON: buffer as text so the batch row is self-contained.
      outBody = await res.text().catch(() => "");
    }
    return { status_code, body: outBody };
  };
}
