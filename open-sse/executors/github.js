import { BaseExecutor } from "./base.js";
import { readBoundedResponseText } from "../utils/error.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT } from "../config/appConstants.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses.js";
import { openaiResponsesToOpenAIResponse } from "../translator/response/openai-responses.js";
import { initState, translateRequest, translateResponse } from "../translator/index.js";
import { parseSSELine, formatSSE } from "../utils/streamHelpers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { stripUnsupportedParams } from "../translator/concerns/paramSupport.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { FORMATS } from "../translator/formats.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import { createUpstreamTerminalTracker } from "../utils/streamTerminal.js";
import {
  getCurrentProviderAttemptTimestamp,
  runQuotaBearingProviderRequest,
  settleProviderAttemptDispatch,
} from "../services/providerAttemptContext.js";
import crypto from "crypto";

export class GithubExecutor extends BaseExecutor {
  constructor() {
    super("github", PROVIDERS.github);
    this.knownCodexModels = new Set();
  }

  // Claude models get routed to Copilot's Anthropic-native /v1/messages shim (see
  // executeWithMessagesEndpoint below) — the only Copilot endpoint that surfaces
  // prompt-cache token counts. gpt/gemini/grok models stay on /chat/completions
  // (or /responses). Name-pattern check, not a registry field: Copilot's live model
  // catalog (services/copilotModels.js) regularly exposes claude-* variants ahead
  // of the static registry (registry/github.js).
  isClaudeModel(model) {
    return /claude/i.test(model || "");
  }

  buildUrl(model, stream, urlIndex = 0) {
    return this.config.baseUrl;
  }

  buildHeaders(credentials, stream = true) {
    const token = credentials.copilotToken || credentials.accessToken;
    return {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "copilot-integration-id": "vscode-chat",
      "editor-version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
      "editor-plugin-version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
      "user-agent": GITHUB_COPILOT.USER_AGENT,
      "openai-intent": "conversation-panel",
      "x-github-api-version": GITHUB_COPILOT.API_VERSION,
      "x-request-id": crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      "x-vscode-user-agent-library-version": "electron-fetch",
      "X-Initiator": "user",
      // Harmless no-op on /chat/completions and /responses; required by /v1/messages.
      "anthropic-version": ANTHROPIC_API_VERSION,
      "Accept": stream ? "text/event-stream" : "application/json"
    };
  }

  // Sanitize messages for GitHub Copilot /chat/completions endpoint (gpt/gemini/grok models —
  // claude models never reach this, see execute() below).
  // The endpoint only accepts 'text' and 'image_url' content part types.
  // Tool-related content (tool_use, tool_result, thinking) must be serialized as text.
  sanitizeMessagesForChatCompletions(body) {
    if (!body?.messages) return body;

    const sanitized = { ...body };
    sanitized.messages = body.messages.map(msg => {
      // assistant messages with only tool_calls have content: null — leave as-is
      if (!msg.content) return msg;

      // String content is always fine
      if (typeof msg.content === "string") return msg;

      // Array content: filter/convert unsupported part types
      if (Array.isArray(msg.content)) {
        const cleanContent = msg.content
          .map(part => {
            if (part.type === "text") return part;
            if (part.type === "image_url") return part;
            // Serialize tool_use, tool_result, thinking, etc. as text
            const text = part.text || part.content || JSON.stringify(part);
            return { type: "text", text: typeof text === "string" ? text : JSON.stringify(text) };
          })
          .filter(part => part.text !== ""); // remove empty text parts

        // If all content was stripped (e.g. only tool_result with no text), drop content
        return { ...msg, content: cleanContent.length > 0 ? cleanContent : null };
      }

      return msg;
    });

    // GitHub Copilot's /chat/completions rejects a conversation that ends with an
    // assistant message ("does not support assistant message prefill. The conversation
    // must end with a user message."). Anthropic clients such as Claude Desktop send a
    // trailing assistant turn as a prefill seed, which the Anthropic API honors but
    // Copilot does not — drop it so the request is accepted.
    sanitized.messages = this.dropTrailingAssistantPrefill(sanitized.messages);

    return sanitized;
  }

