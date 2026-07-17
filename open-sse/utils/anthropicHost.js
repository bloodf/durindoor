/**
 * Whether a configured Anthropic `baseUrl` targets the official
 * `api.anthropic.com` host.
 *
 * Uses exact hostname equality (parsed via `new URL`) instead of a substring
 * `.includes("api.anthropic.com")`, so a look-alike upstream such as
 * `https://api.anthropic.com.evil.test` or `https://evil.test/?x=api.anthropic.com`
 * is correctly treated as third-party
 * (CodeQL `js/incomplete-url-substring-sanitization`).
 *
 * NOTE: an empty or unparseable baseUrl (including a scheme-less host such as
 * `api.anthropic.com/v1`) returns `false` here; the "empty means the default
 * official endpoint" convention is applied by the caller
 * (open-sse/executors/default.js), which treats an empty baseUrl as official
 * before invoking this helper.
 *
 * Ported from OmniRoute b3207ab010 (TS) — reimplemented in idiomatic JS.
 *
 * @param {string} baseUrl
 * @returns {boolean}
 */
export function isOfficialAnthropicBaseUrl(baseUrl) {
  try {
    return new URL(baseUrl).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
}
