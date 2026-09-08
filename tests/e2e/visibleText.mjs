/**
 * Whether an expected string is visibly present.
 *
 * A substring can legitimately match several nodes - "Settings" is both a
 * sidebar link and a page heading - so asserting the *first* match makes the
 * result depend on DOM order and fails pages whose heading is present and
 * visible. The contract is that at least one match is visible, so this takes
 * the state of every candidate and reports whether any of them is rendered.
 *
 * @param {{ rects: number, visibility: string, display: string }[]} states
 * @returns {boolean}
 */
export function anyVisible(states) {
  if (!Array.isArray(states)) return false;
  return states.some((state) => Number(state?.rects) > 0 && state?.visibility !== "hidden" && state?.display !== "none");
}