  // Remove trailing assistant message(s). Copilot's chat endpoint can't honor prefill
  // and 400s unless the conversation ends with a user/tool message. Never empties the
  // array. No-op when the conversation already ends with a non-assistant message.
  dropTrailingAssistantPrefill(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return messages;
    let end = messages.length;
    while (end > 1 && messages[end - 1]?.role === "assistant") end--;
    return end === messages.length ? messages : messages.slice(0, end);
  }

  // Newer OpenAI models (gpt-5+, o1, o3, o4) require max_completion_tokens instead of max_tokens
  requiresMaxCompletionTokens(model) {
    return /gpt-5|o[134]-/i.test(model);
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = { ...body };
    if (this.requiresMaxCompletionTokens(model) && transformed.max_tokens !== undefined) {
      transformed.max_completion_tokens = transformed.max_tokens;
      delete transformed.max_tokens;
    }
    // "none" means no thinking — strip it so models that don't support "none" don't 400
    if (transformed.reasoning_effort === "none") {
      delete transformed.reasoning_effort;
    }
    // Config-driven strip of params unsupported by this provider/model
    stripUnsupportedParams("github", model, transformed);
    return transformed;
  }

  // GitHub Copilot's /responses endpoint only serves OpenAI (gpt/codex) models.
  // Gemini and Claude models are not available there and reject with a 400
  // "does not support Responses API" (unsupported_api_for_model). They must
  // therefore never be escalated to /responses, even if /chat/completions
  // returned a "not supported" error for an unrelated reason. Fixes #1062.
  supportsResponsesEndpoint(model) {
    const m = (model || "").toLowerCase();
    return !(m.includes("gemini") || m.includes("claude"));
  }

  async execute(options) {
    const { model, log } = options;

    // Claude models: route to Copilot's Anthropic-native /v1/messages shim — the only
    // Copilot endpoint that surfaces prompt-cache token counts for Claude. Detected by
    // model NAME (not a registry field): Copilot's live model catalog regularly exposes
    // claude-* variants the static registry hasn't caught up with (see registry/github.js).
    if (this.isClaudeModel(model)) {
      log?.debug("GITHUB", `Using /v1/messages route for ${model}`);
      return this.executeWithMessagesEndpoint(options);
    }

    // Only use /responses for models that are explicitly known to need it (e.g. gpt codex models)
    // and that the /responses endpoint actually serves (excludes Gemini/Claude, see #1062).
    if (this.knownCodexModels.has(model) && this.supportsResponsesEndpoint(model)) {
      log?.debug("GITHUB", `Using cached /responses route for ${model}`);
      return this.executeWithResponsesEndpoint(options);
    }

    // Sanitize messages before sending to /chat/completions (gpt/gemini/grok — the
    // endpoint rejects non-text/image_url content parts).
    const sanitizedOptions = {
      ...options,
      body: this.sanitizeMessagesForChatCompletions(options.body)
    };

    const result = await super.execute({ ...sanitizedOptions, proxyOptions: options.proxyOptions || null });

    // Only escalate to /responses for models that endpoint can actually serve.
    // Gemini/Claude would otherwise loop into a misleading "does not support
    // Responses API" 400 instead of surfacing the real /chat/completions error (#1062).
    if (result.response.status === HTTP_STATUS.BAD_REQUEST && this.supportsResponsesEndpoint(model)) {
      const errorBody = await readBoundedResponseText(result.response.clone(), {
        signal: options.signal,
        maxBytes: 64 * 1024,
        timeoutMs: 2_000,
      });

      if (errorBody.includes("not accessible via the /chat/completions endpoint") || errorBody.includes("The requested model is not supported")) {
        log?.warn("GITHUB", `Model ${model} requires /responses. Switching...`);
        this.knownCodexModels.add(model);
        await settleProviderAttemptDispatch(result.response, { success: false, reason: "fallback" });
        try {
          const cancellation = result.response.body?.cancel?.("switching GitHub route");
          if (cancellation?.catch) void cancellation.catch(() => {});
        } catch { /* noop */ }
        return this.executeWithResponsesEndpoint(options);
      }
    }

    return result;
  }

