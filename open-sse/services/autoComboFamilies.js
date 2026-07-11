/**
 * Model-family primitives for auto-combo (F-2).
 *
 * Pure, dependency-free primitives ported verbatim in shape from
 * omniroute open-sse/services/autoCombo/modelFamily.ts. Extracted here (not in
 * combo.js) so BOTH the combo engine and the auto-combo resolver can import the
 * canonical family surface without a combo.js ↔ resolver import cycle.
 *
 * MODEL_FAMILIES is the ordered list of family ids. AUTO_FAMILY_IDS are the
 * advertised `auto/<family>` catalog ids. detectModelFamily matches the BARE
 * model id (everything after the LAST slash) against anchored prefixes; `zai`
 * is intentionally NOT detectable from a model id — it is a provider-override
 * family ("route to my z.ai backend"), distinct from `glm` ("any GLM backend").
 */
export const MODEL_FAMILIES = Object.freeze([
  "glm",
  "minimax",
  "mimo",
  "zai",
  "gemma",
  "llama",
  "gemini",
]);

const MODEL_FAMILY_SET = new Set(MODEL_FAMILIES);

// Model-id prefix → family, matched against the bare id (provider prefix
// stripped). Order matters: first match wins.
const FAMILY_ID_PATTERNS = Object.freeze([
  { family: "glm", pattern: /^glm-/i },
  { family: "minimax", pattern: /^minimax-/i },
  { family: "mimo", pattern: /^mimo-/i },
  { family: "gemma", pattern: /^gemma-/i },
  { family: "llama", pattern: /^llama-/i },
  { family: "gemini", pattern: /^gemini-/i },
]);

// Advertised `auto/<family>` catalog ids (#6453), e.g. `auto/glm`, `auto/minimax`.
export const AUTO_FAMILY_IDS = Object.freeze(MODEL_FAMILIES.map((f) => `auto/${f}`));

/** @returns {boolean} whether `value` is a known family id (incl. `zai`). */
export function isValidModelFamily(value) {
  return typeof value === "string" && MODEL_FAMILY_SET.has(value);
}

/**
 * Whether `family` is selected by PROVIDER alias rather than by model-id prefix.
 * Today only `zai`: it is a provider-override family ("route to my z.ai backend"),
 * never derived from a model id. `auto/zai` therefore pools every model under
 * the `zai` catalog alias, not models whose id starts with `zai-` (none exist).
 */
export function isProviderOverrideFamily(family) {
  return family === "zai";
}

/**
 * Detect the model family from a bare or provider-prefixed model id.
 * Returns null when the id matches no known prefix — including `zai`, which is
 * never detected from a model id (provider-override family; see above).
 *
 * @param {string} modelId - bare id or "provider/model"
 * @returns {string|null} family id from MODEL_FAMILIES (never "zai"), or null
 */
export function detectModelFamily(modelId) {
  if (typeof modelId !== "string" || modelId.trim().length === 0) return null;
  const bare = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId;
  for (const { family, pattern } of FAMILY_ID_PATTERNS) {
    if (pattern.test(bare)) return family;
  }
  return null;
}
