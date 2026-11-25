import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { abortable, createExecutorSender, requestAbortError } from "./sendRequest.js";
import { settleProviderAttemptDispatch, transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { errorResponse } from "../utils/error.js";
import { containsMediaKind } from "../utils/mediaParts.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

function makeErrorResult(status, message, body, url) {
  return { response: errorResponse(status, message), url, headers: {}, transformedBody: body };
}

export const PLAYGROUND_URL = "https://playground.ai.cloudflare.com/";
const WS_URL = "wss://playground.ai.cloudflare.com/agents/playground/";

function safeMessage(value) {
  try {
    const parsed = isString(value) ? JSON.parse(value) : value;
    return String(parsed?.details || parsed?.message || "Cloudflare Playground upstream error");
  } catch { return String(value || "Cloudflare Playground upstream error"); }
}

export function cloudflareErrorStatus(message) {
  return /rate|limit|quota|throttl/i.test(message) ? 429 : 502;
}

export function toCloudflareMessages(messages = []) {
  return messages.filter((message) => ["user", "assistant"].includes(message?.role)).map((message, i) => {
    const content = isString(message.content) ? message.content : Array.isArray(message.content)
      ? message.content.map((part) => isString(part) ? part : (isString(part?.text) ? part.text : "")).join("\n") : "";
    return content ? { role: message.role, parts: [{ type: "text", text: content }], id: `m${i + 1}` } : null;
  }).filter(Boolean);
}

export function hasCloudflareUnsupportedImage(messages) {
  const pending = [messages];
  const visited = new WeakSet();
  while (pending.length) {
    const value = pending.pop();
    if (!value || (!isObject(value) && !Array.isArray(value))) continue;
    if (visited.has(value)) return true;
    visited.add(value);
    if (Array.isArray(value)) { pending.push(...value); continue; }
    if (["image", "image_url", "input_image"].includes(value.type) || Object.hasOwn(value, "image_url") || (Array.isArray(value.images) && value.images.length)) return true;
    pending.push(value.content, value.input, value.output);
  }
  return false;
}

export function parseCloudflareFrame(raw) {
  try { const frame = JSON.parse(raw); return frame?.type === "cf_agent_use_chat_response" ? frame : null; }
  catch { return null; }
}

export class PlaywrightCloudflareTransport {
  constructor(chatId) { this.chatId = chatId; this.framesQueue = []; this.waiters = []; this.closed = false; }

  push(frame) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(frame); else this.framesQueue.push(frame);
  }

  async start({ model, messages, temperature = 0.7, signal }) {
    try {
      const { chromium } = await import("playwright");
      this.browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-first-run"] });
      const context = await this.browser.newContext({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36" });
      this.page = await context.newPage();
      await this.page.goto(PLAYGROUND_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      await this.page.exposeFunction("__durindoorCfPush", (frame) => this.push(String(frame)));
      await this.page.evaluate(({ model, messages, temperature, chatId, wsBase }) => {
        const room = `playground-${crypto.randomUUID().replaceAll("-", "").slice(0, 25)}`;
        const socket = new WebSocket(`${wsBase}${room}?_pk=${crypto.randomUUID()}`);
        socket.onopen = () => {
          socket.send(JSON.stringify({ type: "cf_agent_stream_resume_request" }));
          socket.send(JSON.stringify({ type: "rpc", id: "config", method: "setConfig", args: [{ model, temperature, stream: true }] }));
          socket.send(JSON.stringify({ id: chatId, init: { method: "POST", body: JSON.stringify({ messages, trigger: "submit-message" }) }, type: "cf_agent_use_chat_request" }));
        };
        socket.onmessage = (event) => window.__durindoorCfPush(String(event.data));
        socket.onerror = () => window.__durindoorCfPush(JSON.stringify({ id: chatId, type: "cf_agent_use_chat_response", error: true, body: JSON.stringify({ message: "WebSocket error", details: "transport failed" }) }));
      }, { model: model.startsWith("@cf/") ? model : `@cf/${model}`, messages, temperature, chatId: this.chatId, wsBase: WS_URL });
      if (signal) signal.addEventListener("abort", () => void this.close(), { once: true });
      return { ok: true };
    } catch {
      await this.close();
      return { ok: false, status: 502, message: "Cloudflare Playground browser session could not start." };
    }
  }

  async *frames() {
    while (this.framesQueue.length || !this.closed) {
      if (this.framesQueue.length) { yield this.framesQueue.shift(); continue; }
      const value = await new Promise((resolve) => this.waiters.push(resolve));
      if (value === null) return;
      yield value;
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter(null);
    await this.browser?.close().catch(() => {});
  }
}

export class CloudflarePlaygroundExecutor extends BaseExecutor {
  constructor(transportFactory = (chatId) => new PlaywrightCloudflareTransport(chatId)) {
    super("cloudflare-playground", { baseUrl: PLAYGROUND_URL });
    this.transportFactory = transportFactory;
  }

  async execute(input) {
    const body = input.body || {};
    const model = input.model || body.model || "zai-org/glm-4.7-flash";
    if (hasCloudflareUnsupportedImage(body.messages) || hasCloudflareUnsupportedImage(body.input)) {
      return makeErrorResult(400, "Cloudflare Playground accepts text-only chat. Image inputs are not supported.", body, PLAYGROUND_URL);
    }
    if (["audio", "video", "document", "file"].some((kind) =>
      containsMediaKind([{ content: [body.messages, body.input, body.contents] }], kind))) {
      return makeErrorResult(400, "Cloudflare Playground accepts text-only chat. Audio, video and file inputs are not supported.", body, PLAYGROUND_URL);
    }
    if (!input.credentials?.authType || input.credentials.authType === "none" || !input.credentials.apiKey) {
      // Anonymous access is expected; do not synthesize an Authorization header.
    }
    const messages = toCloudflareMessages(body.messages || []);
    const chatId = `chatcmpl-cfp-${randomUUID().slice(0, 12)}`;
    const transport = this.transportFactory(chatId);
    const sender = createExecutorSender(this, input);
    // start() opens the browser and sends the chat frame: it is the physical send.
    // It stands in for response headers; its own timeouts bound the page load.
    const sent = await sender.sendRequest(PLAYGROUND_URL, { signal: input.signal }, input.proxyOptions, {
      transport: () => ({ reply: transport.start({ model, messages, temperature: body.temperature, signal: input.signal }) })
    });
    let started;
    try {
      started = await abortable(sent.reply, input.signal);
    } catch (error) {
      await settleProviderAttemptDispatch(sent, { reason: input.signal?.aborted ? "abort" : "transport_error" });
      if (!input.signal?.aborted) throw error;
      void sent.reply.finally(() => transport.close()).catch(() => {});
      throw requestAbortError(input.signal.reason);
    }
    // Every result after the send carries its quota ticket.
    const carry = (result) => {
      transferProviderAttemptDispatch(sent, result.response);
      return { ...result, attemptStartedAt: sender.attemptStartedAt };
    };
    if (!started.ok) return carry(makeErrorResult(started.status || 502, started.message, body, PLAYGROUND_URL));
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void transport.close();
    }, 120_000);
    const text = [];
    let error = null;
    const events = (async function* () {
      for await (const raw of transport.frames()) {
        const frame = parseCloudflareFrame(raw);
        if (!frame || frame.id !== chatId) continue;
        if (frame.error) { error = safeMessage(frame.body); break; }
        let payload;
        try { payload = isString(frame.body) ? JSON.parse(frame.body) : frame.body; } catch { continue; }
        if (payload?.type === "text-delta" && isString(payload.delta)) { text.push(payload.delta); yield payload.delta; }
        if (frame.done) break;
      }
    })();
    if (input.stream !== false) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({ start(controller) {
        void (async () => {
          try {
            for await (const delta of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: chatId, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}\n\n`));
            if (error || timedOut) {
              const message = error || "Cloudflare Playground timed out";
              const status = error ? cloudflareErrorStatus(error) : 504;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message, type: "upstream_error", code: `HTTP_${status}` } })}\n\n`));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
          } catch (err) { controller.error(err); }
          finally { clearTimeout(timeout); await transport.close(); }
        })();
      } });
      return carry({ response: new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }), url: PLAYGROUND_URL, headers: {}, transformedBody: body });
    }
    try { for await (const _delta of events) { /* consume */ } }
    finally { clearTimeout(timeout); }
    await transport.close();
    if (timedOut && !text.length) return carry(makeErrorResult(504, "Cloudflare Playground timed out", body, PLAYGROUND_URL));
    if (error) return carry(makeErrorResult(cloudflareErrorStatus(error), error, body, PLAYGROUND_URL));
    const content = text.join("");
    return carry({ response: new Response(JSON.stringify({ id: chatId, object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), { headers: { "Content-Type": "application/json" } }), url: PLAYGROUND_URL, headers: {}, transformedBody: body });
  }
}