  // Claude models arrive here OpenAI-shape (chatCore targets "openai" for github),
  // so we translate to Anthropic-native ourselves. Hitting /v1/messages directly is
  // what lets prepareClaudeRequest() (translator/formats/claude.js) inject
  // cache_control — /chat/completions never gets there, so it never surfaces
  // prompt-cache token counts.
  async executeWithMessagesEndpoint({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.config.messagesUrl;
    // Force stream:true upstream regardless of client preference (headers AND body),
    // same as executeWithResponsesEndpoint below — chatCore's non-streaming handler
    // already knows how to buffer an SSE response into a single JSON reply when the
    // client asked for stream:false.
    const headers = this.buildHeaders(credentials, true);

    const transformedBody = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, model, body, true, credentials, "github");
    // _toolNameMap is internal bookkeeping (see openai-to-claude.js) — chatCore
    // normally strips it before dispatch and threads it into the response state to
    // restore original tool names; do the same here or Anthropic's strict schema
    // rejects the extra field with a 400.
    const toolNameMap = transformedBody._toolNameMap;
    delete transformedBody._toolNameMap;

    log?.debug("GITHUB", "Sending translated request to /v1/messages");

    const response = await runQuotaBearingProviderRequest(() => proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal
    }, proxyOptions));

    if (!response.ok) {
      return { response, url, headers, transformedBody, attemptStartedAt: getCurrentProviderAttemptTimestamp() };
    }

    const state = initState(FORMATS.CLAUDE);
    state.model = model;
    if (toolNameMap) state.toolNameMap = toolNameMap;

    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let doneEmitted = false;
    let failureEmitted = false;
    let applicationTerminalSeen = false;
    let rawDoneSeen = false;
    const rawTerminal = createUpstreamTerminalTracker({ format: FORMATS.CLAUDE });
    // Translated OpenAI chunks carrying a finish_reason are the client-visible
    // success terminal. Hold them until EOF (not merely message_stop) so a
    // truncated/contradicted stream — garbage after message_stop, raw [DONE]
    // mismatch, dangling event — can never leak a partial success (finish chunk
    // + [DONE]) ahead of the failure signal. Content deltas stream live.
    let heldTerminalChunks = null;

    const emitFailure = (controller) => {
      rawTerminal.fail();
      heldTerminalChunks = null;
      if (failureEmitted) return;
      failureEmitted = true;
      controller.enqueue(new TextEncoder().encode(
        `data: ${JSON.stringify({ error: { message: "GitHub Messages stream failed", type: "stream_error" } })}\n\n`,
      ));
    };

    const encodeAll = (chunks) => chunks.map((c) => new TextEncoder().encode(formatSSE(c, "openai")));

    const processLine = (line, controller) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) return;
      if (trimmed.startsWith("event:")) {
        currentEvent = trimmed.slice(6).trim() || null;
        return;
      }
      // Strict frame routing (same posture as executeWithResponsesEndpoint): any
      // non-blank, non-comment line that is neither an event nor a data frame is a
      // protocol violation — fail loudly rather than silently dropping it.
      if (!trimmed.startsWith("data:")) {
        emitFailure(controller);
        currentEvent = null;
        return;
      }
      const parsed = parseSSELine(trimmed);
      if (!parsed) {
        emitFailure(controller);
        currentEvent = null;
        return;
      }
      // Anthropic's shim may append a terminal "data: [DONE]" after message_stop
      // (upstream #2608 accepts it). Accept exactly one such sentinel AFTER the
      // tracker has validated message_stop, and only as a bare data frame — an
      // event:-named [DONE] is a framing mismatch the claude tracker rejects.
      // Reject an early, duplicate, or event-named [DONE].
      if (parsed.done) {
        if (applicationTerminalSeen && !rawDoneSeen && !failureEmitted
          && rawTerminal.outcome === "success" && currentEvent === null) {
          rawDoneSeen = true;
        } else {
          emitFailure(controller);
        }
        currentEvent = null;
        return;
      }
      // Any data frame after the terminal message_stop (or after a raw [DONE])
      // contradicts the stream — fail BEFORE translating/emitting any of it.
      if (rawDoneSeen || applicationTerminalSeen) {
        emitFailure(controller);
        currentEvent = null;
        return;
      }
      rawTerminal.observe({ chunk: parsed, eventName: currentEvent, rawDone: false });
      currentEvent = null;
      if (rawTerminal.outcome === "failure") {
        emitFailure(controller);
        return;
      }
      if (rawTerminal.outcome === "success") applicationTerminalSeen = true;
      const translated = translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, parsed, state) || [];
      // Hold back only the finish-carrying chunks (message_delta stop_reason,
      // message_stop fallback); stream everything else live. Held frames release
      // at flush only if the stream is still validated at EOF.
      const live = [];
      const held = [];
      for (const c of translated) {
        const hasFinish = Array.isArray(c?.choices) && c.choices.some((choice) => choice?.finish_reason);
        (hasFinish ? held : live).push(c);
      }
      for (const encoded of encodeAll(live)) controller.enqueue(encoded);
      if (held.length > 0) heldTerminalChunks = [...(heldTerminalChunks || []), ...held];
    };

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");

        buffer = lines.pop() || "";

        for (const line of lines) {
          processLine(line, controller);
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer.trim()) {
          processLine(buffer, controller);
        }
        // An event: frame left dangling at EOF (no matching data: line) is a
        // truncated stream — fail rather than reporting a clean stop.
        if (currentEvent !== null) {
          emitFailure(controller);
          currentEvent = null;
        }
        if (!doneEmitted) {
          if (rawTerminal.outcome === "success" && !failureEmitted) {
            // Stream validated end-to-end — release the deferred finish frame(s),
            // then [DONE].
            if (heldTerminalChunks) {
              for (const encoded of encodeAll(heldTerminalChunks)) controller.enqueue(encoded);
              heldTerminalChunks = null;
            }
            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            doneEmitted = true;
          } else {
            emitFailure(controller);
          }
        }
      }
    });

    if (!response.body) {
      return { response: new Response("", { status: response.status, headers: response.headers }), url, headers, transformedBody, attemptStartedAt: getCurrentProviderAttemptTimestamp() };
    }
    const convertedStream = response.body.pipeThrough(transformStream);

    return {
      response: new Response(convertedStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      }),
      url,
      headers,
      transformedBody,
      attemptStartedAt: getCurrentProviderAttemptTimestamp(),
      terminalProvenance: "validated",
    };
  }

  async executeWithResponsesEndpoint({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.config.responsesUrl;
    // GitHub's /responses branch is always converted through an SSE transformer
    // below. Keep the upstream Responses request streaming even when the
    // original Chat Completions client requested a non-streaming response.
    const responsesStream = true;
    const headers = this.buildHeaders(credentials, responsesStream);

    const transformedBody = openaiToOpenAIResponsesRequest(model, body, responsesStream, credentials);

    log?.debug("GITHUB", "Sending translated request to /responses");

    const response = await runQuotaBearingProviderRequest(() => proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal
    }, proxyOptions));

    if (!response.ok) {
      return { response, url, headers, transformedBody, attemptStartedAt: getCurrentProviderAttemptTimestamp() };
    }

    const state = initState("openai-responses");
    state.model = model;

    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let doneEmitted = false;
    let failureEmitted = false;
    let applicationTerminalSeen = false;
    let rawDoneSeen = false;
    const rawTerminal = createUpstreamTerminalTracker({ format: FORMATS.OPENAI_RESPONSES });

    const emitFailure = (controller) => {
      rawTerminal.fail();
      if (failureEmitted) return;
      failureEmitted = true;
      controller.enqueue(new TextEncoder().encode(
        `data: ${JSON.stringify({ error: { message: "GitHub Responses stream failed", type: "stream_error" } })}\n\n`,
      ));
    };

    const processLine = (line, controller) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) return;
      if (trimmed.startsWith("event:")) {
        currentEvent = trimmed.slice(6).trim() || null;
        return;
      }
      if (!trimmed.startsWith("data:")) return;
      const parsed = parseSSELine(trimmed);
      if (!parsed) {
        emitFailure(controller);
        currentEvent = null;
        return;
      }
      if (rawDoneSeen || (applicationTerminalSeen && !parsed.done)) {
        emitFailure(controller);
        currentEvent = null;
        return;
      }
      rawTerminal.observe({ chunk: parsed, eventName: currentEvent, rawDone: parsed.done === true });
      currentEvent = null;
      if (rawTerminal.outcome === "failure") {
        emitFailure(controller);
        return;
      }
      if (parsed.done) {
        if (rawTerminal.outcome === "success" && !failureEmitted) rawDoneSeen = true;
        else emitFailure(controller);
        return;
      }
      if (rawTerminal.outcome === "success") applicationTerminalSeen = true;
      const converted = openaiResponsesToOpenAIResponse(parsed, state);
      if (converted) controller.enqueue(new TextEncoder().encode(formatSSE(converted, "openai")));
    };

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");

        buffer = lines.pop() || "";

        for (const line of lines) {
          processLine(line, controller);
        }
      },
      flush(controller) {
        if (buffer.trim()) {
          processLine(buffer, controller);
        }
        if (!doneEmitted) {
          if (rawTerminal.outcome === "success" && !failureEmitted) {
            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            doneEmitted = true;
          } else {
            emitFailure(controller);
          }
        }
      }
    });

    if (!response.body) {
      return { response: new Response("", { status: response.status, headers: response.headers }), url, headers, transformedBody };
    }
    const convertedStream = response.body.pipeThrough(transformStream);

    return {
      response: new Response(convertedStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      }),
      url,
      headers,
      transformedBody,
      attemptStartedAt: getCurrentProviderAttemptTimestamp(),
      terminalProvenance: "validated",
    };
  }

  async refreshCopilotToken(githubAccessToken, log, proxyOptions = null) {
    try {
      const response = await proxyAwareFetch("https://api.github.com/copilot_internal/v2/token", {
        headers: {
          "Authorization": `token ${githubAccessToken}`,
          "User-Agent": GITHUB_COPILOT.USER_AGENT,
          "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
          "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
          "Accept": "application/json",
          "x-github-api-version": GITHUB_COPILOT.API_VERSION
        }
      }, proxyOptions);
      if (!response.ok) {
        try { await response.body?.cancel?.(); } catch { /* best effort */ }
        log?.error?.("TOKEN", `Copilot token refresh failed with HTTP ${response.status}`);
        return null;
      }
      const data = await response.json();
      log?.info?.("TOKEN", "Copilot token refreshed");
      return { token: data.token, expiresAt: data.expires_at };
    } catch {
      log?.error?.("TOKEN", "Copilot token refresh request failed");
      return null;
    }
  }

  async refreshGitHubToken(refreshToken, log, proxyOptions = null) {
    try {
      const params = {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      };
      if (this.config.clientSecret) {
        params.client_secret = this.config.clientSecret;
      }

      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.github.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams(params)
      }, proxyOptions);
      if (!response.ok) {
        try { await response.body?.cancel?.(); } catch { /* best effort */ }
        return null;
      }
      const tokens = await response.json();
      log?.info?.("TOKEN", "GitHub token refreshed");
      return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
    } catch (error) {
      log?.error?.("TOKEN", `GitHub refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    let copilotResult = await this.refreshCopilotToken(credentials.accessToken, log, proxyOptions);

    if (!copilotResult && credentials.refreshToken) {
      const githubTokens = await this.refreshGitHubToken(credentials.refreshToken, log, proxyOptions);
      if (githubTokens?.accessToken) {
        copilotResult = await this.refreshCopilotToken(githubTokens.accessToken, log, proxyOptions);
        if (copilotResult) {
          return { ...githubTokens, copilotToken: copilotResult.token, copilotTokenExpiresAt: copilotResult.expiresAt };
        }
        return githubTokens;
      }
    }

    if (copilotResult) {
      return { accessToken: credentials.accessToken, refreshToken: credentials.refreshToken, copilotToken: copilotResult.token, copilotTokenExpiresAt: copilotResult.expiresAt };
    }

    return null;
  }

  needsRefresh(credentials) {
    // Always refresh if no copilotToken
    if (!credentials.copilotToken) return true;

    if (credentials.copilotTokenExpiresAt) {
      // Handle both Unix timestamp (seconds) and ISO string
      let expiresAtMs = credentials.copilotTokenExpiresAt;
      if (typeof expiresAtMs === "number" && expiresAtMs < 1e12) {
        expiresAtMs = expiresAtMs * 1000; // Convert seconds to ms
      } else if (typeof expiresAtMs === "string") {
        expiresAtMs = new Date(expiresAtMs).getTime();
      }
      if (expiresAtMs - Date.now() < 5 * 60 * 1000) return true;
    }
    return super.needsRefresh(credentials);
  }
}

export default GithubExecutor;
