import { isObject } from "../../src/shared/utils/typeChecks.js";
import { WebSessionExecutor } from "./webSessionBase.js";
import { errorResponse } from "../utils/error.js";
import { cancelDiscardedResponse, requestAbortError } from "./sendRequest.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { readBodyWithTimeout } from "../utils/bodyTimeout.js";
import { MAX_PROVIDER_BODY_BYTES, PROVIDER_BODY_TIMEOUT_MS } from "../config/runtimeConfig.js";

const BASE = "https://www.dola.com";
const CHAT = `${BASE}/chat/completion`;
// The chat route supplies OpenAI content as text or a list of text parts.
const textOf = (value) => {
  if (Array.isArray(value)) return value.map((part) => `${part?.text || ""}`).join("\n");
  return value == null ? "" : `${value}`;
};
const promptOf = (messages) => (messages || []).map((m) => `${m.role}: ${textOf(m.content)}`).join("\n\n");

/**
 * Dola's credential-bearing request stays on the selected fixed-host transport.
 * Diagnostic metadata and errors never contain upstream prose or wire credentials.
 * Buffer and validate the bounded source body before publishing any successful
 * output: failed generation is request-scoped and must not replay on a sibling.
 * Complete MESSAGE_DELTA/STREAM_CHUNK EOF remains source-compatible (#2034).
 */
