import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { refreshGitLabDuoToken } from "../services/tokenRefresh/providers.js";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function extractText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map(part => {
      if (!part || typeof part !== "object") return "";
      if ((part.type === "text" || part.type === "input_text") && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function hasToolExchange(messages) {
  return messages.some(message => {
    const role = String(message?.role || "user").toLowerCase();
    return role === "tool" || (role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0);
  });
}

function renderAssistant(message, text) {
  const lines = [];
  if (text) lines.push(text);
  for (const toolCall of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    const id = toolCall.id ? ` [${toolCall.id}]` : "";
    lines.push(`Called tool ${toolCall.function?.name || "tool"}${id} with arguments: ${toolCall.function?.arguments ?? ""}`);
  }
  return lines.length ? `Assistant: ${lines.join("\n")}` : null;
}

function buildPrompt(messages = []) {
  if (!Array.isArray(messages)) return "";
  const systemParts = [];
  const conversation = [];
  const includesToolExchange = hasToolExchange(messages);

  for (const message of messages) {
    const role = String(message?.role || "user").toLowerCase();
    const text = extractText(message?.content);
    if (role === "system" || role === "developer") {
      if (text) systemParts.push(text);
      continue;
    }
    if (role === "user" && text) conversation.push(`User: ${text}`);
    if (role === "assistant") {
      const line = renderAssistant(message, text);
      if (line) conversation.push(line);
    }
    if (role === "tool") {
      const id = message.tool_call_id ? ` for ${message.tool_call_id}` : "";
      const name = message.name ? ` (${message.name})` : "";
      conversation.push(`Tool result${name}${id}: ${text}`);
    }
  }
  const header = systemParts.length ? `System instructions:\n${systemParts.join("\n\n")}\n\n` : "";
  const suffix = includesToolExchange ? "\n\nContinue the response using the tool result above; do not repeat the tool call." : "";
  return `${header}${conversation.join("\n\n")}${suffix}`.trim();
}

function resolveGitLabBase(credentials) {
  return String(credentials?.providerSpecificData?.baseUrl || process.env.GITLAB_DUO_BASE_URL || process.env.GITLAB_BASE_URL || "https://gitlab.com").replace(/\/$/, "");
}

function buildRequestBody(model, body, credentials) {
  const providerData = asObject(credentials?.providerSpecificData);
  const prompt = buildPrompt(body?.messages || []);
  const fileName = providerData.fileName || "durindoor-chat.md";
  const requestBody = {
    prompt_version: 1,
    project_path: providerData.projectPath || "durindoor/session",
    project_id: providerData.projectId || undefined,
    current_file: {
      file_name: fileName,
      content_above_cursor: prompt,
      content_below_cursor: "",
    },
    intent: providerData.intent || "generation",
    user_instruction: prompt,
    model_provider: providerData.modelProvider || undefined,
  };
  if (providerData.upstreamModelName) {
    requestBody.model_name = providerData.upstreamModelName;
  }
  return requestBody;
}

function resolveText(payload) {
  const first = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  return first?.message?.content ?? first?.text ?? payload?.content ?? payload?.completion ?? "";
}

function resolveModel(payload, fallback) {
  if (typeof payload?.model === "string" && payload.model) return payload.model;
  if (typeof payload?.model?.name === "string") return payload.model.name;
  if (typeof payload?.metadata?.model_details?.model_name === "string") {
    return payload.metadata.model_details.model_name;
  }
  return fallback;
}

function completionResponse(payload, fallbackModel) {
  const model = resolveModel(payload, fallbackModel);
  return {
    id: payload?.id || `chatcmpl-gitlab-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: resolveText(payload) },
      finish_reason: payload?.choices?.[0]?.finish_reason || "stop",
    }],
    usage: payload?.usage,
  };
}

function streamFromCompletion(json) {
  const enc = new TextEncoder();
  const text = json.choices?.[0]?.message?.content || "";
  const stream = new ReadableStream({
    start(controller) {
      const emit = value => controller.enqueue(enc.encode(`data: ${JSON.stringify(value)}\n\n`));
      emit({ ...json, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
      if (text) emit({ ...json, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
      emit({ ...json, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: { message, type: status === 401 || status === 403 ? "authentication_error" : "api_error" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class GitlabExecutor extends BaseExecutor {
  constructor(provider = "gitlab-duo") {
    super(provider, PROVIDERS[provider] || PROVIDERS["gitlab-duo"]);
  }

  buildUrl(_model, _stream, _urlIndex = 0, credentials = null) {
    return `${resolveGitLabBase(credentials)}/api/v4/code_suggestions/completions`;
  }

  buildHeaders(credentials) {
    const token = credentials?.apiKey || credentials?.accessToken;
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  transformRequest(model, body, _stream, credentials) {
    return buildRequestBody(model, body || {}, credentials || {});
  }

  async execute({ model, body, stream, credentials, signal, proxyOptions = null }) {
    const url = this.buildUrl(model, stream, 0, credentials);
    const headers = this.buildHeaders(credentials);
    const transformedBody = this.transformRequest(model, body, stream, credentials);
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal: signal || undefined,
    }, proxyOptions);
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { message: text };
    }
    if (!response.ok) {
      return { response: errorResponse(response.status, `GitLab Duo auth failed or request rejected: ${payload?.message || text}`), url, headers, transformedBody };
    }
    const json = completionResponse(payload, model);
    return {
      response: stream ? streamFromCompletion(json) : new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } }),
      url,
      headers,
      transformedBody,
    };
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    return refreshGitLabDuoToken(credentials?.refreshToken, { ...credentials, proxyOptions }, log);
  }
}
