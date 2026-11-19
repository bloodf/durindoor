/**
 * Bound Next.js build workers by CPU affinity and an optional CircleCI budget,
 * leaving at least one CPU available to the rest of the process.
 *
 * @param {number} affinityCpus
 * @param {string | undefined} ciBudget
 * @returns {number}
 */
export function getNextBuildCpus(affinityCpus, ciBudget = process.env.CIRCLE_NODE_TOTAL) {
  return Math.max(1, Math.min(affinityCpus, Number(ciBudget) || Infinity) - 1);
}
