// Helper that wraps readBoundedResponseText so handlers can distinguish a
// bounded body-read timeout (mapped to 504 GATEWAY_TIMEOUT upstream) from
// other body-decoding failures (kept on 502 BAD_GATEWAY). The underlying
// timer + abort machinery is in utils/error.js.
import { readBoundedResponseText } from "./error.js";

export class BodyReadTimeoutError extends Error {
  constructor() {
    super("Provider response body timed out");
    this.name = "BodyReadTimeoutError";
  }
}

export async function readBodyWithTimeout(response, { signal, maxBytes, timeoutMs } = {}) {
  // `timeoutMs <= 0` opts out of the bounded wait (upstream semantics) so
  // operator-driven override can disable the timer without re-rolling the
  // call. envMs() at the config layer still refuses to supply 0, which is
  // intentional for the process-wide default.
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return readBoundedResponseText(response, { signal, maxBytes });
  }
  try {
    return await readBoundedResponseText(response, {
      signal,
      maxBytes,
      timeoutMs,
      throwOnTimeout: true,
    });
  } catch (error) {
    if (error?.name === "TimeoutError") throw new BodyReadTimeoutError();
    throw error;
  }
}
