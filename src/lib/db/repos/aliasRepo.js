import { getAdapter } from "../driver.js";
import { stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";
import { DEFAULT_CAPABILITIES } from "open-sse/providers/capabilities.js";
import { isBoolean, isObject } from "@/shared/utils/typeChecks.js";

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

function pruneNull(obj) {
  const out = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value !== null) out[key] = value;
  }
  return out;
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
"kiro"]
);

const BOOLEAN_CAPS = [
"vision",
"pdf",
"audioInput",
"videoInput",
"imageOutput",
"audioOutput",
"search",
"reasoning",
"tools",
"thinkingCanDisable"];


const INTEGER_CAPS = ["contextWindow", "maxOutput"];

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isValidThinkingRange(value) {
  if (value === undefined) return true;
  if (value === null) return true;
  if (!isObject(value) || Array.isArray(value)) return false;
  const { min, max } = value;
  // min 0 is legal (Gemini dynamic thinking budget_tokens: 0)
  if (min !== undefined && min !== null && !(Number.isSafeInteger(min) && min >= 0)) return false;
  if (max !== undefined && max !== null && !isPositiveInteger(max)) return false;
  if (min !== undefined && min !== null && max !== undefined && max !== null && min > max) return false;
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
  if (!isObject(raw) || Array.isArray(raw)) {
    return { ok: false, error: "capabilities must be an object" };
  }
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(DEFAULT_CAPABILITIES, key)) {
      return { ok: false, error: `unknown capability key: ${key}` };
    }
  }
  for (const key of BOOLEAN_CAPS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!isBoolean(value)) {
      return { ok: false, error: `${key} must be a boolean` };
    }
    out[key] = value;
  }
  for (const key of INTEGER_CAPS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (!isPositiveInteger(value)) {
      return { ok: false, error: `${key} must be a positive integer` };
    }
    out[key] = value;
  }
  if (raw.thinkingFormat !== undefined) {
    if (raw.thinkingFormat === null) {
      out.thinkingFormat = null;
    } else if (!VALID_THINKING_FORMATS.has(raw.thinkingFormat)) {
      return { ok: false, error: "invalid thinkingFormat" };
    } else {
      out.thinkingFormat = raw.thinkingFormat;
    }
  }
  if (raw.thinkingRange !== undefined) {
    if (raw.thinkingRange === null) {
      out.thinkingRange = null;
    } else if (!isValidThinkingRange(raw.thinkingRange)) {
      return { ok: false, error: "thinkingRange must be { min, max } with non-negative min, positive max, min <= max" };
    } else {
      out.thinkingRange = { ...raw.thinkingRange };
    }
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
    const value = {
      providerAlias, id, type, name: name || id, capabilities: pruneNull(norm.caps)
    };
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(value)]);
    added = value;
  });
  return added;
}

/**
 * Update an existing custom model's metadata and capabilities. The providerAlias,
 * id, and type together form the immutable key; only name and capabilities can change.
 *
 * @returns {object|false} the persisted record on success, or false if not found
 */
export async function updateCustomModel({ providerAlias, id, type = "llm", name, capabilities }) {
  let caps = capabilities;
  // Only own keys matter; explicit null deletes an override; missing key leaves existing intact.
  if (capabilities !== null && capabilities !== undefined) {
    const capsInput = {};
    for (const key of Object.keys(capabilities)) {
      if (Object.hasOwn(capabilities, key)) {
        capsInput[key] = capabilities[key];
      }
    }
    caps = capsInput;
  }
  const norm = normalizeCustomCapabilities(caps);
  if (!norm.ok) {
    const err = new Error(norm.error);
    err.status = 400;
    throw err;
  }
  const k = customKey(providerAlias, id, type);
  // Atomic read-merge-write: concurrent PATCHes serialize inside one DB
  // transaction so neither request's capability merge is lost.
  const result = await customKv.update(k, (existing) => {
    if (!existing) return undefined; // missing row: no write
    const merged = { ...(existing.capabilities || {}) };
    for (const key of Object.keys(norm.caps)) {
      const val = norm.caps[key];
      if (val === null) {
        delete merged[key];
      } else if (Object.hasOwn(norm.caps, key)) {
        merged[key] = val;
      }
    }
    const value = { ...existing, capabilities: merged };
    if (name !== undefined) value.name = name || id;
    return value;
  });
  return result === undefined ? false : result;
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