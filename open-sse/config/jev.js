// Jev (TypeSafe "System One") routing-classifier config — constants only.
// Per open-sse/AGENTS.md: ALL config lives here, nothing is hardcoded elsewhere.
//
// Jev is NOT a provider or a combo member — it does not generate text. It is a
// decision model: unstructured `state` in, typed probabilities out. DurinDoor
// uses it as an optional upgrade to the local heuristic task classifier that
// drives the `smart` / `task` combo strategies. When it answers confidently its
// tier replaces the heuristic level; the existing task-weight model scoring and
// the availability/quota fallback ladder then run untouched.

export const JEV_ENDPOINT_PATH = "/v1/systemone";
export const JEV_DEFAULT_BASE = "https://api.typesafe.ai";
export const JEV_DEFAULT_MODEL = "jev-latest";

// Complexity tiers, cheapest → most capable.
export const JEV_TIERS = ["SIMPLE", "MEDIUM", "COMPLEX", "REASONING"];

// Bridge to the fork's own task levels (see classifyTask in services/combo.js).
// Mapping instead of an upstream-style per-combo tier→model map: DurinDoor
// already scores every member against a task level, so a tier is enough and no
// new per-combo policy has to be configured or kept in sync with the members.
export const JEV_TIER_TO_TASK_LEVEL = {
  SIMPLE: "light",
  MEDIUM: "standard",
  COMPLEX: "heavy",
  REASONING: "critical",
};

// Default criteria for the single `choice` question.
export const JEV_DEFAULT_CRITERIA = {
  SIMPLE: "Direct lookups, greetings, single-file extraction, trivial edits, formatting.",
  MEDIUM: "Localized bug fixes, writing a function, small refactors within one file/module.",
  COMPLEX: "Multi-file changes, architecture, integration/design decisions, debugging across a system.",
  REASONING: "Hard algorithmic/mathematical reasoning, subtle concurrency/correctness proofs, deep analysis.",
};
export const JEV_DEFAULT_INSTRUCTIONS =
  "Classify the coding task by the least-capable model tier that can complete it well.";

// Bounded state: never ship the whole transcript / tool_result blobs to Jev.
// Cost, latency and signal all degrade if we do.
export const JEV_STATE_CHAR_BUDGET = 4000;

// Hard deadline + circuit breaker. On any failure we keep the local heuristic
// level — the classifier must never become a single point of failure.
export const JEV_TIMEOUT_MS = 3000;
export const JEV_BREAKER_COOLDOWN_MS = 30000;

// Below this confidence we do not trust the tier and keep the heuristic level.
// Jev's probabilities are calibrated, so this threshold is meaningful.
export const JEV_MIN_CONFIDENCE = 0.5;

// Pricing for spend logging only (per MTok). TypeSafe bills output as free.
// Reported separately from the completion model, never folded into it.
export const JEV_INPUT_PRICE_PER_MTOK = 0.042;
export const JEV_OUTPUT_PRICE_PER_MTOK = 0;
