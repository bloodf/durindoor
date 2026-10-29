/** Model windows are provider-reported, not inferred from another account's plan. */
export const CLAUDE_UNREPORTED_WINDOW_TITLE = "Anthropic did not report this window for this account";

export function getClaudeWeeklyWindowNames(connections, quotaData) {
  const names = new Set();
  for (const connection of connections) {
    if (connection.provider !== "claude") continue;
    for (const quota of quotaData[connection.id]?.quotas || []) {
      if (/^weekly .+ \(7d\)$/.test(quota.name) && !quota.notReported) names.add(quota.name);
    }
  }
  return [...names].sort();
}

/** Append display-only rows AFTER visibility filtering; never cache or merge them. */
export function withClaudeWeeklyPlaceholders(visibleQuotas, reportedQuotas, windowNames) {
  const reportedNames = new Set(reportedQuotas.map((quota) => quota.name));
  const missing = windowNames.filter((name) => !reportedNames.has(name));
  if (missing.length === 0) return visibleQuotas;
  return [
    ...visibleQuotas,
    ...missing.map((name) => ({ name, notReported: true, title: CLAUDE_UNREPORTED_WINDOW_TITLE })),
  ];
}
