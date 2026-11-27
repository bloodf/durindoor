/** Internal ChatGPT Web executor helpers; public compatibility exports live in ../chatgpt-web-http.js. */
import { BaseExecutor } from "../base.js";
import { createExecutorSender, requestAbortError } from "../sendRequest.js";
import { transferProviderAttemptDispatch } from "../../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../../services/quota/dispatch.js";
import { describeChatGptWebHttpError } from "../chatgptWebErrors.js";
import { prepareToolMessages } from "../../translator/webTools.js";
import { buildToolModeResponse } from "../chatgptWebTools.js";
import { randomUUID } from "node:crypto";
import { TlsClientUnavailableError } from "../../services/chatgptTlsClient.js";
import { resolveChatGptModel, resolveChatGptSystemHints } from "./models.js";
import { resumeChatGptHandoff } from "./handoff.js";
import { runWithTlsProxyOptions } from "../../services/tlsClientBase.js";
import { buildNextAuthSessionCookie } from "../../../src/lib/providers/webCookieAuth.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";
import { redirectPolicy, SEND_DEADLINE_MS, sendTls, CHATGPT_BASE, SESSION_URL, SENTINEL_PREPARE_URL, CONV_URL, CHATGPT_USER_AGENT, OAI_CLIENT_VERSION, deviceIdFor, browserHeaders, oaiHeaders, tokenCache, cookieKey, exchangeSession, SessionAuthError, runSessionWarmup, configuredProPollTimeoutMs, prepareChatRequirements, SentinelBlockedError, fetchDpl, randomHex, buildPrekeyConfig, solveProofOfWork } from "./session.js";
import { parseOpenAIMessages, looksLikeImageGenRequest, looksLikeImageEditRequest, buildConversationBody } from "./conversation.js";
import { extractContent, pollForFinalAssistantAnswer } from "./conversation-detail.js";
import { buildStreamingResponse, buildNonStreamingResponse } from "./stream.js";
import { errorResponse, derivePublicBaseUrl, pollForAsyncImage, makeImageResolver } from "./images.js";
export class ChatGptWebHttpExecutor extends BaseExecutor {
  constructor() {
    super("chatgpt-web", { id: "chatgpt-web", baseUrl: CONV_URL });
  }

  /**
   * Every tls-client call for this request, including those made from the SSE
   * stream's start(), inherits the connection's proxy options.
   */
  async execute(input) {
    if (input.signal?.aborted) throw requestAbortError(input.signal.reason);
    const sender = createExecutorSender({ provider: this.provider, config: { timeoutMs: SEND_DEADLINE_MS } }, input);
    // The conversation reply; every result after it carries its quota ticket.
    let upstream = null;
    const result = await redirectPolicy.run(input.sameOriginRedirects === true, () =>
      runWithTlsProxyOptions(input.proxyOptions ?? null, () =>
        this.executeDirect(input, sender, (reply) => { upstream = reply; }))
    );
    transferProviderAttemptDispatch(upstream, result.response);
    return { ...result, attemptStartedAt: sender.attemptStartedAt };
  }

