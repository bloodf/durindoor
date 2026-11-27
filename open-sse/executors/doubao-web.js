import { WebSessionExecutor } from "./webSessionBase.js";
import { errorResponse } from "../utils/error.js";
import { requestAbortError } from "./sendRequest.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";

const BASE = "https://www.dola.com";
const CHAT = `${BASE}/chat/completion`;
// The chat route supplies OpenAI content as text or a list of text parts.
const textOf = (value) => {
  if (Array.isArray(value)) return value.map((part) => `${part?.text || ""}`).join("\n");
  return value == null ? "" : `${value}`;
};
const promptOf = (messages) => (messages || []).map((m) => `${m.role}: ${textOf(m.content)}`).join("\n\n");

export class DoubaoWebExecutor extends WebSessionExecutor {
  constructor(deps = {}) { super("doubao-web", { id: "doubao-web", baseUrl: BASE }, { observePatchedFetch: false }); this.fetch = deps.fetch || null; }
  async runSession(input, { sendBillable }) {
    const cookie = this.cookieInput(input.credentials?.apiKey);
    const model = String(input.body?.model || input.model || "dola-speed").split("/").pop();
    const fingerprint = this.cookieValue(cookie, "s_v_web_id") || this.cookieValue(cookie, "fp");
    if (!this.cookieValue(cookie, "sessionid") || !fingerprint) return { response: errorResponse(401, "Doubao Web requires sessionid and s_v_web_id (or fp) cookies.", { type: "invalid_request_error", code: "INVALID_CREDENTIALS" }), url: CHAT, headers: {}, transformedBody: input.body };
    const query = new URLSearchParams({ aid: "495671", real_aid: "495671", device_platform: "web", device_id: "1", web_id: "1", tea_uuid: "1", web_tab_id: crypto.randomUUID(), pc_version: "3.25.3", pkg_type: "release_version", version_code: "20800", samantha_web: "1", web_platform: "browser", "use-olympus-account": "1", language: "en", region: "US", sys_region: "US", fp: fingerprint });
    const payload = { client_meta: { local_conversation_id: `local_${crypto.randomUUID()}`, conversation_id: "", bot_id: "7339470689562525703", last_section_id: "", last_message_index: null }, messages: [{ local_message_id: crypto.randomUUID(), content_block: [{ block_type: 10000, content: { text_block: { text: promptOf(input.body?.messages), icon_url: "", icon_url_dark: "", summary: "" }, pc_event_block: "" }, block_id: crypto.randomUUID(), parent_id: "", meta_info: [], append_fields: [] }], message_status: 0 }], option: { create_time_ms: Date.now(), need_deep_think: model === "dola-pro" ? 3 : 0, need_create_conversation: true, conversation_init_option: { need_ack_conversation: true }, sse_recv_event_options: { support_chunk_delta: true } }, user_context: [], ext: { fp: fingerprint, use_deep_think: model === "dola-pro" ? "3" : "0" } };
    const url = `${CHAT}?${query}`;
    const headers = { "Content-Type": "application/json", Accept: "text/event-stream", Cookie: cookie, Origin: BASE, Referer: `${BASE}/chat/`, "Agw-Js-Conv": "str", "User-Agent": "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36" };
    let upstream;
    const transport = this.fetch ? { transport: (options) => this.fetch(url, options, input.proxyOptions) } : undefined;
    const result = (response) => ({ response, url, headers, transformedBody: payload });
    try { upstream = await sendBillable(url, { method: "POST", headers, body: JSON.stringify(payload) }, transport); }
    catch (e) {
      if (isQuotaDispatchUnavailable(e)) throw e;
      if (input.signal?.aborted) throw requestAbortError(input.signal.reason);
      return result(errorResponse(502, e.message || "Dola request failed"));
    }
    if (upstream.status >= 300 && upstream.status < 400) return result(errorResponse(401, "Dola session was rejected"));
    if (!upstream.ok) return result(errorResponse(upstream.status, `Dola error: ${await upstream.text()}`));
    const extract = (obj) => { const out = []; const blocks = [...(obj?.content?.content_block || obj?.data?.content?.content_block || [])]; for (const op of obj?.patch_op || obj?.data?.patch_op || []) blocks.push(...(op?.patch_value?.content_block || [])); for (const b of blocks) if (b?.content?.text_block?.text) out.push(b.content.text_block.text); return out; };
    const chunk = (content) => `data: ${JSON.stringify({ id: "chatcmpl-dola", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;
    const raw = await upstream.text();
    const deltas = [];
    for (const block of raw.split(/\r?\n\r?\n/)) { const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n"); if (!data || data === "[DONE]") continue; try { deltas.push(...extract(JSON.parse(data))); } catch {} }
    const content = deltas.join("");
    if (input.stream) return result(new Response(`${deltas.map(chunk).join("")}data: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } }));
    return result(new Response(JSON.stringify({ id: "chatcmpl-dola", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }), { headers: { "Content-Type": "application/json" } }));
  }
}
export default DoubaoWebExecutor;
