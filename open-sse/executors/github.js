import { BaseExecutor, waitForRetryDelay } from "./base.js";
import { readBoundedResponseText } from "../utils/error.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT, CLAUDE_SYSTEM_PROMPT } from "../config/appConstants.js";
import { HTTP_STATUS, DEFAULT_RETRY_CONFIG, resolveRetryEntry, resolveRequestRetryPolicy, FETCH_CONNECT_TIMEOUT_MS, matchSkipRule } from "../config/runtimeConfig.js";
import { normalizeClaudePassthrough } from "../translator/formats/claude.js";
import { detectClientTool } from "../utils/clientDetector.js";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses.js";
import { openaiResponsesToOpenAIResponse } from "../translator/response/openai-responses.js";
import { initState, translateRequest, translateResponse } from "../translator/index.js";
import { parseSSELine, formatSSE } from "../utils/streamHelpers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { stripUnsupportedParams, applyParamRenames } from "../translator/concerns/paramSupport.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { FORMATS } from "../translator/formats.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import { createUpstreamTerminalTracker } from "../utils/streamTerminal.js";
import { settleProviderAttemptDispatch, getCurrentProviderAttemptTimestamp, runQuotaBearingProviderRequest } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { GITHUB_CLAUDE_MAX_PROMPT_TOKENS } from "../config/github.js";
import { estimateInputTokens } from "../utils/usageTracking.js";
import crypto from "crypto";
import { isNumber, isString } from "../../src/shared/utils/typeChecks.js";

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
    sanitized.messages = body.messages.map((msg) => {
      // assistant messages with only tool_calls have content: null — leave as-is
      if (!msg.content) return msg;

      // String content is always fine
      if (isString(msg.content)) return msg;

      // Array content: filter/convert unsupported part types
      if (Array.isArray(msg.content)) {
        const cleanContent = msg.content.
        map((part) => {
          if (part.type === "text") return part;
          if (part.type === "image_url") return part;
          // Serialize tool_use, tool_result, thinking, etc. as text
          const text = part.text || part.content || JSON.stringify(part);
          return { type: "text", text: isString(text) ? text : JSON.stringify(text) };
        }).
        filter((part) => part.text !== ""); // remove empty text parts

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

  transformRequest(model, body, stream, credentials, requestContext = null) {
    const transformed = { ...body };
    // Scoped to /chat/completions: the /responses route bypasses transformRequest
    // and its converter maps max_tokens but drops max_completion_tokens, so running
    // the forward rename there would lose the cap. (OmniRoute #6912/#6964)
    applyParamRenames("github", model, transformed);
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
        timeoutMs: 2_000
      });

      if (errorBody.includes("not accessible via the /chat/completions endpoint") || errorBody.includes("The requested model is not supported")) {
        log?.warn("GITHUB", `Model ${model} requires /responses. Switching...`);
        this.knownCodexModels.add(model);
        await settleProviderAttemptDispatch(result.response, { success: false, reason: "fallback" });
        try {
          const cancellation = result.response.body?.cancel?.("switching GitHub route");
          if (cancellation?.catch) void cancellation.catch(() => {});
        } catch {/* noop */}
        return this.executeWithResponsesEndpoint(options);
      }
    }

    return result;
  }

  /**
   * Native Anthropic Messages dispatch for GitHub Copilot Claude models.
   *
   * Claude models arrive here OpenAI-shaped (chatCore targets "openai" for github),
   * so we translate to Anthropic-native ourselves. Hitting /v1/messages directly is
   * what lets prepareClaudeRequest() (translator/formats/claude.js) inject
   * cache_control — /chat/completions never gets there, so it never surfaces
   * prompt-cache token counts.
   *
   * This path bypasses BaseExecutor.execute(), so it must re-apply four behaviors
   * the normal route gets for free (Codex #291 findings):
   *   1. stripUnsupportedParams + persona guard + thinking-strip before dispatch;
   *   2. a per-attempt FETCH_CONNECT_TIMEOUT_MS header-timeout abort;
   *   3. a transient 502/503/504 (and network-as-502) retry loop honoring
   *      DEFAULT_RETRY_CONFIG, with connect_timeout getting 0 in-place retries.
   */
  async executeWithMessagesEndpoint({ model, body, stream, credentials, signal, log, proxyOptions = null, requestContext = null, requestPolicy = null }) {
    const url = this.config.messagesUrl;
    // Force stream:true upstream regardless of client preference (headers AND body),
    // same as executeWithResponsesEndpoint below — chatCore's non-streaming handler
    // already knows how to buffer an SSE response into a single JSON reply when the
    // client asked for stream:false.
    const headers = this.buildHeaders(credentials, true);

    // Strip params GitHub's Claude route rejects (temperature, and thinking/
    // reasoning_effort for non-4.6 Claude) BEFORE translating — the normal
    // /chat/completions path does this in transformRequest() (line ~133); the
    // /v1/messages path bypasses that, so without this a request carrying
    // temperature/thinking 400s only on this route. Clone so we never mutate the
    // caller's body. translateRequest then copies only the fields it knows.
    const strippedBody = stripUnsupportedParams("github", model, { ...body });
    const parallelToolCallsDisabled = body.parallel_tool_calls === false;
    const transformedBody = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, model, strippedBody, true, credentials, "github");
    // _toolNameMap is internal bookkeeping (see openai-to-claude.js) — chatCore
    // normally strips it before dispatch and threads it into the response state to
    // restore original tool names; do the same here or Anthropic's strict schema
    // rejects the extra field with a 400.
    const toolNameMap = transformedBody._toolNameMap;
    delete transformedBody._toolNameMap;

    /**
     * Persona guard (Codex #291 P2): the generic OpenAI→Claude translator prepends
     * the Claude Code persona (CLAUDE_SYSTEM_PROMPT) as the first system block —
     * correct for a real Claude Code client, but it silently re-personas a normal
     * Copilot chat. Detect the client from the frozen per-request headers
     * (requestContext.clientHeaders, set by chatCore) and remove ONLY the exact
     * synthetic leading block when the caller is not Claude Code. A caller-supplied
     * system block with the same text is preserved because we drop strictly the
     * first block, only when it matches verbatim.
     */
    if (detectClientTool(requestContext?.clientHeaders || {}, strippedBody) !== "claude" &&
    Array.isArray(transformedBody.system) &&
    transformedBody.system[0]?.text === CLAUDE_SYSTEM_PROMPT) {
      transformedBody.system = transformedBody.system.slice(1);
      if (transformedBody.system.length === 0) delete transformedBody.system;
    }

    /**
     * Thinking-strip (Codex #291 P2): an assistant history turn carrying
     * reasoning_content becomes an unsigned Anthropic `thinking` block. The cleanup
     * that validates/drops unsigned thinking runs only for provider "claude",
     * anthropic-compatible providers, and DeepSeek — never "github" — so without
     * this the native /v1/messages body ships unsigned thinking blocks Anthropic
     * rejects with a 400. Passing provider "claude" (not "github") is deliberate:
     * the "github" branch KEEPS unvalidated blocks (see normalizeClaudePassthrough),
     * so we force the validating path to strip them for this route.
     */
    /** Preserve the caller's assistant-prefill policy through the native GitHub Messages cleanup pass. */
    normalizeClaudePassthrough(transformedBody, model, "claude", requestContext?.modelCapabilities?.maxOutput ?? null, { rawHeaders: requestContext?.clientHeaders });

    /**
     * Parallel-tool-use guard (Codex #291 P2): translateRequest converts OpenAI
     * tool_choice but does not carry parallel_tool_calls. Claude expresses the
     * same intent as tool_choice.disable_parallel_tool_use. Only decorate when
     * tools are present and the caller did not explicitly disable tools.
     */
    if (parallelToolCallsDisabled && transformedBody.tools?.length > 0) {
      const existing = transformedBody.tool_choice || { type: "auto" };
      if (existing.type !== "none") {
        transformedBody.tool_choice = { ...existing, disable_parallel_tool_use: true };
      }
    }

    /**
     * Thinking/forced-tool-choice guard (Codex #291 P2): Claude's Messages API
     * rejects extended thinking (enabled/adaptive) together with forced tool
     * choice (any/tool). Downgrade to auto while preserving the parallel-use
     * flag; preserve "none" because it disables tools and is compatible.
     */
    const thinkingActive = transformedBody.thinking?.type === "enabled" || transformedBody.thinking?.type === "adaptive";
    if (thinkingActive && transformedBody.tools?.length > 0 && transformedBody.tool_choice) {
      const { type } = transformedBody.tool_choice;
      if (type === "any" || type === "tool") {
        const disableParallel = transformedBody.tool_choice.disable_parallel_tool_use ?? true;
        transformedBody.tool_choice = { type: "auto", disable_parallel_tool_use: disableParallel };
      }
    }

    /**
     * Empty-assistant cleanup (Codex #291 P2): normalizeClaudePassthrough strips
     * unsigned thinking blocks, which can leave an assistant message with
     * content: []. prepareClaudeRequest already filtered empty messages before
     * this strip, so re-filter after it.
     */
    if (Array.isArray(transformedBody.messages)) {
      transformedBody.messages = transformedBody.messages.filter((msg) => {
        if (msg.role !== "assistant") return true;
        if (Array.isArray(msg.content) && msg.content.length === 0) return false;
        return true;
      });
      if (transformedBody.messages.length === 0) {
        throw new Error("GitHub /v1/messages request has no messages after empty-turn cleanup");
      }
    }

    /**
     * Ask Copilot for the authoritative Claude input-token count once the cheap
     * estimate reaches the configured threshold, then reject above its prompt cap
     * before the generation request is dispatched.
     */
    if (estimateInputTokens(transformedBody) >= GITHUB_CLAUDE_MAX_PROMPT_TOKENS * this.config.countTokensPreflightRatio) {
      try {
        const timeoutSignal = AbortSignal.timeout(this.config.countTokensTimeoutMs);
        const countSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
        const countResponse = await proxyAwareFetch(this.config.countTokensUrl, {
          method: "POST",
          headers: this.buildHeaders(credentials, false),
          body: JSON.stringify(transformedBody),
          signal: countSignal
        }, proxyOptions);
        if (countResponse.ok) {
          const inputTokens = Number((await countResponse.json())?.input_tokens);
          if (Number.isFinite(inputTokens) && inputTokens > GITHUB_CLAUDE_MAX_PROMPT_TOKENS) {
            const errorBody = {
              error: {
                message: `Prompt is ${inputTokens} tokens; maximum for ${model} is ${GITHUB_CLAUDE_MAX_PROMPT_TOKENS}.`,
                type: "invalid_request_error",
                param: "messages",
                code: "context_length_exceeded"
              }
            };
            return {
              response: Response.json(errorBody, { status: HTTP_STATUS.BAD_REQUEST }),
              url: this.config.countTokensUrl,
              headers,
              transformedBody
            };
          }
        } else {
          log?.warn?.("GITHUB", `Prompt token preflight returned ${countResponse.status}; continuing`);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        log?.warn?.("GITHUB", `Prompt token preflight failed: ${error?.message || error}; continuing`);
      }
    }

    log?.debug("GITHUB", "Sending translated request to /v1/messages");

    // Transient-retry policy for this direct fetch. BaseExecutor.execute merges
    // DEFAULT_RETRY_CONFIG with this.config.retry and applies a per-execute
    // maxTransportAttempts ceiling AND skip-rules; mirror both here so a single
    // runaway sequence (e.g. 502 -> 503 -> 504) shares one counter, cannot exceed
    // the caller's transport budget, and honors explicit retry/skip rules.
    // connect_timeout gets 0 in-place retries (the account layer fails over rather
    // than re-hitting a stalled upstream).
    const baseRetry = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    const policy = resolveRequestRetryPolicy(this.provider, requestPolicy);
    const headerTimeoutMs = policy.headerTimeoutMs || this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
    const transientStatuses = new Set([
    HTTP_STATUS.BAD_GATEWAY, // 502
    HTTP_STATUS.SERVICE_UNAVAILABLE, // 503
    HTTP_STATUS.GATEWAY_TIMEOUT // 504
    ]);
    const cap = policy.maxTransportAttempts != null ? Math.max(0, policy.maxTransportAttempts - 1) : null;
    const resolveAttempts = ({ statusKey, errorKind, text }) => {
      const base = resolveRetryEntry(baseRetry[statusKey]);
      const rule = policy.skipRules ?
      matchSkipRule(this.provider, { status: statusKey, errorKind, text }, policy.skipRules) :
      null;
      if (rule?.action === "skip") return { ...base, attempts: 0 };
      if (rule?.action === "retry") {
        return { ...base, attempts: cap != null ? cap : base.attempts };
      }
      if (errorKind === "connect_timeout") return { ...base, attempts: 0 };
      if (cap != null) return { ...base, attempts: Math.min(base.attempts, cap) };
      return base;
    };

    let response = null;
    let transportRetries = 0;
    for (;;) {
      /**
       * Header-timeout abort (Codex #291 P2): BaseExecutor.execute wraps its fetch
       * in FETCH_CONNECT_TIMEOUT_MS; this direct proxyAwareFetch only used the
       * caller signal, so a stalled upstream held the provider slot/quota lease
       * until client disconnect. Arm a fresh AbortController + timer PER ATTEMPT
       * (never cached across retries) and merge it with the caller signal. The
       * connectTimedOut flag is authoritative — undici rejects with the exact
       * reason object we pass abort(), so error.name is not reliable.
       */
      const connectCtrl = new AbortController();
      let connectTimedOut = false;
      const connectTimer = setTimeout(() => {
        connectTimedOut = true;
        connectCtrl.abort(new Error("fetch connect timeout"));
      }, headerTimeoutMs);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      try {
        response = await runQuotaBearingProviderRequest(() => proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(transformedBody),
          signal: mergedSignal
        }, proxyOptions));
      } catch (error) {
        clearTimeout(connectTimer);
        // Quota-dispatch failures are local capacity failures, not provider
        // evidence; rethrow immediately so chatCore can fail over.
        if (isQuotaDispatchUnavailable(error)) throw error;
        // Caller-initiated abort (NOT our connect timer) must propagate unretried.
        if (!connectTimedOut && (error?.name === "AbortError" || signal?.aborted)) throw error;
        /**
         * Transient retry: network/transport errors and even explicit connect_timeout
         * rules map to the 502 entry; the default resolver gives connect_timeout 0 retries
         * so only an explicit requestPolicy retry rule can override it (matches BaseExecutor).
         */
        const errorKind = connectTimedOut ? "connect_timeout" : "network";
        const { attempts, delayMs } = resolveAttempts({ statusKey: HTTP_STATUS.BAD_GATEWAY, errorKind, text: error.message });
        if (transportRetries < attempts) {
          transportRetries++;
          log?.debug?.("RETRY", `github /v1/messages ${errorKind} "${error.message}" retry ${transportRetries}/${attempts} after ${delayMs / 1000}s`);
          await waitForRetryDelay(delayMs, signal);
          continue;
        }
        error.errorKind = errorKind;
        error.providerAttemptStartedAt = getCurrentProviderAttemptTimestamp();
        throw error;
      }
      clearTimeout(connectTimer);

      // Read the error body ONCE per attempt when a contains-rule could fire, so
      // skip/retry rules that match on body text work for any failed status.
      let errorText = null;
      if (policy.hasContainsRule && response.status >= 400) {
        try {
          errorText = await readBoundedResponseText(response.clone(), { signal, maxBytes: 64 * 1024, timeoutMs: 2_000 });
        } catch (probeError) {
          if (probeError?.name === "AbortError" || signal?.aborted) throw probeError;
        }
      }

      // Retry a transient HTTP status: settle the discarded attempt's quota ticket
      // and cancel its body BEFORE waiting so no lease leaks across retries.
      if (transientStatuses.has(response.status)) {
        const { attempts, delayMs } = resolveAttempts({ statusKey: response.status, errorKind: `http_${response.status}`, text: errorText });
        if (transportRetries < attempts) {
          transportRetries++;
          log?.debug?.("RETRY", `github /v1/messages status ${response.status} retry ${transportRetries}/${attempts} after ${delayMs / 1000}s`);
          await settleProviderAttemptDispatch(response, { success: false, reason: "fallback" });
          try {
            const cancellation = response.body?.cancel?.("github /v1/messages transient retry");
            if (cancellation?.catch) void cancellation.catch(() => {});
          } catch {/* body may already be locked or closed */}
          await waitForRetryDelay(delayMs, signal);
          continue;
        }
      }
      // Success or a non-transient/exhausted status — stop retrying.
      break;
    }

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
        `data: ${JSON.stringify({ error: { message: "GitHub Messages stream failed", type: "stream_error" } })}\n\n`
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
        if (applicationTerminalSeen && !rawDoneSeen && !failureEmitted &&
        rawTerminal.outcome === "success" && currentEvent === null) {
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
      terminalProvenance: "validated"
    };
  }

  async executeWithResponsesEndpoint({ model, body, stream, credentials, signal, log, proxyOptions = null, requestContext = null }) {
    const url = this.config.responsesUrl;
    // GitHub's /responses branch is always converted through an SSE transformer
    // below. Keep the upstream Responses request streaming even when the
    // original Chat Completions client requested a non-streaming response.
    const responsesStream = true;
    const headers = this.buildHeaders(credentials, responsesStream);

    const transformedBody = openaiToOpenAIResponsesRequest(model, body, responsesStream, credentials);
    // Custom-model maxOutput: the Responses converter emits max_output_tokens;
    // clamp AFTER conversion so escalation from /chat/completions keeps the cap.
    this.clampCustomMaxOutput(transformedBody, requestContext, ["max_output_tokens"]);

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
        `data: ${JSON.stringify({ error: { message: "GitHub Responses stream failed", type: "stream_error" } })}\n\n`
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
      if (rawDoneSeen || applicationTerminalSeen && !parsed.done) {
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
        if (rawTerminal.outcome === "success" && !failureEmitted) rawDoneSeen = true;else
        emitFailure(controller);
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
      terminalProvenance: "validated"
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
        try {await response.body?.cancel?.();} catch {/* best effort */}
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
        client_id: this.config.clientId
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
        try {await response.body?.cancel?.();} catch {/* best effort */}
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
      if (isNumber(expiresAtMs) && expiresAtMs < 1e12) {
        expiresAtMs = expiresAtMs * 1000; // Convert seconds to ms
      } else if (isString(expiresAtMs)) {
        expiresAtMs = new Date(expiresAtMs).getTime();
      }
      if (expiresAtMs - Date.now() < 5 * 60 * 1000) return true;
    }
    return super.needsRefresh(credentials);
  }
}

export default GithubExecutor;