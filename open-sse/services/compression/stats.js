import {
  DEFAULT_COMPRESSION_CONFIG,
  DEFAULT_CAVEMAN_CONFIG,
  DEFAULT_RTK_CONFIG,
  DEFAULT_COMPRESSION_LANGUAGE_CONFIG,
} from "./types.js";

const CHARS_PER_TOKEN = 4;

export function estimateCompressionTokens(text) {
  if (!text) return 0;
  const str = typeof text === "string" ? text : JSON.stringify(text);
  return Math.ceil(str.length / CHARS_PER_TOKEN);
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
