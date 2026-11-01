/**
 * Validate and repair client tool parameter schemas before a target translator
 * forwards them (#1334). Shared by the Claude, Gemini, and Responses request
 * paths so one malformed schema fails the same way everywhere.
 */
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { isBoolean, isObject, isString } from "../../../src/shared/utils/typeChecks.js";

const NUMERIC_KEYWORDS = new Set([
"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
"minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"]
);
const SCHEMA_LIST_KEYWORDS = ["anyOf", "oneOf", "allOf", "prefixItems"];
const SCHEMA_MAP_KEYWORDS = ["$defs", "definitions"];

const isPlainObject = (value) => value !== null && isObject(value) && !Array.isArray(value);
const isSubschema = (value) => isPlainObject(value) || isBoolean(value);

/** HTTP 400 naming the tool; never echoes upstream content. */
export function invalidToolSchemaError(toolName, reason) {
  const error = new Error(`Invalid tool schema for "${toolName || "(unnamed)"}": ${reason}`);
  error.statusCode = HTTP_STATUS.BAD_REQUEST;
  return error;
}

function numericValue(value) {
  if (!isString(value) || value.trim() === "") return value;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function normalizeNode(node, toolName, path) {
  if (!isPlainObject(node)) return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = NUMERIC_KEYWORDS.has(key) ? numericValue(value) : value;
  }

  // `properties: null` stays "missing" (#1350 treats it as an empty map).
  if (out.properties !== undefined && out.properties !== null) {
    if (!isPlainObject(out.properties)) throw invalidToolSchemaError(toolName, `${path}.properties must be an object`);
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([name, child]) => {
      if (!isSubschema(child)) throw invalidToolSchemaError(toolName, `${path}.properties.${name} must be a schema object`);
      return [name, normalizeNode(child, toolName, `${path}.properties.${name}`)];
    }));
  }
  if (out.required !== undefined && !(Array.isArray(out.required) && out.required.every(isString))) {
    throw invalidToolSchemaError(toolName, `${path}.required must be an array of strings`);
  }
  if (out.items !== undefined) {
    out.items = Array.isArray(out.items) ?
    out.items.map((child, i) => normalizeNode(child, toolName, `${path}.items[${i}]`)) :
    normalizeNode(out.items, toolName, `${path}.items`);
  }
  if (isPlainObject(out.additionalProperties)) {
    out.additionalProperties = normalizeNode(out.additionalProperties, toolName, `${path}.additionalProperties`);
  }
  for (const key of SCHEMA_LIST_KEYWORDS) {
    if (Array.isArray(out[key])) out[key] = out[key].map((child, i) => normalizeNode(child, toolName, `${path}.${key}[${i}]`));
  }
  for (const key of SCHEMA_MAP_KEYWORDS) {
    if (isPlainObject(out[key])) {
      out[key] = Object.fromEntries(Object.entries(out[key]).map(([name, child]) =>
      [name, normalizeNode(child, toolName, `${path}.${key}.${name}`)]));
    }
  }
  return out;
}

/**
 * Return a copy of `schema` with numeric-string constraints (`"1"`) coerced to
 * numbers, or throw HTTP 400 when `properties` / `required` are structurally
 * malformed. Non-object inputs are returned unchanged for the caller's own
 * defaulting. Never mutates the caller's object.
 *
 * @param {unknown} schema
 * @param {string} [toolName]
 * @returns {unknown}
 */
export function normalizeToolSchema(schema, toolName) {
  return normalizeNode(schema, toolName, "parameters");
}
