/**
 * Compression engine catalog (JS port of omniroute/main engineCatalog.ts).
 *
 * Each entry gains an `available` flag: engines whose real implementation is shipped in
 * this tree are `available: true`; the rest are metadata-only placeholders so the catalog
 * still names them (unknown-engine validation + UI labels) but the resolver never imports
 * or dispatches to them. See ./index.js for the availability-aware registry.
 */

export const ENGINE_CATALOG = {
  "session-dedup": {
    id: "session-dedup",
    label: "Session Dedup",
    stackPriority: 3,
    isSingleMode: false,
    available: true,
    description: "Cross-turn block deduplication.",
  },
  ccr: {
    id: "ccr",
    label: "CCR (Retrieval)",
    stackPriority: 4,
    isSingleMode: false,
    available: false,
    description: "Content-addressed retrieval markers.",
  },
  lite: {
    id: "lite",
    label: "Lite",
    stackPriority: 5,
    isSingleMode: true,
    available: false,
    description: "Whitespace/format cleanup.",
  },
  rtk: {
    id: "rtk",
    label: "RTK",
    stackPriority: 10,
    levels: ["minimal", "standard", "aggressive"],
    isSingleMode: true,
    available: false,
    description: "Command-output filtering.",
  },
  headroom: {
    id: "headroom",
    label: "Headroom",
    stackPriority: 15,
    isSingleMode: false,
    available: true,
    description: "Tabular JSON compaction.",
  },
  relevance: {
    id: "relevance",
    label: "Relevance",
    stackPriority: 18,
    isSingleMode: true,
    available: false,
    description: "Extractive sentence scoring against the last user query.",
  },
  caveman: {
    id: "caveman",
    label: "Caveman",
    stackPriority: 20,
    levels: ["lite", "full", "ultra"],
    isSingleMode: true,
    available: true,
    description: "Rule-based prose compression.",
  },
  aggressive: {
    id: "aggressive",
    label: "Aggressive",
    stackPriority: 30,
    isSingleMode: true,
    available: false,
    description: "Summarize + age old turns.",
  },
  llmlingua: {
    id: "llmlingua",
    label: "LLMLingua (SLM)",
    stackPriority: 35,
    isSingleMode: false,
    available: false,
    description: "Semantic pruning (ONNX).",
  },
  ultra: {
    id: "ultra",
    label: "Ultra",
    stackPriority: 40,
    isSingleMode: true,
    available: false,
    description: "Heuristic token pruning (+ optional SLM).",
  },
};

export const ENGINE_IDS = Object.values(ENGINE_CATALOG)
  .sort((a, b) => a.stackPriority - b.stackPriority)
  .map((e) => e.id);

export function engineMeta(id) {
  return ENGINE_CATALOG[id];
}

/**
 * Whether the engine's real implementation is shipped and dispatchable in this tree.
 * Unknown ids return false (use getEngine(id) to throw the hard unknown-engine error).
 */
export function isEngineAvailable(id) {
  const meta = ENGINE_CATALOG[id];
  return !!meta && meta.available === true;
}
