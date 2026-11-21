/**
 * Canonical Context7 library-id grammar.
 *
 * Shared by the fetch executor (open-sse/handlers/fetch/index.js) and the
 * search normalizer (open-sse/handlers/search/normalizers.js) so the two
 * faces of the provider cannot drift apart: a library reference the fetch
 * path accepts is exactly the reference the search path is willing to
 * publish.
 *
 * A library id is exactly two path segments — "/owner/repo" — where a
 * segment starts with an alphanumeric character and may otherwise contain
 * word characters, hyphens and single interior dots ("reactjs/react.dev",
 * "vercel/next.js"). Dot-only and dot-run segments ("..", "a..b") and
 * trailing dots are rejected, so no segment can traverse or escape its path
 * position.
 */
import { isString } from "../../src/shared/utils/typeChecks.js";

// One path-safe segment: alphanumeric start, then word characters, hyphens
// and single interior dots.
const CONTEXT7_LIBRARY_SEGMENT_RE = /^[A-Za-z0-9][\w-]*(?:\.[\w-]+)*$/;

// Hosted reference forms: the Context7 host, optionally with a scheme and
// an optional "www.". Any other host is not a Context7 library reference.
const CONTEXT7_HOST_RE = /^(?:https?:\/\/)?(?:www\.)?context7\.com(\/.*)?$/i;

/**
 * @param {unknown} id Canonical "/owner/repo" library id.
 * @returns {boolean} True when the id is a valid Context7 library id.
 */
export function isValidContext7LibraryId(id) {
  if (!isString(id) || !id.startsWith("/")) return false;
  const separator = id.indexOf("/", 1);
  if (separator === -1) return false;
  return (
    CONTEXT7_LIBRARY_SEGMENT_RE.test(id.slice(1, separator)) &&
    CONTEXT7_LIBRARY_SEGMENT_RE.test(id.slice(separator + 1))
  );
}

/**
 * Parse a user-supplied Context7 reference into its canonical library id.
 *
 * Accepted inputs: "https://context7.com/owner/repo", "http://context7.com/owner/repo",
 * "www.context7.com/owner/repo", "context7.com/owner/repo", "/owner/repo",
 * "owner/repo", and the same forms with one optional trailing slash. Any
 * other host or scheme is rejected.
 *
 * @param {unknown} input
 * @returns {string|null} Canonical "/owner/repo" id, or null when invalid.
 */
export function parseContext7LibraryId(input) {
  if (!isString(input)) return null;
  let path = input.trim();
  const hostMatch = CONTEXT7_HOST_RE.exec(path);
  if (hostMatch) path = hostMatch[1] || "";
  else if (/^https?:\/\//i.test(path)) return null;
  if (!path.startsWith("/")) path = `/${path}`;
  // One optional trailing slash is tolerated; a canonical id never carries it.
  if (path.endsWith("/")) path = path.slice(0, -1);
  const segments = path.slice(1).split("/");
  if (segments.length !== 2) return null;
  const id = `/${segments[0]}/${segments[1]}`;
  return isValidContext7LibraryId(id) ? id : null;
}
