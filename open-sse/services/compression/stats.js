import {
  DEFAULT_COMPRESSION_CONFIG,
  DEFAULT_CAVEMAN_CONFIG,
  DEFAULT_RTK_CONFIG,
  DEFAULT_COMPRESSION_LANGUAGE_CONFIG,
} from "./types.js";

const CHARS_PER_TOKEN = 4;
const BASE64_IMAGE_DATA_URI_PREFIX = "data:image/";

function isBase64Char(charCode) {
  return (
    (charCode >= 48 && charCode <= 57) ||
    (charCode >= 65 && charCode <= 90) ||
    (charCode >= 97 && charCode <= 122) ||
    charCode === 43 ||
    charCode === 47 ||
    charCode === 61
  );
}

// Base64 image data URIs are payload, not text — counting them inflates the
// estimate and (for huge attachments) makes it expensive. Strips them in one
// linear forward pass (no regex backtracking, no intermediate string copies).
// Text without a "data:image/" marker takes the O(1) length fast path.
function countTextChars(text) {
  const firstUri = text.indexOf(BASE64_IMAGE_DATA_URI_PREFIX);
  if (firstUri === -1) return text.length;

  let textChars = 0;
  let cursor = 0;
  let uriStart = firstUri;
  while (uriStart !== -1) {
    textChars += uriStart - cursor;
    const payloadStart = text.indexOf(";base64,", uriStart + BASE64_IMAGE_DATA_URI_PREFIX.length);
    if (payloadStart === -1) return textChars + (text.length - uriStart);

    let payloadEnd = payloadStart + 8;
    while (payloadEnd < text.length && isBase64Char(text.charCodeAt(payloadEnd))) payloadEnd++;
    if (payloadEnd === payloadStart + 8) return textChars + (text.length - uriStart);

    cursor = payloadEnd;
    uriStart = text.indexOf(BASE64_IMAGE_DATA_URI_PREFIX, cursor);
  }
  return textChars + (text.length - cursor);
}

export function estimateCompressionTokens(text) {
  if (!text) return 0;
  const str = typeof text === "string" ? text : JSON.stringify(text);
  if (!str) return 0;
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
