/**
 * Shared JSONC tolerance for CLI tool configs.
 *
 * Several settings routes used to inline `content.replace(/,(\s*[}\]])/g, "$1")` before
 * `JSON.parse`. This is the one copy: it removes the same trailing commas, but skips string
 * literals so a value such as `"a,}"` is never rewritten.
 */

/**
 * Remove commas that directly precede a closing `}` or `]` (whitespace allowed between).
 * @param {string} content
 * @returns {string}
 */
export function stripJsoncTrailingCommas(content) {
  const text = String(content ?? "");
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 1;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Parse JSON that may carry trailing commas. Throws like `JSON.parse` on anything else.
 * @param {string} content
 * @returns {unknown}
 */
export function parseJsonc(content) {
  return JSON.parse(stripJsoncTrailingCommas(content));
}
