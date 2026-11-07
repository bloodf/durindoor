import REGISTRY from "open-sse/providers/registry/index.js";
import { NATIVE_OPERATIONS, NATIVE_WEBSOCKETS } from "../../sse/handlers/nativeProviderConfig.js";

/**
 * Read-only detail/discovery summary. Native route configuration is not a
 * dispatch/auth/inference test. Saved testStatus has no validation timestamp,
 * so it is history only. This caller has no fresh, model/operation/account-bound
 * inference receipt: absent or stale audit evidence must remain UNKNOWN.
 * Never change credential eligibility in response to this summary.
 */
export function nativeProviderReadiness(providerId, connections = []) {
  const catalog = REGISTRY.some((entry) => entry.id === providerId);
  const operations = NATIVE_OPERATIONS[providerId] || [];
  const sockets = Object.values(NATIVE_WEBSOCKETS[providerId] || {});
  return {
    catalog: catalog ? "Listed" : "Not listed",
    nativeRoutes: operations.length + sockets.length > 0 ? "Configured, not verified" : "No dedicated native route configured",
    kinds: [...new Set([...operations, ...sockets].map((operation) => operation.kind))].sort(),
    savedValidation: connections.filter((connection) => connection.provider === providerId && ["active", "success"].includes(connection.testStatus)).length,
    authentication: "UNKNOWN",
    inference: "UNKNOWN",
  };
}
