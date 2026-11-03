/** Browser redirects stay virtual during source-backed admin review. The
 * original behavior is retained in incumbent stories. Review navigation records
 * the requested destination so auth success can be asserted without escaping
 * Storybook or starting an actual OAuth session.
 */
export function reviewAssign(destination) {
  if (document.documentElement.dataset.v5Review !== "true") return window.location.assign(destination);
  const value = String(destination);
  if (!value.startsWith("/") || value.startsWith("//")) throw new Error("Review redirect must be relative");
  window.dispatchEvent(new CustomEvent("v5-review-redirect", { detail: { destination: value } }));
  if (!value.startsWith("/api/")) globalThis.__STORYBOOK_NAV__.useRouter().push(value);
}
