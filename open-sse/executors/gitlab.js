import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { settleProviderAttemptDispatch, transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { cancelDiscardedResponse, createExecutorSender, requestAbortError } from "./sendRequest.js";
import { assertOutboundUrlAllowed } from "../utils/outboundUrlGuard.js";
import { isFunction, isObject, isString } from "../../src/shared/utils/typeChecks.js";
import {
  buildGitLabDirectGatewayUrl,
  buildGitLabDirectHeaders,
  gitlabDirectAccessUrl,
  gitlabRequestError,
  isCacheableGitLabDirectAccess,
  isGitLabDirectAccessRejection,
  normalizeGitLabRoot,
  parseGitLabDirectAccess,
  readCachedGitLabDirectAccess
} from "../../src/lib/oauth/providerParity/gitlab/directAccess.js";

function asObject(value) {
  return value && isObject(value) && !Array.isArray(value) ? value : {};
}

function extractText(content) {
  if (isString(content)) return content.trim();
  if (!Array.isArray(content)) return "";
  return content.
  map((part) => {
    if (!part || !isObject(part)) return "";
    if ((part.type === "text" || part.type === "input_text") && isString(part.text)) {
      return part.text;
    }
    return "";
  }).
  filter(Boolean).
  join("\n").
  trim();
}

function hasToolExchange(messages) {
  return messages.some((message) => {
    const role = String(message?.role || "user").toLowerCase();
    return role === "tool" || role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
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
  const userParts = [];

  if (!hasToolExchange(messages)) {
    for (const message of messages) {
      const role = String(message?.role || "user").toLowerCase();
      const text = extractText(message?.content);
      if (!text) continue;
      if (role === "system" || role === "developer") systemParts.push(text);else
      if (role === "user") userParts.push(text);
    }
    const latestUser = userParts.at(-1) || "";
    return systemParts.length ? `System instructions:\n${systemParts.join("\n\n")}\n\n${latestUser}`.trim() : latestUser;
  }

  const conversation = [];
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
  return `${header}${conversation.join("\n\n")}\n\nContinue the response using the tool result above; do not repeat the tool call.`.trim();
}

function resolveGitLabBase(credentials) {
  return String(credentials?.providerSpecificData?.baseUrl || process.env.GITLAB_DUO_BASE_URL || process.env.GITLAB_BASE_URL || "https://gitlab.com").replace(/\/$/, "");
}

function buildRequestBody(model, body, credentials) {
  const providerData = asObject(credentials?.providerSpecificData);
  const prompt = buildPrompt(body?.messages || []);
  const fileName = providerData.fileName || "durindoor-chat.md";
  return {
    prompt_version: 1,
    project_path: providerData.projectPath || "durindoor/session",
    project_id: providerData.projectId || undefined,
    current_file: {
      file_name: fileName,
      content_above_cursor: prompt,
      content_below_cursor: ""
    },
    intent: providerData.intent || "generation",
    user_instruction: prompt,
    model_provider: providerData.modelProvider || undefined,
    model_name: model
  };
}

function resolveText(payload) {
  const first = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  return first?.message?.content ?? first?.text ?? payload?.content ?? payload?.completion ?? "";
}

function resolveModel(payload, fallback) {
  if (isString(payload?.model) && payload.model) return payload.model;
  if (isString(payload?.model?.name)) return payload.model.name;
  if (isString(payload?.metadata?.model_details?.model_name)) {
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
      finish_reason: payload?.choices?.[0]?.finish_reason || "stop"
    }],
    usage: payload?.usage
  };
}

function streamFromCompletion(json) {
  const enc = new TextEncoder();
  const text = json.choices?.[0]?.message?.content || "";
  const stream = new ReadableStream({
    start(controller) {
      const emit = (value) => controller.enqueue(enc.encode(`data: ${JSON.stringify(value)}\n\n`));
      emit({ ...json, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
      if (text) emit({ ...json, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
      emit({ ...json, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function errorResponse(status) {
  return new Response(JSON.stringify(gitlabRequestError(status)), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function isOutboundAllowed(url) {
  try {
    assertOutboundUrlAllowed(url);
    return true;
  } catch {
    return false;
  }
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
      Authorization: `Bearer ${token}`
    };
  }

  transformRequest(model, body, _stream, credentials) {
    return buildRequestBody(model, body || {}, credentials || {});
  }

  /**
   * Direct access applies to a Duo OAuth sign-in only. PAT and older untyped
   * connections keep the public completions endpoint.
   */
  directAccessIssuer(credentials) {
    const data = asObject(credentials?.providerSpecificData);
    if (this.provider !== "gitlab-duo" || data.authKind !== "oauth") return null;
    if (credentials?.apiKey || !isString(credentials?.accessToken) || !credentials.accessToken) return null;
    return normalizeGitLabRoot(resolveGitLabBase(credentials));
  }

  /** Exchange the OAuth token for gateway credentials; null means use the public endpoint. */
  async exchangeDirectAccess(sender, issuer, credentials, signal, proxyOptions) {
    const url = gitlabDirectAccessUrl(issuer);
    if (!isOutboundAllowed(url)) return null;
    let response;
    try {
      response = await sender.sendRequest(url, {
        method: "POST",
        headers: { Accept: "application/json", Authorization: `Bearer ${credentials.accessToken}` },
        signal: signal || undefined
      }, proxyOptions, { quotaBearing: false });
    } catch {
      if (signal?.aborted) throw requestAbortError(signal.reason);
      return null;
    }
    try {
      if (!response.ok) return null;
      return parseGitLabDirectAccess(JSON.parse(await response.text()), issuer);
    } catch {
      if (signal?.aborted) throw requestAbortError(signal.reason);
      return null;
    } finally {
      if (!response.bodyUsed) cancelDiscardedResponse(response);
      await settleProviderAttemptDispatch(response, { success: response.ok, reason: response.ok ? "success" : "fallback" });
    }
  }

  /** Store or clear the connection's gateway entry when the caller supplies a store. */
  async persistDirectAccess(input, entry) {
    if (!isFunction(input.persistGitLabDirectAccess)) return;
    try {
      await input.persistGitLabDirectAccess(entry);
    } catch {
      input.log?.warn?.("GITLAB-DUO", "Could not store direct access state");
    }
  }

  async resolveTarget(input, sender, monolith) {
    const { credentials, signal, proxyOptions = null } = input;
    const issuer = this.directAccessIssuer(credentials);
    if (!issuer) return monolith;
    const cachedEntry = readCachedGitLabDirectAccess(credentials.providerSpecificData, issuer);
    const entry = cachedEntry || await this.exchangeDirectAccess(sender, issuer, credentials, signal, proxyOptions);
    if (!entry || !isOutboundAllowed(buildGitLabDirectGatewayUrl(entry.baseUrl))) return monolith;
    if (!cachedEntry && isCacheableGitLabDirectAccess(entry)) await this.persistDirectAccess(input, entry);
    return { mode: "direct", url: buildGitLabDirectGatewayUrl(entry.baseUrl), headers: buildGitLabDirectHeaders(entry) };
  }

  async execute(input) {
    const { model, body, stream, credentials, signal, proxyOptions = null } = input;
    if (signal?.aborted) throw requestAbortError(signal.reason);
    const sender = createExecutorSender(this, input);
    const transformedBody = this.transformRequest(model, body, stream, credentials);
    const payload = JSON.stringify(transformedBody);
    const monolith = { mode: "monolith", url: this.buildUrl(model, stream, 0, credentials), headers: this.buildHeaders(credentials) };
    let target = await this.resolveTarget(input, sender, monolith);
    const send = (destination) => sender.sendRequest(destination.url, {
      method: "POST",
      headers: destination.headers,
      body: payload,
      signal: signal || undefined
    }, proxyOptions);

    let response = await send(target);
    // A gateway auth rejection means the gateway did no work, so the public
    // endpoint may receive the request. Any other gateway answer is final.
    if (target.mode === "direct" && isGitLabDirectAccessRejection(response.status)) {
      cancelDiscardedResponse(response);
      await settleProviderAttemptDispatch(response, { reason: "fallback" });
      await this.persistDirectAccess(input, null);
      if (signal?.aborted) throw requestAbortError(signal.reason);
      target = monolith;
      response = await send(target);
    }
    const result = (replacement) => {
      transferProviderAttemptDispatch(response, replacement);
      return { response: replacement, url: target.url, headers: target.headers, transformedBody, attemptStartedAt: sender.attemptStartedAt };
    };
    if (!response.ok) {
      cancelDiscardedResponse(response);
      return result(errorResponse(response.status));
    }
    let text;
    try {
      text = await response.text();
    } catch (error) {
      await settleProviderAttemptDispatch(response, { reason: "upstream_error" });
      throw error;
    }
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { message: text };
    }
    const json = completionResponse(parsed, model);
    return result(stream ? streamFromCompletion(json) :
      new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } }));
  }
}
