import { catalogDiscoveryStatus } from "@/shared/utils/catalogDiscoveryStatus";

/** Read-only list provenance, not a claim about individual model capabilities. */
export default function ModelCatalogProvenance({ providerId, status }) {
  const discovery = catalogDiscoveryStatus(status);
  return (
    <dl aria-label="Model list provenance" className="text-[11px] text-dd-muted">
      <div><dt className="inline">Provider identity: </dt><dd className="inline">{providerId}</dd></div>
      <div><dt className="inline">Runtime list source: </dt><dd className="inline">{status.enabled && Array.isArray(status.models) ? "Provider discovery with derived registry variants" : "Built-in registry"}</dd></div>
      <div><dt className="inline">Discovery freshness: </dt><dd className="inline">{discovery}</dd></div>
      <div><dt className="inline">Vendor verification: </dt><dd className="inline">UNKNOWN. A list-models response does not verify the model vendor or its capabilities.</dd></div>
    </dl>
  );
}
