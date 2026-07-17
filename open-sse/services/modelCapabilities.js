// Models that do not support reasoning/thinking parameters.
// Antigravity routes return 400 when thinking params are included.
const REASONING_UNSUPPORTED_PATTERNS = [
  "antigravity/claude-sonnet-4-6",
  "antigravity/claude-sonnet-4-5",
  "antigravity/claude-sonnet-4",
  // Non-Claude Antigravity models do not support thinking params (OmniRoute #1361).
  "antigravity/gemini-",
  "antigravity/gpt-oss-",
  "antigravity/gemini-3",
  "antigravity/tab_",
];

/** Whether a model is free of a known explicit reasoning denial. */
export function supportsReasoning(modelStr) {
  const normalized = String(modelStr || "").toLowerCase();
  if (!normalized) return true;

  return !REASONING_UNSUPPORTED_PATTERNS.some((pattern) =>
    normalized === pattern ||
    normalized.endsWith(`/${pattern}`) ||
    normalized.includes(pattern)
  );
}
