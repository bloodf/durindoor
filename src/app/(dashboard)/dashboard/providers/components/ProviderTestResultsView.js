import PropTypes from "prop-types";

export default function ProviderTestResultsView({ results }) {
  if (results.error && !results.results) {
    return (
      <div className="text-center py-6">
        <span className="material-symbols-outlined text-dd-danger text-[32px] mb-2 block">
          error
        </span>
        <p className="text-sm text-dd-danger">{results.error}</p>
      </div>);

  }

  const { summary, mode } = results;
  const items = results.results || [];
  const modeLabel =
  {
    oauth: "OAuth",
    free: "Free",
    apikey: "API Key",
    provider: "Provider",
    all: "All"
  }[mode] || mode;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {summary &&
      <div className="flex flex-wrap items-center gap-2 text-xs mb-1 sm:gap-3">
          <span className="text-dd-muted">{modeLabel} Test</span>
          <span className="px-2 py-0.5 rounded bg-dd-accent-soft text-dd-accent font-medium">
            {summary.passed} passed
          </span>
          {summary.failed > 0 &&
        <span className="px-2 py-0.5 rounded bg-dd-danger/10 text-dd-danger font-medium">
              {summary.failed} failed
            </span>
        }
          {summary.skipped > 0 &&
        <span className="px-2 py-0.5 rounded bg-dd-surface-2 text-dd-muted font-medium">
              {summary.skipped} skipped
            </span>
        }
          {summary.unavailable > 0 &&
        <span className="px-2 py-0.5 rounded bg-dd-surface-2 text-dd-muted font-medium">
              {summary.unavailable} unavailable
            </span>
        }
          <span className="text-dd-muted sm:ml-auto">
            {summary.total} tested
          </span>
        </div>
      }
      {items.map((r, i) =>
      <div
        key={r.connectionId || i}
        className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-dd-text/[0.03] px-3 py-2 text-xs dark:bg-dd-surface/[0.03] sm:flex-nowrap">

          <span
          className={`material-symbols-outlined text-[16px] ${r.skipped || r.unavailable ? "text-dd-muted" : r.valid ? "text-dd-accent" : "text-dd-danger"}`}>

            {r.skipped || r.unavailable ? "info" : r.valid ? "check_circle" : "error"}
          </span>
          <div className="min-w-0 flex-[1_1_160px]">
            <span className="block truncate font-medium sm:inline">
              {r.connectionName}
            </span>
            <span className="block truncate text-dd-muted sm:ml-1.5 sm:inline">
              ({r.provider})
            </span>
          </div>
          {r.latencyMs !== undefined &&
        <span className="shrink-0 text-dd-muted font-mono tabular-nums">
              {r.latencyMs}ms
            </span>
        }
          <span
          className={`shrink-0 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
          r.skipped || r.unavailable ?
          "bg-dd-surface-2 text-dd-muted" :
          r.valid ?
          "bg-dd-accent-soft text-dd-accent" :
          "bg-dd-danger/10 text-dd-danger"}`
          }>

            {r.skipped ? "SKIPPED" : r.unavailable ? "UNAVAILABLE" : r.valid ? "OK" : r.diagnosis?.type || "ERROR"}
          </span>
          {r.unavailable && r.error && <span className="text-dd-muted">{r.error}</span>}
        </div>
      )}
      {items.length === 0 &&
      <div className="text-center py-4 text-dd-muted text-sm">
          No active connections found for this group.
        </div>
      }
    </div>);

}

ProviderTestResultsView.propTypes = {
  results: PropTypes['shape']({
    mode: PropTypes.string,
    results: PropTypes.array,
    summary: PropTypes['shape']({
      total: PropTypes.number,
      passed: PropTypes.number,
      failed: PropTypes.number,
      unavailable: PropTypes.number,
      skipped: PropTypes.number
    }),
    error: PropTypes.string
  }).isRequired
};
