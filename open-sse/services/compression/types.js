/**
 * Compression Pipeline Types — runtime constants + JSDoc shapes.
 *
 * JS port of omniroute/main open-sse/services/compression/types.ts. Type-only imports
 * (fidelityGate, riskGate, pipelineEngineBreaker, quantumLock, mcpAccessibility) are erased;
 * the mcpAccessibility re-exports are intentionally dropped here because that engine is
 * `unavailable` in this tree and must never be imported at module load.
 */

import { ENGINE_IDS } from "./engineCatalog.js";

export { ENGINE_IDS };

/**
 * @typedef {"off"|"lite"|"standard"|"aggressive"|"ultra"|"rtk"|"stacked"} CompressionMode
 * @typedef {"lite"|"full"|"ultra"} CavemanIntensity
 * @typedef {"minimal"|"standard"|"aggressive"} RtkIntensity
 * @typedef {"lite"|"caveman"|"aggressive"|"ultra"|"rtk"|"session-dedup"|"headroom"|"ccr"|"llmlingua"} CompressionEngineId
 */

export const DEFAULT_COMPRESSION_CONFIG = {
  enabled: false,
  defaultMode: "off",
  autoTriggerMode: "lite",
  autoTriggerTokens: 0,
  cacheMinutes: 5,
  preserveSystemPrompt: true,
  preserveSystemPromptMode: "always",
  mcpDescriptionCompressionEnabled: true,
  comboOverrides: {},
  compressionComboId: null,
  stackedPipeline: [
    { engine: "rtk", intensity: "standard" },
    { engine: "caveman", intensity: "full" },
  ],
  engines: Object.fromEntries(ENGINE_IDS.map((id) => [id, { enabled: false }])),
  activeComboId: null,
  ultraEngine: "heuristic",
  ultraSlmPrewarm: false,
};

export const DEFAULT_CAVEMAN_CONFIG = {
  enabled: false,
  compressRoles: ["user"],
  skipRules: [],
  minMessageLength: 50,
  // Protect code blocks, inline code, file paths, URLs, and error/stack lines
  // from caveman compression so signal-carrying content is never mangled.
  preservePatterns: [
    "```[\\s\\S]*?```",
    "`[^`\\n]+`",
    "\\b(https?://\\S+)",
    "(?:^|\\s)(\\.{0,2}/[\\w./\\-]+)",
    "^\\s*(Error|TypeError|RangeError|SyntaxError|ReferenceError):",
    "^\\s+at\\s",
  ],
  intensity: "lite",
};

export const DEFAULT_CAVEMAN_OUTPUT_MODE_CONFIG = {
  enabled: false,
  intensity: "lite",
  autoClarity: true,
};

export const DEFAULT_RTK_CONFIG = {
  enabled: false,
  intensity: "minimal",
  applyToToolResults: true,
  applyToCodeBlocks: false,
  applyToAssistantMessages: false,
  enabledFilters: [],
  disabledFilters: [],
  maxLinesPerResult: 120,
  maxCharsPerResult: 12000,
  deduplicateThreshold: 3,
  customFiltersEnabled: true,
  trustProjectFilters: false,
  rawOutputRetention: "never",
  rawOutputMaxBytes: 1_048_576,
  enableGrouping: false,
  groupingThreshold: 3,
  stripCodeComments: false,
  preserveDocstrings: true,
  enableRenderers: false,
};

export const DEFAULT_COMPRESSION_LANGUAGE_CONFIG = {
  enabled: false,
  defaultLanguage: "en",
  autoDetect: true,
  enabledPacks: ["en"],
};

export const DEFAULT_CONTEXT_EDITING_CONFIG = {
  enabled: false,
};

export const DEFAULT_AGGRESSIVE_CONFIG = {
  thresholds: { fullSummary: 5, moderate: 3, light: 2, verbatim: 2 },
  toolStrategies: {
    fileContent: true,
    grepSearch: true,
    shellOutput: true,
    json: true,
    errorMessage: true,
  },
  summarizerEnabled: true,
  maxTokensPerMessage: 2048,
  minSavingsThreshold: 0.05,
};

export const DEFAULT_ULTRA_CONFIG = {
  enabled: false,
  compressionRate: 0.5,
  minScoreThreshold: 0.3,
  slmFallbackToAggressive: true,
  maxTokensPerMessage: 0,
};
