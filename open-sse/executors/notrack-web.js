import { WebSessionExecutor } from "./webSessionBase.js";
import { isRefusedRedirect, requestAbortError, unpatchedGlobalFetch } from "./sendRequest.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { readBodyWithTimeout } from "../utils/bodyTimeout.js";
import { MAX_PROVIDER_BODY_BYTES, PROVIDER_BODY_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { stripCookieInputPrefix, extractCookieValue } from "../../src/lib/providers/webCookieAuth.js";
import { isRecord } from "../../src/shared/utils/typeChecks.js";

const URL = "https://notrack.ai/api/dispatch";
const UNUSABLE = "Notrack returned an unusable response";
const FAILED = "Notrack reported a generation failure";
const TIMEOUT = "Notrack response body timed out";

export function hasNotrackSession(raw) {
  const value = stripCookieInputPrefix(raw || "");
  return Boolean(value.trim() && ((extractCookieValue(value, "uid") && extractCookieValue(value, "si_usr_id") && extractCookieValue(value, "si_ses_id")) || value.trim()));
}

/** A failure found while reading an accepted NoTrack body. The message is fixed and never carries upstream text. */
class NotrackBodyError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "NotrackBodyError";
    this.status = status;
  }
}

/** Sends that provably never left the gateway: a blocked target or a strict proxy with no route. */
function provenUnsent(error) {
  return error?.code === "OUTBOUND_URL_GUARD_BLOCKED" || error?.message === "[ProxyFetch] Proxy required but unavailable (strictProxy=true)";
}

/**
 * One NoTrack wire line. Blank lines, SSE comments, and `event:`/`id:`/`retry:`
 * fields are benign and give null, as do frames without text (`chat_meta`,
 * `done`, `[DONE]`). A `delta` or `message` frame gives its text. Anything else
 * (HTML, non-JSON data, a non-object payload, or an `error` frame) throws a
 * NotrackBodyError with a fixed message.
 */
function parseLine(line) {
  if (!line.trim() || line.startsWith(":") || /^(?:id|retry|event):/.test(line)) return null;
  if (!line.startsWith("data:")) throw new NotrackBodyError(502, UNUSABLE);
  const data = line.slice(5).trim();
  if (data === "[DONE]") return null;
  let event;
  try { event = JSON.parse(data); } catch { throw new NotrackBodyError(502, UNUSABLE); }
  if (!isRecord(event)) throw new NotrackBodyError(502, UNUSABLE);
  if (event.type === "error") throw new NotrackBodyError(502, FAILED);
  if (event.type === "delta" && event.chunk != null) return { kind: "delta", text: String(event.chunk) };
  if (event.type === "message" && event.content != null) return { kind: "message", text: String(event.content) };
  return null;
}

/**
 * The terminated lines of a streamed body. Each read waits at most `idleMs`,
 * then fails with a 504 NotrackBodyError; the signal stops a pending read at
 * once. A body that ends or fails early is cancelled without waiting on the
 * provider. A final line the upstream never terminated is dropped, and a line
 * longer than MAX_PROVIDER_BODY_BYTES is refused.
 */
async function* bodyLines(body, signal, idleMs = PROVIDER_BODY_TIMEOUT_MS) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let finished = false;
  try {
    for (;;) {
      if (signal?.aborted) throw requestAbortError(signal.reason);
      let timer, onAbort;
      const stop = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new NotrackBodyError(504, TIMEOUT)), idleMs);
        onAbort = () => reject(requestAbortError(signal.reason));
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      let result;
      try {
        result = await Promise.race([reader.read(), stop]);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
      if (result.done) break;
      pending += decoder.decode(result.value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      if (pending.length > MAX_PROVIDER_BODY_BYTES) throw new NotrackBodyError(502, UNUSABLE);
      yield* lines;
    }
    finished = true;
  } finally {
    if (finished) reader.releaseLock();
    else void reader.cancel().catch(() => {});
  }
}

