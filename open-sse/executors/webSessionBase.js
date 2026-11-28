import { WebSessionExecutor as WebSessionTransport } from "./web-session-executor.js";
import { readStreamLines } from "./websession-utils.js";
import { extractCookieValue, stripCookieInputPrefix } from "../../src/shared/utils/cookieValue.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

/**
 * The base every staged web-session executor extends (#2311). The transport
 * (proxy, caller signal, manual redirect, header deadline, quota ticket) and
 * the sanitized error envelope come from web-session-executor.js; this layer
 * adds the cookie parsing and stream line reading the executors used to repeat.
 * SSE field parsing stays in each executor: it is provider-private (see the
 * allowlist in tests/unit/review-x-sse-final.test.js).
 */
export class WebSessionExecutor extends WebSessionTransport {
  /** A pasted cookie value without a `Cookie:` or `Bearer` prefix; "" for anything else. */
  cookieInput(value) {
    return isString(value) ? stripCookieInputPrefix(value) : "";
  }

  /** The stored cookie of a connection, from the API key or the imported cookie. */
  storedCookie(credentials) {
    return this.cookieInput(credentials?.apiKey || credentials?.providerSpecificData?.cookie || "");
  }

  /** One named cookie from a pasted header; "" when absent. */
  cookieValue(cookieHeader, name) {
    return extractCookieValue(this.cookieInput(cookieHeader), name);
  }

  /** The lines of a streamed upstream body; see readStreamLines. */
  readLines(body, options) {
    return readStreamLines(body, options);
  }

}

export default WebSessionExecutor;
