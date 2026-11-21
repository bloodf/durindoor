import REGISTRY from "open-sse/providers/registry/index.js";
import { getExecutor, hasSpecializedExecutor, UnsupportedOmniRouteWebSessionExecutor } from "open-sse/executors/index.js";
import { NATIVE_OPERATIONS, NATIVE_WEBSOCKETS } from "../../sse/handlers/nativeProviderConfig.js";

/** Local configuration evidence only; this function neither probes nor changes credentials. */
export function providerReadiness(providerId) {
  const entry = REGISTRY.find((item) => item.id === providerId);
  const kinds = [...new Set([
    ...(NATIVE_OPERATIONS[providerId] || []),
    ...Object.values(NATIVE_WEBSOCKETS[providerId] || {}),
  ].map((operation) => operation.kind))].sort();
  let dispatch = "UNKNOWN";
  if (entry) {
    try {
      const executor = getExecutor(providerId);
      if (executor instanceof UnsupportedOmniRouteWebSessionExecutor) dispatch = "UNSUPPORTED";
      else if (hasSpecializedExecutor(providerId) || entry.transport) dispatch = "CONFIGURED";
      else dispatch = "UNSUPPORTED";
    } catch {
      // Search-only providers reject chat dispatch; do not infer other routes.
      dispatch = entry.searchConfig && !entry.transport ? "UNSUPPORTED" : "UNKNOWN";
    }
  }
  return {
    provider: providerId,
    catalog: entry ? "LISTED" : "NOT_LISTED",
    chatDispatch: dispatch,
    nativeKinds: kinds,
    authentication: { status: "UNKNOWN", evidence: "No timestamped authentication evidence available" },
    inference: { status: "UNKNOWN", evidence: "No account, model and operation-bound inference evidence available" },
  };
}
