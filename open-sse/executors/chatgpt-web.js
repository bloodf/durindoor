/**
 * ChatGPT Web executor (ported from OmniRoute).
 *
 * Two transports, picked per request:
 *
 *   browser  Primary. Runs chatgpt.com in a pooled Playwright Chromium and lets
 *            the page's own code handle auth, Sentinel, proof-of-work and
 *            Turnstile (../utils/chatgptWebExecutorAdapter.js).
 *   http     Fallback. Talks to chatgpt.com's backend over an impersonating
 *            TLS client and solves Sentinel proof-of-work in Node
 *            (./chatgpt-web-http.js). Also the only path with tool-call
 *            emulation.
 *
 * Selection, from the connection's `providerSpecificData.transport`:
 *   "browser"  browser only.
 *   "http"     HTTP only.
 *   "auto"     (default) browser, unless the request carries tools or the
 *              browser cannot start (no playwright, no Chromium, no display,
 *              pool disabled), in which case HTTP.
 */
import { executeChatGptWebCleanRoom } from "../utils/chatgptWebExecutorAdapter.js";
import { errorResponse, sanitizeErrorMessage } from "../utils/error.js";
import { resolveConnectProxyForRequest } from "../utils/proxyFetch.js";
import { BrowserUnavailableError } from "../services/browserPool.js";
import { BaseExecutor } from "./base.js";
import { ChatGptWebHttpExecutor } from "./chatgpt-web-http.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const CHATGPT_WEB_URL = "https://chatgpt.com";
export const CHATGPT_WEB_TRANSPORTS = ["auto", "browser", "http"];

// The page's own conversation request failed with an auth status. The HTTP transport
// already reports these as 401/403, so an expired session reads the same on both.
const UPSTREAM_AUTH_STATUS = /\bconversation failed with status (401|403)\b/i;

function statusForAdapterError(message) {
  if (/storage state|credentials|connection ID|session cookie/i.test(message)) return 401;
  const upstreamAuth = UPSTREAM_AUTH_STATUS.exec(message);
  if (upstreamAuth) return Number(upstreamAuth[1]);
  // Preserve upstream quota semantics so the shared account-fallback loop can exclude a
  // depleted Free session and immediately try the next configured ChatGPT Web account.
  if (
    /(?:\bHTTP[_\s-]*429\b|\bstatus\s+429\b|\brate[-_\s]?limit(?:ed)?\b|\bquota\s+(?:exhausted|reached|exceeded)\b|\b(?:image(?:\s+upload)?|upload|usage)\s+limit\s+(?:reached|exceeded)\b|\breached\s+(?:your\s+)?(?:image(?:\s+upload)?|upload|usage)\s+limit\b)/i.test(
      message
    )
  ) {
    return 429;
  }
  if (/request|messages|prompt|model|tools|text content|reasoning effort/i.test(message))
    return 400;
  if (/browser|chromium|playwright|display/i.test(message)) return 503;
  return 502;
}

/**
 * @param {object|null|undefined} providerSpecificData
 * @returns {"auto"|"browser"|"http"}
 */
export function resolveChatGptWebTransport(providerSpecificData) {
  const raw = providerSpecificData?.transport;
  const value = isString(raw) ? raw.trim().toLowerCase() : "";
  return CHATGPT_WEB_TRANSPORTS.includes(value) ? value : "auto";
}

function hasTools(body) {
  return Array.isArray(body?.tools) && body.tools.length > 0 && body?.tool_choice !== "none";
}

function hasMediaParts(body) {
  return Array.isArray(body?.messages) && body.messages.some((message) =>
    Array.isArray(message?.content) && message.content.some((part) =>
      isObject(part) && ["image", "image_url", "input_image", "file", "document", "input_file"].includes(part.type),
    ),
  );
}

export class ChatGptWebExecutor extends BaseExecutor {
  /**
   * @param {object} [deps] test seams: `browser` (adapter deps), `runBrowser`,
   *   `httpExecutor`.
   */
  constructor(deps = {}) {
    super("chatgpt-web", { id: "chatgpt-web", baseUrl: CHATGPT_WEB_URL });
    this.deps = deps;
    this.httpExecutor = deps.httpExecutor ?? new ChatGptWebHttpExecutor();
  }

  async execute(input) {
    const transport = resolveChatGptWebTransport(input.credentials?.providerSpecificData);
    const hasMedia = hasMediaParts(input.body);
    const hasRequestTools = hasTools(input.body);
    if (transport === "auto" && hasMedia && hasRequestTools) {
      const message = "ChatGPT Web cannot process image or file inputs together with tools.";
      return {
        response: errorResponse(400, message, { type: "invalid_request", code: "UNSUPPORTED_MEDIA_WITH_TOOLS" }),
        url: CHATGPT_WEB_URL,
        headers: {},
        transformedBody: input.body,
      };
    }
    if (transport === "http" || (transport === "auto" && hasRequestTools)) {
      return this.httpExecutor.execute(input);
    }
    try {
      return await this.runBrowser(input);
    } catch (error) {
      if (transport === "auto" && !hasMedia && error instanceof BrowserUnavailableError) {
        input.log?.warn?.("CGPT-WEB", `Browser transport unavailable, using HTTP: ${error.message}`);
        return this.httpExecutor.execute(input);
      }
      let message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
      // Runtime prerequisites are unavailable even when their diagnostics mention a request.
      const status = error instanceof BrowserUnavailableError ? 503 : statusForAdapterError(message);
      if (UPSTREAM_AUTH_STATUS.test(message)) {
        message = `ChatGPT auth failed (HTTP ${status}) — the session may be expired. Re-paste your __Secure-next-auth.session-token cookie from chatgpt.com.`;
      }
      return {
        response: errorResponse(status, message || "ChatGPT Web browser execution failed", {
          type: "upstream_error",
          code: `HTTP_${status}`,
        }),
        url: CHATGPT_WEB_URL,
        headers: {},
        transformedBody: input.body,
      };
    }
  }

  runBrowser(input) {
    const proxyUrl = resolveConnectProxyForRequest(CHATGPT_WEB_URL, input.proxyOptions).proxyUrl;
    const run = this.deps.runBrowser ?? executeChatGptWebCleanRoom;
    return run({ ...input, proxyUrl }, this.deps.browser ?? {});
  }
}

export default ChatGptWebExecutor;
