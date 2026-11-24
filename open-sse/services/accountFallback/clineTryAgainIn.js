// Provider ids and their short aliases; callers may pass either form (combo members use aliases).
const CLINE_PROVIDERS = new Set(["cline", "cl"]);

/**
 * Cline free-tier daily cap 429: "Daily free limit reached on model <id>. Try again in 19h 39m".
 * Hours, minutes and seconds are each optional and may be glued ("19h39m"); a negative
 * lookahead instead of `\b` is what accepts the glued form. Every quantifier is bounded so
 * hostile bodies cannot trigger catastrophic backtracking.
 */
const CLINE_TRY_AGAIN_IN_RE =
  /\btry again in\s{1,3}(?:(\d{1,4})\s{0,2}h(?:ours?|rs?)?(?![a-z]))?\s{0,2}(?:(\d{1,4})\s{0,2}m(?:in(?:ute)?s?)?(?![a-z]))?\s{0,2}(?:(\d{1,6})\s{0,2}s(?:ec(?:ond)?s?)?(?![a-z]))?/i;

/**
 * Parse Cline's "Try again in XhYmZs" countdown, gated on the `cline` provider.
 * Returns null when the provider differs, the phrase is absent, or no usable duration
 * was given; otherwise the total in ms, capped at `maxMs`.
 *
 * @param {string} text - Upstream error text
 * @param {string|null|undefined} provider - Provider id or alias
 * @param {number} maxMs - Upper bound for the returned duration
 * @returns {number|null}
 */
export function parseClineTryAgainInMs(text, provider, maxMs) {
  if (!CLINE_PROVIDERS.has(String(provider ?? "").toLowerCase())) return null;
  const body = String(text ?? "");
  if (!body) return null;
  const match = CLINE_TRY_AGAIN_IN_RE.exec(body.slice(0, 4096));
  if (!match) return null;
  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0;
  const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null;
  return Math.min(totalMs, maxMs);
}