export class NotrackWebExecutor extends WebSessionExecutor {
  // The global fetch is looked up per call, so a proxy-aware or test fetch installed later is honoured.
  constructor(fetcher = null) { super("notrack-web", { id: "notrack-web", baseUrl: URL }, { observePatchedFetch: false }); this.fetcher = fetcher; }

  /**
   * One billable POST to /api/dispatch, never repeated here. Explicit 401/403
   * and 429 replies, a refused login redirect, and a send that provably never
   * left the gateway are ordinary refusals the gateway may answer with another
   * account. Every other failure after the send (a transport error, another
   * status, an unusable or failed body, a body deadline) may have reached
   * NoTrack: it carries `claudeRequestScoped` and `upstreamPartialOutput`, the
   * internal no-replay metadata chatCore, account selection and the outer
   * transient retry honour, so the request is not replayed on any account.
   */
  async runSession(input, { sendBillable }) {
    const err = (status, message) => ({ response: this.errorReply(status, message), url: URL, headers: {} });
    const unknown = (status, message) => {
      const response = this.errorReply(status, message);
      response.upstreamPartialOutput = true;
      return { response, url: URL, headers: { cookie: "[REDACTED]" }, claudeRequestScoped: true };
    };
    const body = input.body || {};
    if (!Array.isArray(body.messages) || !body.messages.length) return err(400, "Missing or empty messages array");
    const cookieInput = this.storedCookie(input.credentials);
    if (!hasNotrackSession(cookieInput)) return err(401, "Notrack session cookie is required");
    const values = Object.fromEntries(["uid", "si_usr_id", "si_ses_id", "nt_session"].map((n) => [n, this.cookieValue(cookieInput, n)]));
    const cookie = values.uid && values.si_usr_id && values.si_ses_id
      ? [`uid=${values.uid}`, `si_usr_id=${values.si_usr_id}`, `si_ses_id=${values.si_ses_id}`, ...(values.nt_session ? [`nt_session=${values.nt_session}`] : [])].join("; ")
      : cookieInput;
    const content = (m) => Array.isArray(m.content) ? m.content.map((x) => x?.text || "").join("\n") : String(m.content ?? "");
    const userInput = body.messages.map((m) => `[${(m.role || "user")[0].toUpperCase()}${(m.role || "user").slice(1)}]\n${content(m)}`).filter(Boolean).join("\n\n").slice(-3800);
    if (!userInput.trim()) return err(400, "Empty prompt after processing messages");
    const payload = { user_input: userInput, mode: "usual", model: "C", persona: "normal", max_turns: 6, chat_id: null, attachments: [], regenerate: false, edit: false, edit_mid: null };
    let upstream;
    try {
      upstream = await sendBillable(URL, { method: "POST", headers: { "content-type": "application/json", accept: "*/*", origin: "https://notrack.ai", referer: "https://notrack.ai/zh-CN/chat", "user-agent": "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36", cookie }, body: JSON.stringify(payload), directFetch: this.fetcher ?? unpatchedGlobalFetch() });
    } catch (e) {
      if (isQuotaDispatchUnavailable(e)) throw e;
      if (isRefusedRedirect(e)) return err(401, "Notrack session was rejected");
      const message = `Notrack connection failed: ${e.message}`;
      return provenUnsent(e) ? err(502, message) : unknown(502, message);
    }
    if (upstream.status >= 300 && upstream.status < 400) return err(401, "Notrack session was rejected");
    if (!upstream.ok) {
      const refused = upstream.status === 401 || upstream.status === 403 || upstream.status === 429;
      const reply = refused ? err : unknown;
      return reply(upstream.status >= 500 ? 502 : upstream.status, upstream.status === 429 ? "Notrack rate limited. Wait and retry." : upstream.status === 401 || upstream.status === 403 ? "Notrack session expired or invalid" : `Notrack returned HTTP ${upstream.status}`);
    }
    const model = input.model || "notrack-c";
    let lines = null;
    try {
      if (input.stream) {
        const local = new AbortController();
        const signal = input.signal ? AbortSignal.any([input.signal, local.signal]) : local.signal;
        lines = bodyLines(upstream.body, signal);
        // Hold the reply until the first text so a body that fails before any output is an error, not an empty success.
        let first;
        for (;;) {
          const next = await lines.next();
          if (next.done) throw new NotrackBodyError(502, UNUSABLE);
          first = parseLine(next.value);
          if (first) break;
        }
        return { response: new Response(this.stream(lines, first.text, model, local), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } }), url: URL, headers: { cookie: "[REDACTED]" }, transformedBody: payload };
      }
      const text = await this.collect(upstream, input.signal);
      return { response: Response.json({ id: `chatcmpl-notrack-${crypto.randomUUID().slice(0, 12)}`, object: "chat.completion", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }), url: URL, headers: { cookie: "[REDACTED]" }, transformedBody: payload };
    } catch (e) {
      // A parse failure leaves the reader parked at a yield; finishing it cancels the body.
      void lines?.return().catch(() => {});
      if (input.signal?.aborted) throw requestAbortError(input.signal.reason);
      return e instanceof NotrackBodyError ? unknown(e.status, e.message) : unknown(502, UNUSABLE);
    }
  }

  /**
   * The text of a buffered reply, read within PROVIDER_BODY_TIMEOUT_MS and
   * MAX_PROVIDER_BODY_BYTES. `delta` chunks are joined; a `message` frame is
   * used only when no delta arrived. A body without any text frame, or with an
   * unusable or error frame, throws a NotrackBodyError.
   */
  async collect(upstream, signal) {
    let raw;
    try {
      raw = await readBodyWithTimeout(upstream, { signal, maxBytes: MAX_PROVIDER_BODY_BYTES, timeoutMs: PROVIDER_BODY_TIMEOUT_MS });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw e?.name === "BodyReadTimeoutError" ? new NotrackBodyError(504, TIMEOUT) : new NotrackBodyError(502, UNUSABLE);
    }
    const lines = raw.split(/\r?\n/);
    lines.pop(); // The upstream never terminated this line.
    let text = "", output = false;
    for (const line of lines) {
      const event = parseLine(line);
      if (!event) continue;
      output = true;
      if (event.kind === "delta") text += event.text;
      else if (!text) text = event.text;
    }
    if (!output) throw new NotrackBodyError(502, UNUSABLE);
    return text;
  }

  /**
   * OpenAI chunks for the text already read and the rest of `lines`. Only a
   * body that ends cleanly gets `finish_reason: "stop"` and `[DONE]`; a later
   * unusable frame, error frame, body failure or deadline errors the stream
   * with no success terminal. Cancelling the reply cancels the upstream body.
   */
  stream(lines, firstText, model, local) {
    // Abort ends a pending read; return() ends a reader parked at a yield. Either way the body is cancelled.
    const stopUpstream = () => { local.abort(); void lines.return().catch(() => {}); };
    const enc = new TextEncoder();
    const id = `chatcmpl-notrack-${crypto.randomUUID().slice(0, 12)}`, created = Math.floor(Date.now()/1000);
    const chunk = (delta, finish = null) => enc.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    return new ReadableStream({
      start(c) { c.enqueue(chunk({ content: firstText })); },
      async pull(c) {
        try {
          for (;;) {
            const next = await lines.next();
            if (next.done) { c.enqueue(chunk({}, "stop")); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); return; }
            const event = parseLine(next.value);
            if (event) { c.enqueue(chunk({ content: event.text })); return; }
          }
        } catch (e) {
          stopUpstream();
          c.error(e instanceof NotrackBodyError || e?.name === "AbortError" ? e : new NotrackBodyError(502, UNUSABLE));
        }
      },
      cancel() { stopUpstream(); },
    });
  }
}
export default NotrackWebExecutor;
