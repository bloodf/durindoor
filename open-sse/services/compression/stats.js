import {
  DEFAULT_COMPRESSION_CONFIG,
  DEFAULT_CAVEMAN_CONFIG,
  DEFAULT_RTK_CONFIG,
  DEFAULT_COMPRESSION_LANGUAGE_CONFIG,
} from "./types.js";

const CHARS_PER_TOKEN = 4;
const BASE64_IMAGE_DATA_URI_PREFIX = "data:image/";
// Above this length, skip the base64-stripping scan and use the raw
// length/4 heuristic. Mirrors upstream tiktokenCounter.ts's
// MAX_EXACT_TOKEN_COUNT_CHARS: bounds scan cost regardless of input size
// (hostile multi-MB base64 payloads must not drive linear scan work).
const MAX_EXACT_TOKEN_COUNT_CHARS = 50_000;

function matchesAsciiInsensitive(text, start, literal) {
  if (start + literal.length > text.length) return false;
  for (let index = 0; index < literal.length; index++) {
    if (text[start + index].toLowerCase() !== literal[index]) return false;
  }
  return true;
}

function isImageSubtypeChar(char) {
  return /[A-Za-z0-9.+-]/.test(char);
}

function isBase64Char(char) {
  return /[A-Za-z0-9+/=]/.test(char);
}

// Base64 image data URIs are payload, not text. Scan only the bounded input
// window and validate the full contiguous syntax before stripping: a malformed
// `data:image/` must never bind to a later unrelated `;base64,` delimiter.
function countTextChars(text) {
  let textChars = 0;
  let cursor = 0;

  while (cursor < text.length) {
    if (!matchesAsciiInsensitive(text, cursor, BASE64_IMAGE_DATA_URI_PREFIX)) {
      textChars++;
      cursor++;
      continue;
    }

    let subtypeEnd = cursor + BASE64_IMAGE_DATA_URI_PREFIX.length;
    while (subtypeEnd < text.length && isImageSubtypeChar(text[subtypeEnd])) subtypeEnd++;
    if (
      subtypeEnd === cursor + BASE64_IMAGE_DATA_URI_PREFIX.length ||
      !matchesAsciiInsensitive(text, subtypeEnd, ";base64,")
    ) {
      textChars++;
      cursor++;
      continue;
    }

    let payloadEnd = subtypeEnd + ";base64,".length;
    while (payloadEnd < text.length && isBase64Char(text[payloadEnd])) payloadEnd++;
    if (payloadEnd === subtypeEnd + ";base64,".length) {
      textChars++;
      cursor++;
      continue;
    }

    cursor = payloadEnd;
  }

  return textChars;
}

export function estimateCompressionTokens(text) {
  if (!text) return 0;
  const str = typeof text === "string" ? text : JSON.stringify(text);
  if (!str) return 0;
  if (str.length > MAX_EXACT_TOKEN_COUNT_CHARS) {
    return Math.ceil(str.length / 4);
  }
  return Math.ceil(countTextChars(str) / CHARS_PER_TOKEN);
}

export function createCompressionStats(
  originalBody,
  compressedBody,
  mode,
  techniquesUsed,
  rulesApplied,
  durationMs,
) {
  const originalTokens = estimateCompressionTokens(originalBody);
  const compressedTokens = estimateCompressionTokens(compressedBody);
  const savingsPercent =
    originalTokens > 0
      ? Math.round(((originalTokens - compressedTokens) / originalTokens) * 10000) / 100
      : 0;
  return {
    originalTokens,
    compressedTokens,
    savingsPercent,
    techniquesUsed,
    mode,
    timestamp: Date.now(),
    ...(rulesApplied && rulesApplied.length > 0 ? { rulesApplied } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

export function trackCompressionStats(stats) {
  if (stats.originalTokens <= 0) return;
  // Compression stats tracking — no-op in production (use structured logging if needed)
}

export function getDefaultCompressionConfig() {
  return {
    ...DEFAULT_COMPRESSION_CONFIG,
    cavemanConfig: { ...DEFAULT_CAVEMAN_CONFIG },
    rtkConfig: { ...DEFAULT_RTK_CONFIG },
    languageConfig: { ...DEFAULT_COMPRESSION_LANGUAGE_CONFIG },
  };
}