  async executeDirect({
    model,
    body,
    stream,
    credentials,
    apiKeyId,
    connectionId,
    signal,
    log,
    onCredentialsRefreshed,
    clientHeaders: explicitClientHeaders,
    requestContext,
    proxyOptions = null,
  }, sender, onConversationReply) {
    const clientHeaders = explicitClientHeaders ?? requestContext?.clientHeaders ?? null;
    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array"),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Tool-call emulation (OmniRoute #5240, OmniRoute #7679): inject a `<tool>` contract when tools
    // are present; parsed back on the response side. Hardened for thinking models.
    const resolvedModel = resolveChatGptModel(model, body, credentials.providerSpecificData);
    const modelSlug = resolvedModel.slug;
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(
      body || {},
      messages
    );

    if (!credentials.apiKey) {
      return {
        response: errorResponse(
          401,
          "ChatGPT auth failed — paste your __Secure-next-auth.session-token cookie value."
        ),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Pass the user's pasted cookie blob through to exchangeSession; the helper
    // accepts bare values, unchunked cookies, chunked (.0/.1) cookies, and full
    // "Cookie: ..." DevTools lines.
    const cookie = credentials.apiKey;

    // 1. Token exchange
    let tokenEntry;
    try {
      tokenEntry = await exchangeSession(cookie, signal, sender);
    } catch (err) {
      if (err instanceof SessionAuthError) {
        log?.warn?.("CGPT-WEB", err.message);
        return {
          response: errorResponse(
            401,
            "ChatGPT auth failed — re-paste your __Secure-next-auth.session-token cookie from chatgpt.com.",
            "HTTP_401"
          ),
          url: SESSION_URL,
          headers: {},
          transformedBody: body,
        };
      }
      log?.error?.(
        "CGPT-WEB",
        `Session exchange failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return {
        response: errorResponse(
          502,
          `ChatGPT session exchange failed: ${err instanceof Error ? err.message : String(err)}`
        ),
        url: SESSION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Surface any rotated cookie back to the caller so the DB credential is refreshed.
    if (tokenEntry.refreshedCookie && tokenEntry.refreshedCookie !== cookie) {
      const updated = { ...credentials, apiKey: tokenEntry.refreshedCookie };
      try {
        await onCredentialsRefreshed?.(updated);
      } catch (err) {
        log?.warn?.(
          "CGPT-WEB",
          `Failed to persist refreshed cookie: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 2a. Warmup — GET / to scrape DPL + script src so the prekey looks legit.
    let dplInfo;
    try {
      dplInfo = await fetchDpl(cookie, signal, sender);
    } catch (err) {
      log?.warn?.(
        "CGPT-WEB",
        `DPL warmup failed (continuing with fallback): ${err instanceof Error ? err.message : String(err)}`
      );
      dplInfo = {
        dpl: `dpl=${OAI_CLIENT_VERSION.replace(/^prod-/, "")}`,
        scriptSrc: `${CHATGPT_BASE}/_next/static/chunks/webpack-${randomHex(16)}.js`,
      };
    }

    // 2a'. Browser-like session warmup. Sentinel scores the session by whether
    // the client recently hit /me, /conversations, /models — same as a real
    // browser does on page load. Failures here are non-fatal; the worst case
    // is Sentinel still escalates to Turnstile.
    const sessionId = randomUUID();
    const turnTraceId = randomUUID();
    const deviceId = deviceIdFor(cookie);
    await runSessionWarmup(
      tokenEntry.accessToken,
      tokenEntry.accountId,
      sessionId,
      deviceId,
      cookie,
      signal,
      log,
      sender
    );

    // 2b. Sentinel chat-requirements
    let reqs;
    try {
      reqs = await prepareChatRequirements(
        tokenEntry.accessToken,
        tokenEntry.accountId,
        sessionId,
        deviceId,
        cookie,
        dplInfo,
        signal,
        log,
        sender
      );
    } catch (err) {
      if (err instanceof SentinelBlockedError) {
        log?.warn?.("CGPT-WEB", err.message);
        return {
          response: errorResponse(
            403,
            "ChatGPT blocked the request (Sentinel/Turnstile required). Try again later or open chatgpt.com in a browser to refresh state.",
            "SENTINEL_BLOCKED"
          ),
          url: SENTINEL_PREPARE_URL,
          headers: {},
          transformedBody: body,
        };
      }
      log?.error?.(
        "CGPT-WEB",
        `Sentinel failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return {
        response: errorResponse(
          502,
          `ChatGPT sentinel failed: ${err instanceof Error ? err.message : String(err)}`
        ),
        url: SENTINEL_PREPARE_URL,
        headers: {},
        transformedBody: body,
      };
    }

    log?.debug?.(
      "CGPT-WEB",
      `sentinel: token=${reqs.token ? "y" : "n"} pow=${reqs.proofofwork?.required ? "y" : "n"} turnstile=${reqs.turnstile?.required ? "y" : "n"}`
    );

    // Optional: if a turnstile token was supplied via providerSpecificData,
    // pass it through. Otherwise, send the request anyway — sometimes Sentinel
    // reports turnstile.required even when the conversation endpoint accepts
    // requests without it.
    const turnstileToken =
      isString(credentials.providerSpecificData?.turnstileToken)
        ? credentials.providerSpecificData.turnstileToken
        : null;

    // 3. Solve PoW (if required) — reuses the same browser-fingerprint config
    // shape as the prekey, just with the server-provided seed + difficulty.
    let proofToken = null;
    if (reqs.proofofwork?.required && reqs.proofofwork.seed && reqs.proofofwork.difficulty) {
      const powConfig = buildPrekeyConfig(CHATGPT_USER_AGENT, dplInfo.dpl, dplInfo.scriptSrc);
      proofToken = await solveProofOfWork(
        reqs.proofofwork.seed,
        reqs.proofofwork.difficulty,
        powConfig,
        log
      );
    }

    // 4. Build conversation request
    const parsed = parseOpenAIMessages(effectiveMessages, { apiKeyId, connectionId });
    if (!parsed.currentMsg.trim() && parsed.history.length === 0) {
      return {
        response: errorResponse(400, "Empty user message"),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Toggle Temporary Chat off only when ChatGPT needs a durable image
    // conversation. Text requests, including GPT-5.6 Sol Pro, stay temporary so
    // they do not show up in the user's chatgpt.com sidebar/history.
    const imageEdit = looksLikeImageEditRequest(parsed);
    const continuation = imageEdit ? parsed.latestImageContext : null;
    const forImageGen = looksLikeImageGenRequest(parsed) || imageEdit;
    const persistConversation = forImageGen || !!continuation;
    if (forImageGen) {
      log?.debug?.(
        "CGPT-WEB",
        continuation
          ? "Image edit intent detected — continuing saved image conversation"
          : "Image-gen intent detected — disabling Temporary Chat for this turn"
      );
    } else if (resolvedModel.isPro) {
      log?.debug?.("CGPT-WEB", "GPT-5.6 Sol Pro text request — keeping Temporary Chat enabled");
    }

    const parentMessageId = continuation?.parentMessageId ?? randomUUID();
    const cgptBody = buildConversationBody(parsed, modelSlug, parentMessageId, {
      persistConversation,
      thinkingEffort: resolvedModel.effort,
      systemHints: resolveChatGptSystemHints(model),
      continuation,
    });

    const headers = {
      ...browserHeaders(),
      ...oaiHeaders(sessionId, deviceId),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${tokenEntry.accessToken}`,
      Cookie: buildNextAuthSessionCookie(cookie),
      "x-oai-turn-trace-id": turnTraceId,
    };
    if (tokenEntry.accountId) headers["chatgpt-account-id"] = tokenEntry.accountId;
    if (reqs.token) headers["openai-sentinel-chat-requirements-token"] = reqs.token;
    if (reqs.prepare_token)
      headers["openai-sentinel-chat-requirements-prepare-token"] = reqs.prepare_token;
    if (proofToken) headers["openai-sentinel-proof-token"] = proofToken;
    if (turnstileToken) headers["openai-sentinel-turnstile-token"] = turnstileToken;

    log?.info?.("CGPT-WEB", `Conversation request → ${modelSlug} (pow=${!!proofToken})`);

    let response;
    try {
      response = await sendTls(sender, CONV_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(cgptBody),
        timeoutMs: 120_000, // generations can take a while
        signal,
        // For real-time streaming, ask the TLS client to write the body to
        // a temp file and surface it as a ReadableStream as it arrives —
        // otherwise long generations buffer entirely before the client sees
        // anything (and the downstream HTTP request can time out).
        stream,
      }, true);
      onConversationReply(response);
    } catch (err) {
      if (isQuotaDispatchUnavailable(err)) throw err;
      log?.error?.("CGPT-WEB", `Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      const code = err instanceof TlsClientUnavailableError ? "TLS_UNAVAILABLE" : undefined;
      return {
        response: errorResponse(
          502,
          `ChatGPT connection failed: ${err instanceof Error ? err.message : String(err)}`,
          code
        ),
        url: CONV_URL,
        headers,
        transformedBody: cgptBody,
      };
    }

    if (response.status >= 400) {
      const status = response.status;
      // Log the upstream body on 4xx/5xx — error responses are small and the
      // upstream message is much more useful than our wrapper. Goes through
      // the executor logger so it respects the application's log config.
      log?.warn?.("CGPT-WEB", `conv ${status}: ${(response.text || "").slice(0, 400)}`);
      const errMsg = describeChatGptWebHttpError(status);
      if (status === 401 || status === 403) {
        tokenCache.delete(cookieKey(cookie));
      }
      log?.warn?.("CGPT-WEB", errMsg);
      return {
        response: errorResponse(status, errMsg, `HTTP_${status}`),
        url: CONV_URL,
        headers,
        transformedBody: cgptBody,
      };
    }

    // For streaming requests the TLS client returns a ReadableStream that
    // tails the temp file as it's written. For non-streaming requests, it
    // returns the full body as text — wrap that in a one-shot stream so the
    // existing SSE parser can consume it uniformly.
    let bodyStream;
    if (response.body) {
      bodyStream = response.body;
    } else if (response.text) {
      bodyStream = stringToStream(response.text);
    } else {
      return {
        response: errorResponse(502, "ChatGPT returned empty response body"),
        url: CONV_URL,
        headers,
        transformedBody: cgptBody,
      };
    }

    const cid = `chatcmpl-cgpt-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    const resolverCtx = {
      accessToken: tokenEntry.accessToken,
      accountId: tokenEntry.accountId,
      sessionId,
      deviceId,
      cookie,
      imageContextOwner: apiKeyId && connectionId ? { apiKeyId, connectionId } : null,
      signal,
      log,
      publicBaseUrl: derivePublicBaseUrl(clientHeaders, log),
      proxyOptions,
    };
    const imageResolver = makeImageResolver(resolverCtx);
    const pollAsyncImage = (conversationId) => pollForAsyncImage(conversationId, resolverCtx);
    const resumeFinalAnswer = (conversationId, resumeToken) =>
      resumeChatGptHandoff({
        conversationId,
        resumeToken,
        headers,
        timeoutMs: configuredProPollTimeoutMs(),
        signal,
        log,
        readContent: extractContent,
      });
    const pollFinalAnswer = resolvedModel.isPro
      ? (conversationId) => pollForFinalAssistantAnswer(conversationId, resolverCtx)
      : null;

    // Tool mode buffers (no live streaming) and is gated off the image-gen path.
    const toolMode = hasTools && !forImageGen;

    let finalResponse;
    if (stream && !toolMode) {
      const sseStream = buildStreamingResponse(
        bodyStream,
        model,
        cid,
        created,
        imageResolver,
        pollAsyncImage,
        resumeFinalAnswer,
        pollFinalAnswer,
        log,
        signal
      );
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(
        bodyStream,
        model,
        cid,
        created,
        parsed.currentMsg,
        imageResolver,
        pollAsyncImage,
        resumeFinalAnswer,
        pollFinalAnswer,
        log,
        signal
      );
      if (toolMode) {
        finalResponse = await buildToolModeResponse(finalResponse, requestedTools, stream, {
          cid,
          created,
          model,
        });
      }
    }

    return { response: finalResponse, url: CONV_URL, headers, transformedBody: cgptBody };
  }
}

export function stringToStream(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

