import { BaseExecutor } from "./base.js";
import { createExecutorSender, requestAbortError, withBillableDispatch } from "./sendRequest.js";
import { normalizeSessionCookieHeader } from "./websession-utils.js";
import { errorResponse } from "../utils/error.js";
import { sseChunk } from "../utils/sse.js";

/**
 * Base for executors that drive a signed-in web session. The base owns the
 * transport: a subclass implements runSession(input, transport) and sends only
 * through transport.send()/sendBillable(). Both apply the connection's proxy,
 * the caller's abort signal, a manual redirect (a login redirect is answered by
 * the executor, never followed with the cookie) and the configured header
 * deadline. The base also moves the quota ticket of the billable send onto
 * whatever response runSession() returns, and settles it when runSession()
 * throws.
 */
export class WebSessionExecutor extends BaseExecutor {
  constructor(provider, config, { observePatchedFetch = true } = {}) {
    super(provider, config);
    this.observePatchedFetch = observePatchedFetch;
  }

  async execute(input) {
    if (input.signal?.aborted) throw requestAbortError(input.signal.reason);
    const sender = createExecutorSender(this, input, { observePatchedFetch: this.observePatchedFetch });
    const result = await withBillableDispatch(sender, (billed) => this.runSession(input, this.sessionTransport(input, sender, billed)));
    // A session may read the answer with a later request, so report the latest physical send.
    const attemptStartedAt = sender.attemptStartedAt;
    return result?.response && attemptStartedAt ? { ...result, attemptStartedAt } : result;
  }

  async runSession() {
    throw new Error(`${this.provider} must implement runSession()`);
  }

  sessionTransport(input, sender, billed) {
    const dispatch = (url, init, options) => sender.sendRequest(
      url,
      { redirect: "manual", signal: input.signal, ...init },
      input.proxyOptions,
      options,
    );
    return {
      /** A setup, probe or stream-read request: never charged against quota. */
      send: (url, init = {}, options = {}) => dispatch(url, init, { ...options, quotaBearing: false }),
      /** The request that spends the account's quota. */
      sendBillable: async (url, init = {}, options = {}) => billed(await dispatch(url, init, { ...options, quotaBearing: true })),
    };
  }

  /** The Cookie header for a pasted header or a bare session token; "" when there is none. */
  sessionCookie(credentials, defaultCookieName) {
    return normalizeSessionCookieHeader(credentials?.apiKey || credentials?.providerSpecificData?.cookie || "", defaultCookieName);
  }

  /** The OpenAI error envelope, with the message passed through the shared sanitizer. */
  errorReply(status, message) {
    return errorResponse(status, message, { type: "upstream_error", code: `HTTP_${status}` });
  }

  /** A complete SSE reply for chunks that are already known. */
  sseReply(chunks) {
    return new Response(`${chunks.map(sseChunk).join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  }
}
