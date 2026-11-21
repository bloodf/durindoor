import { isString } from "../../../src/shared/utils/typeChecks.js";














const SENTINEL_PREFIX = "\u0000OMNI_CAVEMAN";
const HUNK_HEADER_RE = /^@@ -\d{1,9}(?:,\d{1,9})? \+\d{1,9}(?:,\d{1,9})? @@/;
const DIFF_FILE_HEADER_RE = /^(?:diff --git |index |new file mode |deleted file mode |similarity index |rename from |rename to |--- |\+\+\+ )/;
const HUNK_COUNTS_RE = /^@@ -\d{1,9}(?:,(\d{1,9}))? \+\d{1,9}(?:,(\d{1,9}))? @@/;

function randomSentinelSeed() {
  const bytes = new Uint8Array(8);
  const cryptoLike = globalThis.crypto;
  if (cryptoLike?.getRandomValues) {
    cryptoLike.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2);
}

function ensureGlobal(pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function compileUserPatterns(patterns) {
  if (!patterns?.length) return [];
  const compiled = [];
  for (const pattern of patterns) {
    try {
      compiled.push({
        pattern: isString(pattern) ? new RegExp(pattern, "g") : ensureGlobal(pattern),
        kind: "custom"
      });
    } catch {

      // Invalid user regexes are ignored by the hot path. Validation/preview exposes warnings.
    }}
  return compiled;
}

function replacePattern(
text,
pattern,
kind,
addBlock)
{
  pattern.lastIndex = 0;
  const placeholders = [];
  const placeholderPattern = /\u0000OMNI_CAVEMAN_[A-Za-z0-9]+_\d+\u0000/g;
  for (const match of text.matchAll(placeholderPattern)) {
    placeholders.push([match.index, match.index + match[0].length]);
  }
  return text.replace(pattern, (match, ...args) => {
    if (!match) return match;
    const offset = args.find((arg) => Number.isInteger(arg) && arg >= 0);
    if (match.includes(SENTINEL_PREFIX) || placeholders.some(([start, end]) => offset < end && offset + match.length > start)) return match;
    return addBlock(match, kind);
  });
}

export function findFencedCodeBlocks(text) {
  const blocks = [];
  extractFencedCodeBlocks(text, (content) => {
    blocks.push(content);
    return content;
  });
  return blocks;
}

export function extractPreservedBlocks(
text,
options = {})
{
  const blocks = [];
  const seed = randomSentinelSeed();
  let counter = 0;

  const addBlock = (content, kind) => {
    const placeholder = `${SENTINEL_PREFIX}_${seed}_${counter}\u0000`;
    blocks.push({ placeholder, content, kind });
    counter++;
    return placeholder;
  };

  let result = text;

  result = extractFrontmatter(result, addBlock);
  result = extractFencedCodeBlocks(result, (content) => addBlock(content, "fenced_code"));
  result = extractUnifiedDiffs(result, (content) => addBlock(content, "diff_block"));

  const builtIns = [
  { pattern: /\$\$[\s\S]*?\$\$/g, kind: "math_block" },
  { pattern: /\\\[[\s\S]*?\\\]/g, kind: "math_block" },
  // #4795: exclude `\` from the catch-all branch so a backslash is only ever
  // consumed by the escape branch `\\.`. The previous `[^$\n]` overlapped with
  // `\\.`, making a run of consecutive backslashes (e.g. unmatched `$` + a
  // Windows path) exponentially ambiguous → catastrophic backtracking (ReDoS).
  {
    pattern: /(?<!\$)\$(?![\s$\d])(?:\\.|[^$\n\\]){1,160}?(?<!\s)\$(?!\$)/g,
    kind: "math_inline"
  },
  { pattern: /\\begin\{[A-Za-z*]+\}[\s\S]*?\\end\{[A-Za-z*]+\}/g, kind: "latex_block" },
  { pattern: /^#{1,6}\s+.+$/gm, kind: "markdown_heading" },
  { pattern: /^\s*\|.*\|\s*$/gm, kind: "markdown_table" },
  { pattern: /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, kind: "markdown_table" },
  { pattern: /^\s*#(?:set|show|let|import|include)\b.+$/gm, kind: "typst_directive" },
  { pattern: /`[^`\n]+`/g, kind: "inline_code" },
  { pattern: /\[[^\]\n]+\]\([^) \n]+(?:\s+"[^"]*")?\)/g, kind: "markdown_link" },
  { pattern: /\bhttps?:\/\/[^\s)\]"'>]+/gi, kind: "url" },
  { pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, kind: "const_case" },
  { pattern: /\bprocess\.env\.[A-Za-z_][A-Za-z0-9_]*\b/g, kind: "env_var" },
  { pattern: /\$[A-Z_][A-Z0-9_]*\b/g, kind: "env_var" },
  { pattern: /\b\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?\b/g, kind: "version" },
  { pattern: /\b[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+\(\)?/g, kind: "dotted_identifier" },
  { pattern: /\b[A-Za-z_$][\w$]*\s*\([^()\n]*\)/g, kind: "function_call" },
  {
    pattern: /(?:^|\s)(?:\.{0,2}\/[A-Za-z0-9_@./-]+|[A-Za-z]:\\[A-Za-z0-9_.\\/-]+)/g,
    kind: "file_path"
  },
  {
    pattern:
    /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|Error|Exception):[^\n]+/g,
    kind: "error_message"
  }];


  for (const { pattern, kind } of [...builtIns, ...compileUserPatterns(options.preservePatterns)]) {
    result = replacePattern(result, ensureGlobal(pattern), kind, addBlock);
  }

  return { text: result, blocks };
}

/**
 * Wrap explicit literal spans (by offset) into SENTINEL placeholders, reusing
 * the exact placeholder family that every engine already treats as opaque.
 * Spans must be non-overlapping and pre-sorted ascending. Restored via
 * `restorePreservedBlocks`.
 */
export function preserveSpans(
text,
spans)
{
  if (!spans.length) return { text, blocks: [] };
  const seed = randomSentinelSeed();
  const blocks = [];
  let result = "";
  let cursor = 0;
  let counter = 0;
  for (const span of spans) {
    if (span.start < cursor || span.end > text.length || span.start >= span.end) continue;
    const placeholder = `${SENTINEL_PREFIX}_${seed}_${counter}\u0000`;
    blocks.push({ placeholder, content: text.slice(span.start, span.end), kind: span.kind });
    result += text.slice(cursor, span.start) + placeholder;
    cursor = span.end;
    counter++;
  }
  result += text.slice(cursor);
  return { text: result, blocks };
}

function extractFrontmatter(
text,
addBlock)
{
  if (!text.startsWith("---\n")) return text;
  const close = text.indexOf("\n---", 4);
  if (close === -1) return text;
  const closeEnd = text.indexOf("\n", close + 4);
  const end = closeEnd === -1 ? text.length : closeEnd + 1;
  return `${addBlock(text.slice(0, end), "frontmatter")}${text.slice(end)}`;
}

function extractFencedCodeBlocks(text, addBlock) {
  const lines = text.match(/[^\n]*(?:\n|$)/g) ?? [text];
  let output = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === "" && i === lines.length - 1) break;
    const opening = line.match(/^([ \t]{0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)/);
    if (!opening) {
      output += line;
      i++;
      continue;
    }

    const fence = opening[2];
    const fenceChar = fence[0];
    const minLen = fence.length;
    let block = line;
    let j = i + 1;
    let closed = false;

    while (j < lines.length) {
      const candidate = lines[j];
      block += candidate;
      const closeMatch = candidate.match(/^([ \t]{0,3})(`{3,}|~{3,})\s*(?:\n|$)/);
      if (closeMatch && closeMatch[2][0] === fenceChar && closeMatch[2].length >= minLen) {
        closed = true;
        break;
      }
      j++;
    }

    if (!closed) {
      output += line;
      i++;
      continue;
    }

    output += addBlock(block);
    i = j + 1;
  }

  return output;
}

