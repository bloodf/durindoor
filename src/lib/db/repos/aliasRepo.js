import { getAdapter } from "../driver.js";
import { stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";
import { DEFAULT_CAPABILITIES } from "open-sse/providers/capabilities.js";

const aliasKv = makeKv("modelAliases");
const customKv = makeKv("customModels");
const mitmKv = makeKv("mitmAlias");

// modelAliases: key=alias, value=modelString
export async function getModelAliases() {
  return await aliasKv.getAll();
}

export async function setModelAlias(alias, model) {
  await aliasKv.set(alias, model);
}

export async function deleteModelAlias(alias) {
  await aliasKv.remove(alias);
}

// customModels: key=`${providerAlias}|${id}|${type}`, value=full model object
function customKey(providerAlias, id, type) {
  return `${providerAlias}|${id}|${type}`;
}

export async function getCustomModels() {
  const all = await customKv.getAll();
  return Object.values(all);
}

// Valid thinkingFormat values from capabilities.js schema.
const VALID_THINKING_FORMATS = new Set([
  "openai",
  "claude-adaptive",
  "claude-budget",
  "gemini-level",
  "gemini-budget",
  "zai",
  "qwen",
  "deepseek",
  "kimi",
  "minimax",
  "hunyuan",
  "step",
  "kiro",
  null,
]);

const BOOLEAN_CAPS = [
  "vision",
  "pdf",
  "audioInput",
  "videoInput",
  "imageOutput",
  "audioOutput",
  "search",
  "tools",
  "reasoning",
  "thinkingCanDisable",
];

const INTEGER_CAPS = ["contextWindow", "maxOutput"];

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isValidThinkingRange(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const { min, max } = value;
  if (min !== undefined && !isPositiveInteger(min)) return false;
  if (max !== undefined && !isPositiveInteger(max)) return false;
  if (min !== undefined && max !== undefined && min > max) return false;
  return true;
}

/**
 * Normalize a user-provided capability object to the canonical schema.
 * Rejects unknown keys, wrong types, and malformed values.
 *
 * @param {object|null} raw
 * @returns {{ ok: true, caps: object } | { ok: false, error: string }}
 */
export function normalizeCustomCapabilities(raw) {
  if (raw === null || raw === undefined) {
    return { ok: true, caps: {} };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "capabilities must be an object" };
  }
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!(key in DEFAULT_CAPABILITIES)) {
      return { ok: false, error: `unknown capability key: ${key}` };
    }
  }
  for (const key of BOOLEAN_CAPS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      return { ok: false, error: `${key} must be a boolean` };
    }
    out[key] = value;
  }
  for (const key of INTEGER_CAPS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!isPositiveInteger(value)) {
      return { ok: false, error: `${key} must be a positive integer` };
    }
    out[key] = value;
  }
  if (raw.thinkingFormat !== undefined) {
    if (!VALID_THINKING_FORMATS.has(raw.thinkingFormat)) {
      return { ok: false, error: "invalid thinkingFormat" };
    }
    out.thinkingFormat = raw.thinkingFormat;
  }
  if (raw.thinkingRange !== undefined) {
    if (!isValidThinkingRange(raw.thinkingRange)) {
      return { ok: false, error: "thinkingRange must be { min, max } with positive integers and min <= max" };
    }
    out.thinkingRange = raw.thinkingRange === null ? null : { ...raw.thinkingRange };
  }
  return { ok: true, caps: out };
}

// Atomic check-then-insert inside transaction to prevent duplicate races
export async function addCustomModel({ providerAlias, id, type = "llm", name, capabilities }) {
  const norm = normalizeCustomCapabilities(capabilities);
  if (!norm.ok) {
    const err = new Error(norm.error);
    err.status = 400;
    throw err;
  }
  const k = customKey(providerAlias, id, type);
  const db = await getAdapter();
  let added = false;
  db.transaction(() => {
    const row = db.get(`SELECT 1 FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
    if (row) return;
    const value = stringifyJson({ providerAlias, id, type, name: name || id, capabilities: norm.caps });
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, value]);
    added = true;
  });
  return added;
}

/**
 * Update an existing custom model's metadata and capabilities. The providerAlias,
 * id, and type together form the immutable key; only name and capabilities can change.
 *
 * @returns {boolean} true if the row existed and was updated
 */
export async function updateCustomModel({ providerAlias, id, type = "llm", name, capabilities }) {
  const norm = normalizeCustomCapabilities(capabilities);
  if (!norm.ok) {
    const err = new Error(norm.error);
    err.status = 400;
    throw err;
  }
  const k = customKey(providerAlias, id, type);
  const existing = await customKv.get(k);
  if (!existing) return false;
  const value = {
    ...existing,
    name: name !== undefined ? (name || id) : existing.name,
    capabilities: capabilities === undefined ? (existing.capabilities || {}) : norm.caps,
  };
  await customKv.set(k, value);
  return true;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }) {
  await customKv.remove(customKey(providerAlias, id, type));
}

// mitmAlias: key=toolName, value=mappings object
export async function getMitmAlias(toolName) {
  if (toolName) {
    const v = await mitmKv.get(toolName);
    return v || {};
  }
  return await mitmKv.getAll();
}

export async function setMitmAliasAll(toolName, mappings) {
  await mitmKv.set(toolName, mappings || {});
}
