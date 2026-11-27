// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad,
// open-sse/executors/uc/media.ts: signed POST -> raw PUT -> persona blob reference.
// Fail closed instead of silently dropping an attachment; no upload/turn retries.
import { Agent, fetch as guardedFetch } from "undici";
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { createOutboundUrlConnector } from "../../../utils/outboundUrlGuard.js";
import { readBoundedResponseText } from "../../../utils/error.js";
import { cancelDiscardedResponse } from "../../../executors/sendRequest.js";
import { UC_ORIGIN } from "./config.js";

export const UC_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/markdown", "text/csv", "application/json", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const EXT = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const invalid = () => Object.assign(new Error("UC supports one inline image or document of at most 10 MiB; audio, remote URLs and file ids are unsupported"), { status: 400, code: "uc_attachment_invalid" });

/** Source extracts only the last user message. Refuse other active media rather than lose it. */
export function extractUcAttachment(messages) {
  const split = messages.findLastIndex((m) => m?.role === "assistant");
  const lastUser = messages.findLastIndex((m) => m?.role === "user");
  let attachment = null;
  for (let i = split + 1; i < messages.length; i++) {
    for (const p of Array.isArray(messages[i]?.content) ? messages[i].content : []) {
      if (!p || p.type === "text") continue;
      if (i !== lastUser || attachment) throw invalid();
      let data;
      let mime;
      if (p.type === "image_url") data = isString(p.image_url) ? p.image_url : p.image_url?.url;
      else if (p.type === "file") {
        data = p.file?.file_data;
        mime = EXT[String(p.file?.filename ?? "").split(".").pop().toLowerCase()];
      } else if (p.type === "input_file") data = p.file_data;
      else if (p.type === "document" && p.source?.type === "base64") {
        data = p.source.data;
        mime = p.source.media_type ?? "application/pdf";
      } else throw invalid();
      if (!isString(data) || data.length > UC_ATTACHMENT_MAX_BYTES * 1.4 + 256) throw invalid();
      if (data.startsWith("data:")) {
        const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(data);
        if (!match) throw invalid();
        [, mime, data] = match;
      }
      if (!TYPES.has(mime) || !data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw invalid();
      const bytes = Buffer.from(data, "base64");
      if (!bytes.length || bytes.length > UC_ATTACHMENT_MAX_BYTES || bytes.toString("base64") !== data) throw invalid();
      if (p.type === "image_url" && !mime.startsWith("image/")) throw invalid();
      attachment = { bytes, contentType: mime };
    }
  }
  return attachment;
}

/** Exact CDN host/path only. No user-controlled host, credentials, redirects or remote fetch. */
export function validateUcUploadUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "d.moveinwater.com" || url.port || url.username || url.password || url.hash || !/^\/up\/[A-Za-z0-9_~%./-]+$/.test(url.pathname)) throw new Error("Invalid UC upload destination");
  return url.href;
}

/** One account-local operation. Dispatcher DNS is checked and pinned at connect time. */
export async function uploadUcAttachment(media, { jwt, uid, signal, fetchImpl = guardedFetch, onState = () => {}, timeoutMs = 30_000 }) {
  const dispatcher = new Agent({ connect: createOutboundUrlConnector("public-only") });
  const deadline = AbortSignal.timeout(timeoutMs);
  const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let state = null;
  const request = async (url, init) => {
    boundedSignal.throwIfAborted();
    let abort;
    const pending = Promise.resolve().then(() => fetchImpl(url, { ...init, redirect: "manual", dispatcher, signal: boundedSignal }));
    const canceled = new Promise((_, reject) => {
      abort = () => reject(boundedSignal.reason);
      boundedSignal.addEventListener("abort", abort, { once: true });
      if (boundedSignal.aborted) abort();
    });
    let delivered = false;
    try {
      const res = await Promise.race([pending, canceled]);
      delivered = true;
      if (res.redirected || (res.status >= 300 && res.status < 400) || (res.url && res.url !== url)) {
        cancelDiscardedResponse(res);
        throw new Error("UC upload redirect refused");
      }
      return res;
    } finally {
      boundedSignal.removeEventListener("abort", abort);
      if (!delivered) void pending.then(cancelDiscardedResponse, () => {});
    }
  };
  try {
    boundedSignal.throwIfAborted();
    state = { state: "uncertain", outcome: "signed-url" }; onState(state);
    const signed = await request("https://internal-6.pubyar.com/generate-signed-url", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", Origin: UC_ORIGIN, Referer: `${UC_ORIGIN}/` },
      body: JSON.stringify({ content_type: media.contentType, user_identifier: uid }),
    });
    if (signed.status !== 200) { cancelDiscardedResponse(signed); throw new Error("UC signed upload refused"); }
    const body = JSON.parse(await readBoundedResponseText(signed, { maxBytes: 16384, signal: boundedSignal }));
    const url = validateUcUploadUrl(body.signed_url);
    if (!isString(body.blob_name) || !/^[A-Za-z0-9_./-]{1,512}$/.test(body.blob_name) || body.blob_name.split("/").includes("..")) throw new Error("Invalid UC blob reference");
    state = { state: "uncertain", outcome: "put" }; onState(state);
    const put = await request(url, { method: "PUT", headers: { "Content-Type": media.contentType }, body: media.bytes });
    cancelDiscardedResponse(put);
    if (![200, 201, 204].includes(put.status)) throw new Error("UC upload refused");
    state = { state: "accepted", outcome: "uploaded" }; onState(state);
    // Source readiness HEAD is optional; omit its nonfatal polling and send once.
    boundedSignal.throwIfAborted();
    return { blobName: body.blob_name, contentType: media.contentType };
  } catch {
    throw Object.assign(new Error("UC attachment upload failed; upload was not retried"), { status: 502, code: "uc_attachment_upload", acceptedUpload: state });
  } finally { await dispatcher.destroy(); }
}