/**
 * Unfenced unified diffs (#1468): every `@@ -a,b +c,d @@` hunk plus the file
 * header lines directly above it and the +/-/context/"\\ No newline" lines
 * (and further hunks) below it. Single linear pass over lines.
 */
function extractUnifiedDiffs(text, addBlock) {
  if (!text.includes("@@ -")) return text;
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!HUNK_HEADER_RE.test(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }
    let startInOut = out.length;
    while (startInOut > 0 && DIFF_FILE_HEADER_RE.test(out[startInOut - 1])) startInOut--;
    const block = out.splice(startInOut);
    // Consume hunks by their header counts, so a blank context line stays
    // inside the hunk and prose after the hunk is never swallowed.
    while (i < lines.length && HUNK_HEADER_RE.test(lines[i])) {
      const [, oldCount = "1", newCount = "1"] = HUNK_COUNTS_RE.exec(lines[i]) ?? [];
      let oldLeft = Number(oldCount);
      let newLeft = Number(newCount);
      block.push(lines[i]);
      i++;
      while (i < lines.length && (oldLeft > 0 || newLeft > 0)) {
        const line = lines[i];
        if (line === "" || line.startsWith(" ")) { oldLeft--; newLeft--; }
        else if (line.startsWith("-")) oldLeft--;
        else if (line.startsWith("+")) newLeft--;
        else if (!line.startsWith("\\")) break; // malformed: stop at the first non-hunk line
        block.push(line);
        i++;
      }
      if (i < lines.length && lines[i].startsWith("\\")) block.push(lines[i++]); // "\ No newline at end of file"
    }
    out.push(addBlock(block.join("\n")));
  }
  return out.join("\n");
}

export function restorePreservedBlocks(text, blocks) {
  let result = text;
  for (const block of blocks) {
    result = result.split(block.placeholder).join(block.content);
  }
  return result;
}

export function shouldPreserve(text, preservePatterns) {
  return preservePatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
