import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const STREAM_TIMEOUT_MS = parseInt(process.env.TRAE_STREAM_TIMEOUT_MS || "300000", 10);

function flattenQuery(messages = []) {
  const parts = [];
  for (const message of messages) {
    let content = "";
    if (isString(message.content)) content = message.content;else
    if (Array.isArray(message.content)) {
      content = message.content.map((part) => {
        if (isString(part)) return part;
        if (part && isObject(part)) return String(part.text ?? "");
        return "";
      }).join("");
    }
    if (message.role === "system") parts.push(`[System]\n${content}`);else
    if (message.role === "assistant") parts.push(`[Assistant]\n${content}`);else
    parts.push(content);
  }
  return JSON.stringify([{ type: "text", data: { content: parts.join("\n\n") } }]);
}

function safeErrorMessage(value) {
  return String(value || "Trae request failed").replace(/\s+at\s+.*$/gs, "").slice(0, 800);
}

export class TraeExecutor extends BaseExecutor {
  constructor() {
    super("trae", PROVIDERS.trae);
  }

  base() {
    return (this.config.baseUrl || "https://core-normal.trae.ai/api/remote/v1").replace(/\/$/, "");
  }

  buildHeaders(credentials = {}) {
    const providerData = credentials.providerSpecificData || {};
    return {
      Authorization: `Cloud-IDE-JWT ${credentials.accessToken || credentials.apiKey || ""}`,
      "Content-Type": "application/json",
      "X-Trae-Client-Type": "web",
      "X-Preferenced-Language": providerData.appLanguage || "en",
      "x-user-region": providerData.userRegion || "US",
      Referer: "https://solo.trae.ai/",
      "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome Safari TraeWeb"
    };
  }

  resolveMode(model) {
    const normalized = String(model || "").trim().toLowerCase();
    if (normalized === "work" || normalized === "auto-work" || normalized === "solo-work") {
      return { mode: "work", strategy: "auto", modelName: "" };
    }
    const auto = !normalized || normalized === "auto";
    return { mode: "code", strategy: auto ? "auto" : "manual", modelName: auto ? "" : model };
  }

  commonParams(providerData, mode, sessionId) {
    const params = {
      language: "en-us",
      app_language: providerData.appLanguage || "en",
      quality: "stable",
      app_version: providerData.appVersion || "1.0.0.1229",
      web_id: providerData.webId || "",
      user_identity: providerData.userIdentity || "Free",
      is_freshman: "0",
      biz_user_id: providerData.bizUserId || "",
      user_unique_id: providerData.userUniqueId || "",
      scope: providerData.scope || "marscode-us",
      tenant: providerData.tenant || "marscode",
      region: providerData.region || "US-East",
      aiRegion: providerData.aiRegion || providerData.region || "US-East",
      is_privacy_mode: 0,
      privacy_mode: "off",
      solo_chat_mode: mode
    };
    if (sessionId) params.biz_session_id = sessionId;
    return JSON.stringify(params);
  }

  async createSession(headers, query, model, providerData, signal) {
    const { mode, strategy, modelName } = this.resolveMode(model);
    const requestBody = {
      mode,
      environment_id: "default",
      initial_message: {
        chat_session_id: "",
        content: [],
        query,
        model_name: modelName,
        agent_type: "solo_agent_remote",
        model_selection_strategy: strategy,
        common_params: this.commonParams(providerData, mode)
      },
      env: "remote",
      auto_create_project: false,
      origin: "web"
    };
    const response = await fetch(`${this.base()}/chat_sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: signal || undefined
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`[${response.status}] ${text}`);
    const json = JSON.parse(text);
    if (json?.code !== 0) throw new Error(`Trae create_session: ${JSON.stringify(json)}`);
    return { sessionId: json.data.chat_session_id, messageId: json.data.message_id };
  }

  async streamEvents(headers, sessionId, replyTo, onEvent, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("trae stream timeout")), STREAM_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    try {
      const url = `${this.base()}/chat_sessions/${sessionId}/events?reply_to_message_id=${encodeURIComponent(replyTo)}`;
      const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`[${response.status}] events stream failed`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (line.startsWith("event:")) eventName = line.slice(6).trim();else
          if (line.startsWith("data:")) {
            let data;
            try {
              data = JSON.parse(line.slice(5).trim());
            } catch {
              data = { _raw: line.slice(5).trim() };
            }
            if (onEvent(eventName, data)) {
              await reader.cancel().catch(() => {});
              return;
            }
          } else if (line === "") {
            eventName = null;
          }
        }
      }
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  async execute({ model, body, stream, credentials, signal }) {
    const headers = this.buildHeaders(credentials);
    const providerData = credentials?.providerSpecificData || {};
    const query = flattenQuery(body?.messages || []);
    const responseId = `chatcmpl-trae-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let session;
    try {
      session = await this.createSession(headers, query, model, providerData, signal);
    } catch (error) {
      return {
        response: new Response(JSON.stringify({ error: { message: safeErrorMessage(error.message), type: "api_error", code: "" } }), {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }),
        url: this.base(),
        headers,
        transformedBody: body
      };
    }

    const order = [];
    const thoughts = {};
    let sent = 0;
    let usage = null;
    let errorEvent = null;
    const renderNewText = (data) => {
      const id = data.id;
      if (!id) return "";
      if (!(id in thoughts)) order.push(id);
      const next = data.thought || "";
      if (next.length >= (thoughts[id] || "").length) thoughts[id] = next;
      const full = order.map((item) => thoughts[item]).join("");
      const piece = full.slice(sent);
      sent = full.length;
      return piece;
    };

    if (stream !== false) {
      const enc = new TextEncoder();
      const sse = new ReadableStream({
        start: async (controller) => {
          const emit = (obj) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
          try {
            emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
            await this.streamEvents(headers, session.sessionId, session.messageId, (eventName, data) => {
              if (eventName === "error") {
                errorEvent = data;
                return true;
              }
              if (eventName === "token_usage") usage = data;
              if (eventName === "plan_item") {
                const piece = renderNewText(data);
                if (piece) emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
              }
              return eventName === "done";
            }, signal);
            if (errorEvent) emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [], error: { message: `trae ${errorEvent.code}: ${errorEvent.message}`, type: "api_error" } });else
            emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage });
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
          } catch (error) {
            emit({ error: { message: safeErrorMessage(error.message), type: "api_error" } });
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
          } finally {
            controller.close();
          }
        }
      });
      return {
        response: new Response(sse, { headers: { "Content-Type": "text/event-stream" } }),
        url: this.base(),
        headers,
        transformedBody: body
      };
    }

    await this.streamEvents(headers, session.sessionId, session.messageId, (eventName, data) => {
      if (eventName === "error") {
        errorEvent = data;
        return true;
      }
      if (eventName === "token_usage") usage = data;
      if (eventName === "plan_item") renderNewText(data);
      return eventName === "done";
    }, signal);

    if (errorEvent) {
      return {
        response: new Response(JSON.stringify({ error: { message: safeErrorMessage(`trae ${errorEvent.code}: ${errorEvent.message}`), type: "api_error", code: "" } }), {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }),
        url: this.base(),
        headers,
        transformedBody: body
      };
    }

    const text = order.map((item) => thoughts[item]).join("");
    const json = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage
    };
    return {
      response: new Response(JSON.stringify(json), { headers: { "Content-Type": "application/json" } }),
      url: this.base(),
      headers,
      transformedBody: body
    };
  }
}