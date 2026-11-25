import { BaseExecutor } from "./base.js";
import { createExecutorSender, requestAbortError, unpatchedGlobalFetch, withBillableDispatch } from "./sendRequest.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { stripCookieInputPrefix, extractCookieValue } from "../../src/lib/providers/webCookieAuth.js";

const URL = "https://notrack.ai/api/dispatch";
const err = (status, message) => ({ response: Response.json({ error: { message, type: "upstream_error", code: `HTTP_${status}` } }, { status }), url: URL, headers: {} });
export function hasNotrackSession(raw) {
  const value = stripCookieInputPrefix(raw || "");
  return Boolean(value.trim() && ((extractCookieValue(value, "uid") && extractCookieValue(value, "si_usr_id") && extractCookieValue(value, "si_ses_id")) || value.trim()));
}

export class NotrackWebExecutor extends BaseExecutor {
  // The global fetch is looked up per call, so a proxy-aware or test fetch installed later is honoured.
  constructor(fetcher = null) { super("notrack-web", { id: "notrack-web", baseUrl: URL }); this.fetcher = fetcher; }
  async execute(input) {
    if (input.signal?.aborted) throw requestAbortError(input.signal.reason);
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    return withBillableDispatch(sender, (billed) => this.runChat(input, sender, billed));
  }
  async runChat(input, sender, billed) {
    const body = input.body || {};
    if (!Array.isArray(body.messages) || !body.messages.length) return err(400, "Missing or empty messages array");
    const raw = input.credentials?.apiKey || input.credentials?.providerSpecificData?.cookie || "";
    const cookieInput = stripCookieInputPrefix(raw);
    if (!hasNotrackSession(cookieInput)) return err(401, "Notrack session cookie is required");
    const values = Object.fromEntries(["uid", "si_usr_id", "si_ses_id", "nt_session"].map((n) => [n, extractCookieValue(cookieInput, n)]));
    const cookie = values.uid && values.si_usr_id && values.si_ses_id
      ? [`uid=${values.uid}`, `si_usr_id=${values.si_usr_id}`, `si_ses_id=${values.si_ses_id}`, ...(values.nt_session ? [`nt_session=${values.nt_session}`] : [])].join("; ")
      : cookieInput;
    const content = (m) => Array.isArray(m.content) ? m.content.map((x) => x?.text || "").join("\n") : String(m.content ?? "");
    const userInput = body.messages.map((m) => `[${(m.role || "user")[0].toUpperCase()}${(m.role || "user").slice(1)}]\n${content(m)}`).filter(Boolean).join("\n\n").slice(-3800);
    if (!userInput.trim()) return err(400, "Empty prompt after processing messages");
    const payload = { user_input: userInput, mode: "usual", model: "C", persona: "normal", max_turns: 6, chat_id: null, attachments: [], regenerate: false, edit: false, edit_mid: null };
    let upstream;
    try {
      upstream = billed(await sender.sendRequest(URL, { method: "POST", redirect: "manual", signal: input.signal, headers: { "content-type": "application/json", accept: "*/*", origin: "https://notrack.ai", referer: "https://notrack.ai/zh-CN/chat", "user-agent": "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36", cookie }, body: JSON.stringify(payload), directFetch: this.fetcher ?? unpatchedGlobalFetch() }, input.proxyOptions));
    } catch (e) { if (isQuotaDispatchUnavailable(e)) throw e; return err(502, `Notrack connection failed: ${e.message}`); }
    if (upstream.status >= 300 && upstream.status < 400) return err(401, "Notrack session was rejected");
    if (!upstream.ok) return err(upstream.status >= 500 ? 502 : upstream.status, upstream.status === 429 ? "Notrack rate limited. Wait and retry." : upstream.status === 401 || upstream.status === 403 ? "Notrack session expired or invalid" : `Notrack returned HTTP ${upstream.status}`);
    if (input.stream) return { response: new Response(this.stream(upstream.body, input.model || "notrack-c"), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } }), url: URL, headers: { cookie: "[REDACTED]" }, transformedBody: payload };
    const text = await this.collect(upstream.body);
    return { response: Response.json({ id: `chatcmpl-notrack-${crypto.randomUUID().slice(0, 12)}`, object: "chat.completion", created: Math.floor(Date.now()/1000), model: input.model || "notrack-c", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }), url: URL, headers: { cookie: "[REDACTED]" }, transformedBody: payload };
  }
  async collect(stream) {
    let buffer = "", text = "";
    for await (const chunk of stream) { buffer += new TextDecoder().decode(chunk); const lines = buffer.split(/\r?\n/); buffer = lines.pop(); for (const line of lines) if (line.startsWith("data:")) { try { const e = JSON.parse(line.slice(5)); if (e.type === "delta") text += e.chunk || ""; else if (e.type === "message" && !text) text = e.content || ""; } catch {} } }
    return text;
  }
  stream(stream, model) {
    const self = this;
    return new ReadableStream({ async start(c) { const enc = new TextEncoder(); const id = `chatcmpl-notrack-${crypto.randomUUID().slice(0, 12)}`, created = Math.floor(Date.now()/1000); const emit = (delta, finish = null) => c.enqueue(enc.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)); let buffer = ""; for await (const chunk of stream) { buffer += new TextDecoder().decode(chunk); const lines = buffer.split(/\r?\n/); buffer = lines.pop(); for (const line of lines) if (line.startsWith("data:")) { try { const e = JSON.parse(line.slice(5)); if (e.type === "delta" && e.chunk != null) emit({ content: String(e.chunk) }); else if (e.type === "message" && e.content != null) emit({ content: String(e.content) }); } catch {} } } emit({}, "stop"); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } });
  }
}
export default NotrackWebExecutor;
