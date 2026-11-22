/**
 * The Cursor IDE provider (`cursor`, alias `cu`) and its API-key connection (`cursor-api`,
 * alias `cua`) share one request path, so they share its transport limits and the
 * pre-translation handling (image validation, RTK before the tool-result rewrite).
 */
export function isCursorProvider(provider) {
  return provider === "cursor" || provider === "cu" || provider === "cursor-api" || provider === "cua";
}
