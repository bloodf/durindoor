// OmniRoute #20416: decide whether an error thrown while dispatching upstream is
// worth another send. A programming error throws the same way every time.
import { isString } from "../../src/shared/utils/typeChecks.js";

const NETWORK_ERROR_CODES = new Set([
  "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "EPIPE", "EHOSTUNREACH",
  "ENETUNREACH", "ENOTCONN", "ENOTFOUND", "EAI_AGAIN", "ERR_NETWORK", "ERR_SOCKET",
  "ERR_CONNECTION", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"
]);

const PROGRAMMING_ERROR_NAMES = new Set(["TypeError", "SyntaxError", "ReferenceError", "RangeError", "URIError"]);

// Transport phrases only: a bare "network" would also match
// "Cannot read properties of undefined (reading 'network')".
const NETWORK_MESSAGE_RE = /fetch failed|socket hang up|socket terminated|connection terminated|network (?:error|failure|timeout|unreachable|down)/i;

function carriesNetworkSignal(error) {
  // undici rejects with a bare TypeError whose cause holds the transport code.
  if (isString(error.cause?.code)) return true;
  return NETWORK_ERROR_CODES.has(error.code) ||
    error.name === "TimeoutError" || error.name === "BodyTimeoutError" ||
    [error.message, error.cause?.message].some((text) => isString(text) && NETWORK_MESSAGE_RE.test(text));
}

/**
 * False only for a recognized programming error with no transport signal.
 * Anything undecidable stays retryable. Cancellation is the caller's concern.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRetryableThrownError(error) {
  if (!error) return true;
  return carriesNetworkSignal(error) || !PROGRAMMING_ERROR_NAMES.has(error.name);
}
