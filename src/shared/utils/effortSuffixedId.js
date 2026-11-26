/**
 * Effort-suffixed catalog aliases (OmniRoute #19981).
 *
 * A row such as `cx/gpt-5.4-high` that sits next to its listed base id has its
 * effort fixed by the id, so discovery must not offer a reasoning-level ladder
 * on it.
 */
const EFFORT_SUFFIX = /-(?:none|minimal|low|medium|high|xhigh|max)$/;
// Only the Codex executor reads `-ultra`; elsewhere it names a model (nemotron-3-ultra).
const CODEX_EFFORT_SUFFIX = /-(?:none|minimal|low|medium|high|xhigh|max|ultra)$/;
const CODEX_PREFIX = /^(?:codex|cx|cxa)\//;

/**
 * @param {string} id - catalog id, normally `alias/model`
 * @param {{has: (id: string) => boolean}} listedIds - ids the base may be among
 * @returns {boolean}
 */
export function isEffortSuffixedVariantOfListedId(id, listedIds) {
  const codex = CODEX_PREFIX.test(id);
  // `*-codex-max` is its own OpenAI model, except where the Codex executor strips `-max`.
  if (!codex && id.endsWith("-codex-max")) return false;
  const suffix = id.match(codex ? CODEX_EFFORT_SUFFIX : EFFORT_SUFFIX)?.[0];
  return Boolean(suffix) && listedIds.has(id.slice(0, -suffix.length));
}
