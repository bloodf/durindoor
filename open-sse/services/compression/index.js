// open-sse/services/compression/index.js
//
// F-1a compression registry.
//
// Ships ONLY the engines whose real implementation is present in this tree:
//   - session-dedup  (engines/session-dedup/index.js)
//   - headroom       (engines/headroomAdapter.js -> rtk/headroom.js)
//   - caveman        (engines/cavemanAdapter.js -> caveman.js)
//
// All other catalog ids (ccr, lite, rtk, relevance, aggressive, llmlingua,
// ultra) are metadata-only placeholders in engineCatalog.js and are NEVER
// imported here. getEngine(id) on any of them throws "Unknown compression
// engine: <id>" so callers cannot accidentally dispatch to a stub.
//
// Engine.apply is normalized to a Promise so F1e/F1f can compose a uniform
// async pipeline regardless of whether an engine's native apply is sync
// (session-dedup, caveman) or async (headroom).

import { sessionDedupEngine } from "./engines/session-dedup/index.js";
import { cavemanEngine } from "./engines/cavemanAdapter.js";
import { headroomEngine } from "./engines/headroomAdapter.js";
import { ENGINE_IDS, engineMeta, isEngineAvailable } from "./engineCatalog.js";

const BUILTIN_ENGINES = new Map();

let registered = false;

function wrapApply(engine) {
  const native = engine.apply.bind(engine);
  return async (body, options) => native(body, options);
}

function register(engine) {
  const wrapped = {
    ...engine,
    apply: wrapApply(engine),
    compress: engine.compress
      ? async (body, config) => engine.compress(body, config)
      : undefined,
  };
  BUILTIN_ENGINES.set(engine.id, wrapped);
}

/**
 * Register the engines that are actually implemented in this tree. Synchronous
 * and idempotent. headroomEngine resolves its heavy translator dependency
 * lazily inside apply(), so registering it here does not pull the app alias
 * graph at module load. The catalog's availability flags therefore stay true:
 * getEngine(id) always returns a real engine for the three shipped ids.
 */
export function registerBuiltinEngines() {
  if (registered) return;
  register(sessionDedupEngine);
  register(headroomEngine);
  register(cavemanEngine);
  registered = true;
}

// Back-compat alias matching omniroute's registerBuiltinCompressionEngines name.
export const registerBuiltinCompressionEngines = registerBuiltinEngines;

/**
 * Resolve an engine by id. Throws on unknown OR unavailable ids so the caller
 * can never dispatch to a metadata-only placeholder.
 */
export function getEngine(id) {
  registerBuiltinEngines();
  const engine = BUILTIN_ENGINES.get(id);
  if (!engine) {
    throw new Error(`Unknown compression engine: ${id}`);
  }
  return engine;
}

// Back-compat alias (omniroute's session-dedup.test.ts uses getCompressionEngine).
export const getCompressionEngine = getEngine;

export { ENGINE_IDS, engineMeta, isEngineAvailable };