export class DoubaoWebExecutor extends WebSessionExecutor {
  constructor(deps = {}) { super("doubao-web", { id: "doubao-web", baseUrl: BASE }, { observePatchedFetch: false }); this.fetch = deps.fetch || null; }
  async runSession(input, { sendBillable }) {
    const cookie = this.cookieInput(input.credentials?.apiKey);
    const model = String(input.body?.model || input.model || "dola-speed").split("/").pop();
    const fingerprint = this.cookieValue(cookie, "s_v_web_id") || this.cookieValue(cookie, "fp");
    if (!this.cookieValue(cookie, "sessionid") || !fingerprint) return { response: errorResponse(401, "Doubao Web requires sessionid and s_v_web_id (or fp) cookies.", { type: "invalid_request_error", code: "INVALID_CREDENTIALS" }), url: CHAT, headers: {}, transformedBody: null };
    const query = new URLSearchParams({ aid: "495671", real_aid: "495671", device_platform: "web", device_id: "1", web_id: "1", tea_uuid: "1", web_tab_id: crypto.randomUUID(), pc_version: "3.25.3", pkg_type: "release_version", version_code: "20800", samantha_web: "1", web_platform: "browser", "use-olympus-account": "1", language: "en", region: "US", sys_region: "US", fp: fingerprint });
    const payload = { client_meta: { local_conversation_id: `local_${crypto.randomUUID()}`, conversation_id: "", bot_id: "7339470689562525703", last_section_id: "", last_message_index: null }, messages: [{ local_message_id: crypto.randomUUID(), content_block: [{ block_type: 10000, content: { text_block: { text: promptOf(input.body?.messages), icon_url: "", icon_url_dark: "", summary: "" }, pc_event_block: "" }, block_id: crypto.randomUUID(), parent_id: "", meta_info: [], append_fields: [] }], message_status: 0 }], option: { create_time_ms: Date.now(), need_deep_think: model === "dola-pro" ? 3 : 0, need_create_conversation: true, conversation_init_option: { need_ack_conversation: true }, sse_recv_event_options: { support_chunk_delta: true } }, user_context: [], ext: { fp: fingerprint, use_deep_think: model === "dola-pro" ? "3" : "0" } };
    const url = `${CHAT}?${query}`;
    const headers = { "Content-Type": "application/json", Accept: "text/event-stream", Cookie: cookie, Origin: BASE, Referer: `${BASE}/chat/`, "Agw-Js-Conv": "str", "User-Agent": "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36" };
    let upstream;
    const transport = this.fetch ? { transport: (options) => this.fetch(url, options, input.proxyOptions) } : undefined;
    // These fields cross chatCore's request/error log boundary. Keep the real
    // fingerprint and Cookie exclusively on the physical send, never diagnostics.
    const result = (response, requestScoped = false) => ({
      response, url: CHAT, headers: { "Content-Type": "application/json" },
      transformedBody: null,
      // Existing gateway request-scoped terminal flag suppresses all account and
      // outer transient replays. A failed generation may already have spent work.
      claudeRequestScoped: requestScoped,
    });
    const failedTurn = () => result(errorResponse(502, "Dola generation failed", {
      type: "upstream_error", code: "upstream_outcome_unknown",
    }), true);
    try { upstream = await sendBillable(url, { method: "POST", headers, body: JSON.stringify(payload) }, transport); }
    catch (e) {
      if (isQuotaDispatchUnavailable(e)) throw e;
      if (input.signal?.aborted) throw requestAbortError();
      return result(errorResponse(502, "Dola request failed"));
    }
    if (!upstream.ok) {
      cancelDiscardedResponse(upstream);
      const status = upstream.status >= 300 && upstream.status < 400 ? 401 : upstream.status;
      const message = status === 401 || status === 403 ? "Dola session was rejected" :
        status === 429 ? "Dola quota exceeded" : "Dola upstream request failed";
      // Retain numeric quota timing without copying arbitrary upstream headers.
      const retryAfter = upstream.headers.get("retry-after") || "";
      const retrySeconds = status === 429 && /^\d{1,6}$/.test(retryAfter) ? Number(retryAfter) : null;
      return result(errorResponse(status, message, null, retrySeconds));
    }
    if (!(upstream.headers.get("content-type") || "").toLowerCase().includes("text/event-stream")) {
      cancelDiscardedResponse(upstream);
      return result(errorResponse(502, "Dola returned an empty or unusable response"));
    }
    const extract = (obj) => { const out = []; const blocks = [...(obj?.content?.content_block || obj?.data?.content?.content_block || [])]; for (const op of obj?.patch_op || obj?.data?.patch_op || []) blocks.push(...(op?.patch_value?.content_block || [])); for (const b of blocks) if (b?.content?.text_block?.text) out.push(b.content.text_block.text); return out; };
    const chunk = (content) => `data: ${JSON.stringify({ id: "chatcmpl-dola", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;
    let raw;
    try {
      raw = await readBodyWithTimeout(upstream, {
        signal: input.signal, maxBytes: MAX_PROVIDER_BODY_BYTES, timeoutMs: PROVIDER_BODY_TIMEOUT_MS,
      });
    } catch {
      if (input.signal?.aborted) throw requestAbortError();
      return failedTurn();
    }
    const deltas = [];
    let ended = false;
    try {
      // EOF after a complete source event remains compatible with the existing
      // MESSAGE_DELTA/STREAM_CHUNK contract. An incomplete final frame is not EOF success.
      if (!/\r?\n\r?\n$/.test(raw)) return failedTurn();
      for (const block of raw.split(/\r?\n\r?\n/)) {
        const lines = block.split(/\r?\n/);
        const event = lines.filter((line) => line.startsWith("event:")).at(-1)?.slice(6).trim();
        const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data && !event) continue;
        if (event === "STREAM_ERROR" || event === "error") return failedTurn();
        if (data === "[DONE]") { ended = true; continue; }
        if (ended) return failedTurn();
        if (!data) return failedTurn();
        const obj = JSON.parse(data);
        if (!obj || !isObject(obj) || Array.isArray(obj)) return failedTurn();
        if (obj.error || (obj?.code != null && obj.code !== 0)) return failedTurn();
        deltas.push(...extract(obj));
        if (event === "STREAM_END" || event === "STREAM_FINISH") ended = true;
      }
    } catch { return failedTurn(); }
    if (!deltas.length) return result(errorResponse(502, "Dola returned an empty or unusable response"));
    const content = deltas.join("");
    if (input.stream) return result(new Response(`${deltas.map(chunk).join("")}data: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } }));
    return result(new Response(JSON.stringify({ id: "chatcmpl-dola", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }), { headers: { "Content-Type": "application/json" } }));
  }
}
export default DoubaoWebExecutor;
