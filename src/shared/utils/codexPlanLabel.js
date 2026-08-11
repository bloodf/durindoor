/**
 * Resolve the Codex/ChatGPT plan badge label for a connection or quota row.
 *
 * Shared by the provider connection row and the usage quota view so both apply
 * the same badge-visibility rule and cannot drift. Returns the trimmed plan
 * string only when the row is a Codex provider AND the value is a non-empty
 * string that is not the placeholder "unknown" (case-insensitive); otherwise an
 * empty string, meaning render no badge.
 *
 * @param {boolean} isCodex - whether the connection provider is "codex"
 * @param {unknown} rawPlan - e.g. connection.providerSpecificData.chatgptPlanType or quota.plan
 * @returns {string} display label, or "" when the badge should be hidden
 */
export function getCodexPlanLabel(isCodex, rawPlan) {
  if (!isCodex || typeof rawPlan !== "string") return "";
  const plan = rawPlan.trim();
  if (!plan || plan.toLowerCase() === "unknown") return "";
  return plan;
}

/**
 * Badge value for a Codex row: the live quota plan wins, with the connection's
 * stored OAuth metadata as fallback. The stored value is only written at
 * authorization time, so it goes stale after an upgrade — but it beats showing
 * no badge when the live read is unavailable or returns "unknown".
 *
 * Upstream decolua/9router#3210.
 *
 * @returns {string} display label, or "" when no badge should render.
 */
export function getCodexPlan(quota, connection) {
  const live = getCodexPlanLabel(true, quota?.plan);
  if (live) return live;
  return getCodexPlanLabel(true, connection?.providerSpecificData?.chatgptPlanType);
}

/**
 * Reduce a connection's live usage payload to a `[connectionId, plan]` entry,
 * or null when it carries nothing renderable.
 */
export function toCodexPlanEntry(connectionId, usage) {
  const plan = getCodexPlanLabel(true, usage?.plan);
  return plan ? [connectionId, plan] : null;
}

/** Build the connectionId → live plan map the provider page passes to rows. */
export function buildCodexPlanMap(entries) {
  return Object.fromEntries((entries || []).filter(Boolean));
}
