import { isObject, isString } from "@/shared/utils/typeChecks.js"; // F-1b production wiring for the chatCore compression seam.
//
// Settings (compressionV2Mode / compressionV2Stack) -> the per-engine toggle map
// the chatCore seam hands to deriveDefaultPlan. Intensity rides along on each
// plan step (stackedPipeline[].intensity) and reaches the engine via stepConfig,
// so there is no separate level map. Pure mapping, no F-1a service imports: the
// F-1a modules are statically imported by the seam (loaded only when enabled).

/**
 * Derive the per-engine toggle map for deriveDefaultPlan from the V2 settings.
 *
 * compressionV2Mode:  single-engine id (e.g. "caveman", "headroom"), "stacked",
 *                     or "off".
 * compressionV2Stack: array of { engine, intensity? } entries for stacked mode.
 *
 * Map shape matches deriveDefaultPlan's expectation: { [id]: { enabled, level? } }.
 * A single mode enables exactly that engine; "stacked" enables each listed engine
 * (preserving intensity as level); "off" (or a stale stack with a non-stacked
 * mode) yields an empty map -> plan "off" (no-op).
 */
export function enginesFromV2Settings(mode, stack) {
  const engines = {};
  if (mode === "stacked") {
    if (Array.isArray(stack)) {
      for (const entry of stack) {
        const id = isString(entry) ? entry : entry?.engine;
        if (!id) continue;
        const intensity = isObject(entry) ? entry?.intensity : undefined;
        engines[id] = intensity ? { enabled: true, level: intensity } : { enabled: true };
      }
    }
  } else if (isString(mode) && mode && mode !== "off") {
    engines[mode] = { enabled: true };
  }
  return engines;
}