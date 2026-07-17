// ---------------------------------------------------------------------------
// Kiro model variant generator + GPT-5.6 family (upstream decolua/9router#2596).
//
// Single source of truth for the synthetic `-thinking` / `-agentic` /
// `-thinking-agentic` variants 9router layers on top of every Kiro upstream
// model. The static registry catalog (`providers/registry/kiro.js`), the live
// Kiro catalog expansion in `services/kiroModels.js`, and the capability
// overrides in `providers/capabilities.js` all derive from these exports so
// no hardcoded duplicate list of the synthetic ids can drift apart.
//
// This module is a LEAF: it imports nothing from the provider/registry graph,
// so `registry/kiro.js` can import it without creating an ES module cycle.
// ---------------------------------------------------------------------------

/**
 * Build the synthetic 9router variant set for a single upstream Kiro model:
 * base / -thinking / -agentic / -thinking-agentic. `extra` (contextLength,
 * rateMultiplier, upstreamModelId, description, …) is spread onto every
 * variant. The `auto` model is special: Kiro picks the underlying model
 * server-side, so the chunked-write `-agentic` prompt is not meaningful and
 * the agentic variants are skipped (matches CLIProxyAPIPlus).
 */
export function buildKiroModelVariants(upstream, displayName, extra = {}) {
  const safeUpstream = stripKiroSyntheticSuffixes(upstream);
  const display = displayName || `Kiro ${safeUpstream}`;
  const isAuto = safeUpstream === "auto";

  const variants = [
    {
      id: safeUpstream,
      name: display,
      capabilities: { thinking: false, agentic: false },
      ...extra,
    },
    {
      id: `${safeUpstream}-thinking`,
      name: `${display} (Thinking)`,
      capabilities: { thinking: true, agentic: false },
      ...extra,
    },
  ];

  if (!isAuto) {
    variants.push(
      {
        id: `${safeUpstream}-agentic`,
        name: `${display} (Agentic)`,
        capabilities: { thinking: false, agentic: true },
        ...extra,
      },
      {
        id: `${safeUpstream}-thinking-agentic`,
        name: `${display} (Thinking + Agentic)`,
        capabilities: { thinking: true, agentic: true },
        ...extra,
      },
    );
  }

  return variants;
}

/**
 * Strip the `-agentic` and/or `-thinking` suffixes from a synthetic id, if
 * any. Exported for the Kiro executor/translator paths that recover the wire
 * id from a synthetic one.
 */
export function stripKiroSyntheticSuffixes(id) {
  let out = id;
  if (out.endsWith("-agentic")) out = out.slice(0, -"-agentic".length);
  if (out.endsWith("-thinking")) out = out.slice(0, -"-thinking".length);
  return out;
}

/**
 * Kiro GPT-5.6 upstream models (decolua/9router#2596). `contextLength` and
 * `rateMultiplier` are the values Kiro's ListAvailableModels returns for the
 * family; each entry expands to 4 synthetic variants via
 * buildKiroModelVariants, all pointing back at the bare upstream id.
 */
export const KIRO_GPT_5_6_FAMILY = [
  { id: "gpt-5.6-sol",   name: "GPT 5.6 Sol",   contextLength: 272000, rateMultiplier: 2.4 },
  { id: "gpt-5.6-terra", name: "GPT 5.6 Terra", contextLength: 272000, rateMultiplier: 1.2 },
  { id: "gpt-5.6-luna",  name: "GPT 5.6 Luna",  contextLength: 272000, rateMultiplier: 0.6 },
];

/**
 * Expand one KIRO_GPT_5_6_FAMILY entry into its 4 synthetic variants with the
 * shared upstreamModelId/description metadata attached.
 */
export function buildKiroGpt56Variants(base) {
  return buildKiroModelVariants(base.id, base.name, {
    contextLength: base.contextLength,
    rateMultiplier: base.rateMultiplier,
    upstreamModelId: base.id,
    description: `Experimental preview of OpenAI ${base.name} with 272k context window`,
  });
}
