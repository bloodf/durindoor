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
