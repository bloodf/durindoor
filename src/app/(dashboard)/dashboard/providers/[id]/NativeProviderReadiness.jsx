import { nativeProviderReadiness } from "@/shared/utils/nativeProviderReadiness.js";

export default function NativeProviderReadiness({ providerId, connections }) {
  const readiness = nativeProviderReadiness(providerId, connections);
  return (
    <section aria-label="Provider readiness" className="rounded-dd-lg border border-dd-border p-4 text-sm">
      <h2 className="mb-3 text-lg font-semibold">Provider readiness</h2>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div><dt className="text-dd-muted">Catalog metadata</dt><dd>{readiness.catalog}</dd></div>
        <div><dt className="text-dd-muted">Native dispatch</dt><dd>{readiness.nativeRoutes}</dd></div>
        <div><dt className="text-dd-muted">Current authentication</dt><dd>{readiness.authentication}</dd></div>
        <div><dt className="text-dd-muted">Actual inference</dt><dd>{readiness.inference}</dd></div>
      </dl>
      <p className="mt-3 text-dd-muted">Saved successful credential validations: {readiness.savedValidation}. These records have no validation timestamp and do not prove current authentication or inference.</p>
      <p className="mt-2 text-dd-muted">Configured native kinds: {readiness.kinds.join(", ") || "none"}. Other gateway routes may exist. Model, modality and tool support depend on the selected route and model; unlisted native operations are unsupported on the native route.</p>
      <p className="mt-2 text-dd-muted">No fresh inference evidence is available here. Missing or stale evidence remains UNKNOWN. Catalog entries and configured routes do not prove a live request works. This summary makes no requests and does not disable credentials after transient errors.</p>
    </section>
  );
}
