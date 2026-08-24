import { randomInt, randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const BASE_URL = "https://amelia.chipotle.com";
const DOMAIN_CODE = "chipotle";

function sanitizeErrorMessage(message) {
  return String(message || "Upstream error").replace(/Bearer\s+[A-Za-z0-9._:-]+/gi, "Bearer [redacted]");
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
  constructor({ webSocketFactory, connectTimeoutMs } = {}) {
    this.session = null;
    this.ws = null;
    this.stompConnected = false;
    this.messageCallbacks = new Map();
    this.connectPromise = null;
    this.webSocketFactory = webSocketFactory;
    this.connectTimeoutMs = Math.max(1, isNumber(connectTimeoutMs) ? connectTimeoutMs : 15_000);
  }

  async init() {
    const res = await fetch(`${BASE_URL}/Amelia/api/init`, {
      headers: {
        "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/Amelia/ui/chipotle/chat?embed=iframe`
      },
      redirect: "manual"
    });
    if (!res.ok) throw new Error(`Amelia init failed: ${res.status}`);
    const data = await res.json();
    const setCookies = res.headers.getSetCookie?.() ?? [];
    this.session = {
      csrfToken: data.csrfToken,
      userId: data.user?.userId,
      cookieHeader: setCookies.map((cookie) => cookie.split(";")[0]).join("; ")
    };
  }

  async connect() {
    if (!this.session) throw new Error("Call init() first");
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this._connect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async _connect() {
    const { WebSocket } = await import("ws");
    const wsUrl = `wss://amelia.chipotle.com/Amelia/api/sock/${randomServerId()}/${randomSessionId()}/websocket`;
    return new Promise((resolve, reject) => {
      const headers = {
        Cookie: this.session.cookieHeader,
        Origin: BASE_URL,
        "User-Agent": "Mozilla/5.0 AppleWebKit/537.36"
      };
      const ws = this.webSocketFactory ? this.webSocketFactory(wsUrl, { headers }) : new WebSocket(wsUrl, { headers });
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WS connect timeout"));
      }, this.connectTimeoutMs);
      ws.on("message", (raw) => this.handleSockJSFrame(raw.toString(), resolve, reject, timeout));
      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
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
    if (!this.stompConnected) {
      await this.init();
      await this.connect();
    }
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

async function getClient() {
  if (pool.length > 0) return pool.pop();
  const client = new AmeliaClient();
  await client.init();
  await client.connect();
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
    const { model, stream, body, signal, log } = input;
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
      client = await this.clientFactory();
      log?.info?.("CHIPOTLE", `Sending to Pepper (model=${model})`);
      const content = await client.chat(prompt, 15_000, signal);
      if (this.clientFactory === getClient) {
        releaseClient(client);
        client = null;
      }
      const id = `chatcmpl-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      if (stream) {
        return {
          response: new Response(
            [
            `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`,
            `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
            "data: [DONE]\n\n"].
            join(""),
            { status: 200, headers: { "Content-Type": "text/event-stream" } }
          ),
          url: this.buildUrl(),
          headers: this.buildHeaders(),
          transformedBody: body
        };
      }
      return {
        response: new Response(
          JSON.stringify({
            id,
            object: "chat.completion",
            created,
            model,
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
        url: this.buildUrl(),
        headers: this.buildHeaders(),
        transformedBody: body
      };
    } catch (err) {
      if (client && this.clientFactory === getClient) client.close().catch(() => {});
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