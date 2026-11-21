/**
 * Provider keepalive event blocks (OmniRoute #1146).
 *
 * Some providers emit an SSE event named `keepalive` whose frame carries no
 * payload. Strict OpenAI-compatible SDKs try to JSON.parse the empty body and
 * crash, so the gateway drops the whole block — the label and the frame body
 * that follows it — before it reaches the client.
 *
 * The match is limited to the provider's own `event: keepalive` label.
 * Anthropic's `event: ping` frames, SSE comments (`: keepalive`) and the
 * gateway-generated keepalives are different frames and are never touched.
 */

import { isString } from "../../src/shared/utils/typeChecks.js";

// SSE event names are exact and case-sensitive.
const PROVIDER_KEEPALIVE_EVENT_RE = /^event: ?keepalive$/;

/**
 * @param {string} line trimmed SSE line
 * @returns {boolean} true when the line opens a provider keepalive event block
 */
export function isProviderKeepaliveEvent(line) {
  return isString(line) && PROVIDER_KEEPALIVE_EVENT_RE.test(line);
}

/**
 * Legacy line filter retained for compatibility; it cannot distinguish payloads.
 * Passthrough streams use bounded candidate framing in stream.js instead.
 *
 * The filter owns the frame boundaries: once a keepalive label is seen, every
 * line of that block is dropped until the blank line that terminates it. The
 * payload that follows the block is untouched and keeps its order.
 */
export function createProviderKeepaliveFilter() {
  let dropping = false;

  return {
    /**
     * @param {string} line trimmed SSE line
     * @returns {boolean} true when the line must not reach the client
     */
    drop(line) {
      if (dropping) {
        // The blank line terminates the dropped block and goes with it.
        if (!line) dropping = false;
        return true;
      }
      if (isProviderKeepaliveEvent(line)) {
        dropping = true;
        return true;
      }
      return false;
    },
    /** @returns {boolean} true while a dropped block still owns the stream tail */
    get dropping() {
      return dropping;
    },
    /** Forget an unterminated block (the stream ended inside it). */
    reset() {
      dropping = false;
    },
  };
}
