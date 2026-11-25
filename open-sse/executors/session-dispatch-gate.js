import { UnsupportedOmniRouteWebSessionExecutor } from "./unsupported-websession.js";
import { MuseSparkWebExecutor } from "./muse-spark-web.js";
import { HuggingChatExecutor } from "./huggingchat.js";

// Guarded web sessions that stay closed unless the connection opts in. The opt-in is read from the
// connection's own providerSpecificData, so enabling one account never opens a sibling (#2034).
const GATED_EXECUTORS = {
  huggingchat: () => new HuggingChatExecutor(),
  "muse-spark-web": () => new MuseSparkWebExecutor(),
};
// One real executor per provider, shared by the canonical id and its aliases.
const gatedExecutors = new Map();

export function isSessionDispatchEnabled(provider, credentials) {
  return Object.hasOwn(GATED_EXECUTORS, provider) &&
    credentials?.providerSpecificData?.enableSessionDispatch === true;
}

/**
 * Puts a real executor behind the per-connection opt-in. Only execute() ever
 * reaches it: every other path, including buildUrl()/buildHeaders(), keeps the
 * fail-closed behaviour inherited from the blocked-provider stub.
 */
export class SessionDispatchGateExecutor extends UnsupportedOmniRouteWebSessionExecutor {
  async execute(input) {
    if (!isSessionDispatchEnabled(this.provider, input?.credentials)) return super.execute(input);
    if (!gatedExecutors.has(this.provider)) gatedExecutors.set(this.provider, GATED_EXECUTORS[this.provider]());
    return gatedExecutors.get(this.provider).execute(input);
  }
}

/** The executor for a blocked provider id: gated when a real executor exists, else the plain stub. */
export function createBlockedProviderExecutor(provider) {
  return Object.hasOwn(GATED_EXECUTORS, provider) ?
    new SessionDispatchGateExecutor(provider) :
    new UnsupportedOmniRouteWebSessionExecutor(provider);
}
