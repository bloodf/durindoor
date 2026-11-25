import { randomInt, randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { createExecutorSender, createRequestSender, requestAbortError } from "./sendRequest.js";
import { resolveWebSocketProxyRoute } from "../utils/proxyFetch.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const BASE_URL = "https://amelia.chipotle.com";
const DOMAIN_CODE = "chipotle";

function sanitizeErrorMessage(message) {
  return String(message || "Upstream error").replace(/Bearer\s+[A-Za-z0-9._:-]+/gi, "Bearer [redacted]");
}

async function createProxyAgent(proxyUrl) {
  if (new URL(proxyUrl).protocol.startsWith("socks")) {
    const { SocksProxyAgent } = await import("socks-proxy-agent");
    return new SocksProxyAgent(proxyUrl);
  }
  const { HttpsProxyAgent } = await import("https-proxy-agent");
  return new HttpsProxyAgent(proxyUrl);
}

export function randomServerId() {
  return String(randomInt(0, 1000)).padStart(3, "0");
}

export function randomSessionId() {
  return randomUUID().replace(/-/g, "").slice(0, 32);
}

export function parseStompMessageBody(frame) {
  const nullIdx = frame.indexOf("\0");
  let bodyStart = frame.indexOf("\n\n");
  let headerLen = 2;
  if (bodyStart === -1) {
    bodyStart = frame.indexOf("\r\n\r\n");
    headerLen = 4;
  }
  if (bodyStart === -1) return "";
  return frame.substring(bodyStart + headerLen, nullIdx !== -1 ? nullIdx : undefined).replace(/\0$/, "");
}

export function extractAmeliaText(body) {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body);
    if (parsed.type === "message" && parsed.body) {
      return parsed.body.text || JSON.stringify(parsed.body);
    }
    return parsed.text || parsed.message || "";
  } catch {
    return body;
  }
}

export class AmeliaClient {
  constructor({ webSocketFactory, connectTimeoutMs, proxyOptions = null } = {}) {
    this.session = null;
    this.ws = null;
    this.stompConnected = false;
    this.messageCallbacks = new Map();
    this.connectPromise = null;
    this.webSocketFactory = webSocketFactory;
    this.connectTimeoutMs = Math.max(1, isNumber(connectTimeoutMs) ? connectTimeoutMs : 15_000);
    // One client keeps one egress route for its session cookie and socket.
    this.proxyOptions = proxyOptions;
  }

  /** Create the Amelia session and socket, unless already connected. */
  async open({ sendRequest, signal } = {}) {
    if (this.stompConnected) return;
    await this.init({ sendRequest, signal });
    await this.connect(signal);
  }

  async init({ sendRequest = createRequestSender().sendRequest, signal } = {}) {
    const res = await sendRequest(`${BASE_URL}/Amelia/api/init`, {
      headers: {
        "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/Amelia/ui/chipotle/chat?embed=iframe`
      },
      redirect: "manual",
      signal
    }, this.proxyOptions, { quotaBearing: false });
    if (!res.ok) throw new Error(`Amelia init failed: ${res.status}`);
    const data = await res.json();
    const setCookies = res.headers.getSetCookie?.() ?? [];
    this.session = {
      csrfToken: data.csrfToken,
      userId: data.user?.userId,
      cookieHeader: setCookies.map((cookie) => cookie.split(";")[0]).join("; ")
    };
  }

  async connect(signal = null) {
    if (!this.session) throw new Error("Call init() first");
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this._connect(signal);
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async _connect(signal = null) {
    const { WebSocket } = await import("ws");
    const wsUrl = `wss://amelia.chipotle.com/Amelia/api/sock/${randomServerId()}/${randomSessionId()}/websocket`;
    const route = resolveWebSocketProxyRoute(wsUrl, this.proxyOptions);
    const agent = route.enabled ? await createProxyAgent(route.url) : null;
    if (signal?.aborted) throw requestAbortError(signal.reason);
    return new Promise((resolve, reject) => {
      const headers = {
        Cookie: this.session.cookieHeader,
        Origin: BASE_URL,
        "User-Agent": "Mozilla/5.0 AppleWebKit/537.36"
      };
      const options = { headers, ...(agent ? { agent } : null) };
      const ws = this.webSocketFactory ? this.webSocketFactory(wsUrl, options) : new WebSocket(wsUrl, options);
      const settle = (done) => (value) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        done(value);
      };
      const succeed = settle(resolve);
      const fail = settle(reject);
      const timeout = setTimeout(() => {
        ws.close();
        fail(new Error("WS connect timeout"));
      }, this.connectTimeoutMs);
      const onAbort = () => {
        fail(requestAbortError(signal.reason));
        ws.close();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      ws.on("message", (raw) => this.handleSockJSFrame(raw.toString(), succeed, fail, timeout));
      ws.on("error", fail);
      ws.on("close", () => {
        this.stompConnected = false;
        this.ws = null;
      });
      this.ws = ws;
    });
  }

  handleSockJSFrame(frame, resolveConnect, rejectConnect, timeout) {
    if (frame === "o") {
      this.sendSockJS(this.buildStompConnect());
      return;
    }
    if (frame === "h") return;
    if (!frame.startsWith("a")) return;
    try {
      for (const msg of JSON.parse(frame.slice(1))) {
        this.handleStompFrame(msg, resolveConnect, rejectConnect, timeout);
      }
    } catch {

      // Ignore malformed SockJS frames.
    }}

  handleStompFrame(frame, resolveConnect, rejectConnect, timeout) {
    const command = frame.split("\n")[0].replace(/\r$/, "");
    if (command === "CONNECTED") {
      this.stompConnected = true;
      this.sendSockJS(this.buildStompSubscribe(`/queue/session.${this.session.userId}`, "sub-0"));
      this.sendSockJS(this.buildStompSubscribe("/user/queue/session", "sub-1"));
      clearTimeout(timeout);
      resolveConnect();
      return;
    }
    if (command === "MESSAGE") {
      const text = extractAmeliaText(parseStompMessageBody(frame));
      if (!text) return;
      for (const [id, cb] of this.messageCallbacks.entries()) {
        cb(text);
        this.messageCallbacks.delete(id);
      }
      return;
    }
    if (command === "ERROR") {
      clearTimeout(timeout);
      rejectConnect(new Error(`STOMP ERROR: ${frame}`));
    }
  }

  async chat(message, timeoutMs = 15_000, signal = null) {
    if (!this.stompConnected) await this.open({ signal: signal || undefined });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const callbackId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.messageCallbacks.delete(callbackId);
        reject(new Error("Response timeout"));
      }, timeoutMs);
      const onAbort = () => {
        clearTimeout(timer);
        this.messageCallbacks.delete(callbackId);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.messageCallbacks.set(callbackId, (text) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(text);
      });
      this.sendSockJS(
        this.buildStompSend(
          "/app/send",
          JSON.stringify({ message, domainCode: DOMAIN_CODE, conversationId: null, type: "text" })
        )
      );
    });
  }

  buildStompConnect() {
    return `CONNECT\naccept-version:1.1,1.0\nheart-beat:0,0\nX-CSRF-TOKEN:${this.session.csrfToken}\n\n\0`;
  }

  buildStompSubscribe(destination, id) {
    return `SUBSCRIBE\ndestination:${destination}\nid:${id}\n\n\0`;
  }

  buildStompSend(destination, body) {
    return `SEND\ndestination:${destination}\ncontent-type:application/json\ncontent-length:${Buffer.byteLength(body)}\n\n${body}\0`;
  }

  sendSockJS(stompFrame) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error("WebSocket not open");
    this.ws.send(JSON.stringify([stompFrame]));
  }

  async close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.stompConnected = false;
    this.session = null;
  }
}

