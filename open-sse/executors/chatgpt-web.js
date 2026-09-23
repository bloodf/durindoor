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
import { resolveProxyForRequest } from "../utils/proxyFetch.js";
import { BrowserUnavailableError } from "../services/browserPool.js";
import { BaseExecutor } from "./base.js";
import { ChatGptWebHttpExecutor } from "./chatgpt-web-http.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const CHATGPT_WEB_URL = "https://chatgpt.com";
export const CHATGPT_WEB_TRANSPORTS = ["auto", "browser", "http"];

function statusForAdapterError(message) {
  if (/storage state|credentials|connection ID|session cookie/i.test(message)) return 401;
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
    if (transport === "http" || (transport === "auto" && hasTools(input.body))) {
      return this.httpExecutor.execute(input);
    }
    try {
      return await this.runBrowser(input);
    } catch (error) {
      if (transport === "auto" && error instanceof BrowserUnavailableError) {
        input.log?.warn?.("CGPT-WEB", `Browser transport unavailable, using HTTP: ${error.message}`);
        return this.httpExecutor.execute(input);
      }
      const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
      const status = statusForAdapterError(message);
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
    const proxyUrl = resolveProxyForRequest(CHATGPT_WEB_URL, input.proxyOptions).proxyUrl;
    const run = this.deps.runBrowser ?? executeChatGptWebCleanRoom;
    return run({ ...input, proxyUrl }, this.deps.browser ?? {});
  }
}

export default ChatGptWebExecutor;
