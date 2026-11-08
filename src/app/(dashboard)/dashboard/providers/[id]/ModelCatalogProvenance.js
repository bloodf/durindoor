import { useEffect, useReducer } from "react";
import { catalogDiscoveryStatus } from "@/shared/utils/catalogDiscoveryStatus";

/** Read-only list provenance, not a claim about individual model capabilities.
 * Refresh locally at the configured interval boundary without fetching discovery.
 * Long waits are split to stay within the signed 32-bit browser timer limit.
 */
export default function ModelCatalogProvenance({ providerId, status }) {
  const [clock, refreshClock] = useReducer((value) => value + 1, 0);
  const discovery = catalogDiscoveryStatus(status);
  useEffect(() => {
    const now = Date.now();
    const currentDiscovery = catalogDiscoveryStatus(status, now);
    if (currentDiscovery !== discovery) {
      refreshClock();
      return;
    }
    if (currentDiscovery !== "Within the configured sync interval. Availability is not verified.") return;
    const delay = Date.parse(status.syncedAt) + status.intervalHours * 3600000 - now;
    if (!Number.isFinite(delay)) return;
    const timer = setTimeout(refreshClock, Math.min(Math.max(1, delay), 2147483647));
    return () => clearTimeout(timer);
  }, [status, clock, discovery]);
  return (
    <dl aria-label="Model list provenance" className="text-[11px] text-dd-muted">
      <div><dt className="inline">Provider identity: </dt><dd className="inline">{providerId}</dd></div>
      <div><dt className="inline">Runtime list source: </dt><dd className="inline">{status.enabled && Array.isArray(status.models) ? "Provider discovery with derived registry variants" : "Built-in registry"}</dd></div>
      <div><dt className="inline">Discovery freshness: </dt><dd className="inline">{discovery}</dd></div>
      <div><dt className="inline">Vendor verification: </dt><dd className="inline">UNKNOWN. A list-models response does not verify the model vendor or its capabilities.</dd></div>
    </dl>
  );
}