const pool = [];

// Pooled clients are only reused on the egress route they were opened with.
async function getClient({ proxyOptions = null } = {}) {
  const egressKey = JSON.stringify(proxyOptions);
  const index = pool.findIndex((client) => client.egressKey === egressKey);
  if (index >= 0) return pool.splice(index, 1)[0];
  const client = new AmeliaClient({ proxyOptions });
  client.egressKey = egressKey;
  return client;
}

function releaseClient(client) {
  if (pool.length < 5) pool.push(client);else
  client.close().catch(() => {});
}

export class ChipotleExecutor extends BaseExecutor {
  constructor(clientFactory = getClient) {
    super("chipotle", { format: "openai", noAuth: true, baseUrl: `${BASE_URL}/Amelia/api/chat` });
    this.clientFactory = clientFactory;
  }

  buildUrl() {
    return `${BASE_URL}/Amelia/api/chat`;
  }

  buildHeaders() {
    return { "Content-Type": "application/json" };
  }

  transformRequest(model, body) {
    return body && isObject(body) ? { ...body, model } : body;
  }

  async execute(input) {
    const { model, stream, body, signal, log, proxyOptions = null } = input;
    if (signal?.aborted) throw requestAbortError(signal.reason);
    const sender = createExecutorSender(this, input);
    const messages = body?.messages ?? [];
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const prompt = (() => {
      const content = lastUser?.content;
      if (isString(content)) return content;
      if (!Array.isArray(content)) return "";
      return content.
      filter((part) => isString(part) || part && part.type === "text" && isString(part.text)).
      map((part) => isString(part) ? part : part.text).
      join("");
    })();
    let client = null;
    try {
      const context = { proxyOptions, signal: signal || undefined, sendRequest: sender.sendRequest };
      client = await this.clientFactory(context);
      // Session setup happens before the quota-bearing send, never inside it.
      await client.open?.(context);
      log?.info?.("CHIPOTLE", `Sending to Pepper (model=${model})`);
      const sent = await sender.sendRequest(this.buildUrl(), { signal }, proxyOptions, {
        transport: async () => {
          if (client.stompConnected === false) throw new Error("WebSocket not open");
          return { content: await client.chat(prompt, 15_000, signal) };
        }
      });
      const { content } = sent;
      if (this.clientFactory === getClient) {
        releaseClient(client);
        client = null;
      }
      const id = `chatcmpl-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      const result = (response) => {
        transferProviderAttemptDispatch(sent, response);
        return {
          response,
          url: this.buildUrl(),
          headers: this.buildHeaders(),
          transformedBody: body,
          attemptStartedAt: sender.attemptStartedAt
        };
      };
      if (stream) {
        return result(new Response(
          [
          `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
          "data: [DONE]\n\n"].
          join(""),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        ));
      }
      return result(new Response(
        JSON.stringify({
          id,
          object: "chat.completion",
          created,
          model,
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));
    } catch (err) {
      if (client && this.clientFactory === getClient) client.close().catch(() => {});
      if (isQuotaDispatchUnavailable(err)) throw err;
      if (signal?.aborted) throw requestAbortError(signal.reason);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        response: new Response(
          JSON.stringify({ error: { message: sanitizeErrorMessage(msg), type: "upstream_error", code: "CHIPOTLE_ERROR" } }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        ),
        url: this.buildUrl(),
        headers: this.buildHeaders(),
        transformedBody: body
      };
    }
  }
}

export default ChipotleExecutor;
