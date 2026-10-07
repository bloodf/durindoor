/** Scroll opens the gate within the first 320px; an explicit toggle overrides scroll. */
export function gateOpening(progress, opened) {
  if (opened !== null) return opened ? 1 : 0;
  return Math.min(1, Math.max(0, progress * 3));
}
