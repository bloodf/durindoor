// JSX-free helper (same pattern as SidebarNavIcons.js) so tests can import
// without JSX transform, and the "use client" page stays free of node:fs
// (src/lib/pxpipe/events.js is server-only).
// Event shape (src/lib/pxpipe/events.js): { ts, provider, model, applied,
// reason, tokensBeforeEst, tokensSavedEst, imageCount, durationMs }

export const PXPIPE_REASON_LABELS = {
  applied: "Prompt exceeded threshold",
  below_threshold: "Below size threshold",
  not_profitable: "Compression not profitable",
  below_min_chars: "Below minimum chars",
  below_min_tokens: "Below minimum tokens",
  unsupported_model: "Model not in allowlist",
  unsupported_format: "Non-Claude request format",
  timeout: "Compression timed out",
  transform_error: "Transform error",
  passthrough: "Passthrough",
  disabled: "Disabled",
  not_installed: "Not installed",
};

export const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

export function formatPxpipeEvent(e) {
  const when = e.ts ? new Date(e.ts).toISOString() : "";
  const target = [e.provider, e.model].filter(Boolean).join("/");
  const outcome = e.applied
    ? `compressed ${e.imageCount ?? 0} img, ~${fmtTokens(e.tokensSavedEst ?? 0)} tokens saved${e.durationMs != null ? ` in ${e.durationMs}ms` : ""}`
    : `skipped${e.reason ? ` — ${PXPIPE_REASON_LABELS[e.reason] || e.reason}` : ""}`;
  return [when && `[${when}]`, target, outcome].filter(Boolean).join(" ");
}
