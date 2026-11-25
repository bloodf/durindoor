/**
 * Validate and repair client tool parameter schemas before a target translator
 * forwards them (#1334). Shared by the Claude, Gemini, and Responses request
 * paths so one malformed schema fails the same way everywhere.
 *
 * {@link sanitizeToolSchemaParameters} adds the invalid-construct repair the
 * Responses → Chat path needs (OmniRoute #18806): a schema a client truncated
 * is repaired instead of rejected, while a valid schema is forwarded as
 * declared.
 */
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { isBoolean, isObject, isString } from "../../../src/shared/utils/typeChecks.js";

const NUMERIC_KEYWORDS = new Set([
"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
"minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"]
);
const SCHEMA_LIST_KEYWORDS = ["anyOf", "oneOf", "allOf", "prefixItems"];
const SCHEMA_MAP_KEYWORDS = ["$defs", "definitions"];

/** Keywords whose value must be an array of values or subschemas. */
const SCHEMA_ARRAY_KEYWORDS = ["enum", "required", ...SCHEMA_LIST_KEYWORDS];

/** Keywords whose value is a single subschema (draft 2020-12 applicators included). */
const SCHEMA_SLOT_KEYWORDS = [
  "items", "additionalProperties", "propertyNames", "contains", "not", "if", "then", "else",
  "unevaluatedProperties", "additionalItems", "contentSchema", "unevaluatedItems"
];

/** Keywords whose value maps names to subschemas. */
const SCHEMA_SUBSCHEMA_MAP_KEYWORDS = ["properties", ...SCHEMA_MAP_KEYWORDS, "patternProperties", "dependentSchemas"];

/** Truncation placeholders a deep-truncating harness emits instead of a schema. */
const SCHEMA_PLACEHOLDER_PATTERN = /^\[(?:MaxDepth|Truncated|Circular|Object|Array)\]$/;

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

  // Draft-3 / OpenAPI-converted schemas mark a property itself `required: true`;
  // lift that into the parent's `required` list instead of rejecting it.
  if (isBoolean(out.required)) delete out.required;

  // `properties: null` stays "missing" (#1350 treats it as an empty map).
  if (out.properties !== undefined && out.properties !== null) {
    if (!isPlainObject(out.properties)) throw invalidToolSchemaError(toolName, `${path}.properties must be an object`);
    const lifted = [];
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([name, child]) => {
      if (!isSubschema(child)) throw invalidToolSchemaError(toolName, `${path}.properties.${name} must be a schema object`);
      if (child?.required === true) lifted.push(name);
      return [name, normalizeNode(child, toolName, `${path}.properties.${name}`)];
    }));
    // `required` must name properties, so it is enforced only where properties exist.
    if (out.required !== undefined && !(Array.isArray(out.required) && out.required.every(isString))) {
      throw invalidToolSchemaError(toolName, `${path}.required must be an array of strings`);
    }
    if (lifted.length > 0) out.required = [...new Set([...(out.required || []), ...lifted])];
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

/** A truncation placeholder stands in for a schema the client could not serialize. */
function isSchemaPlaceholder(value) {
  return isString(value) && SCHEMA_PLACEHOLDER_PATTERN.test(value.trim());
}

/**
 * Coerce an index-keyed object (`{"0":"a","1":"b"}`) into the array it stands
 * for. Returns null when the value is not an array and not index-keyed.
 */
function coerceIndexedObjectToArray(value) {
  if (Array.isArray(value)) return value;
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 0 || !keys.every((key, index) => key === String(index))) return null;
  return keys.map((key) => value[key]);
}

/**
 * Repair the invalid constructs a deep-truncating harness emits into a client
 * tool schema: a string where an array belongs (`enum: "[MaxDepth]"`), an
 * index-keyed object where an array belongs, and a placeholder string where a
 * subschema belongs.
 *
 * Only schema positions are visited. Annotation keywords (`description`,
 * `title`, `default`, `examples`) keep their literal value, and valid schemas
 * — including boolean subschemas such as `additionalProperties: false` — come
 * back unchanged. Never mutates the caller's object.
 *
 * @param {unknown} node
 * @returns {unknown}
 */
function repairSchemaConstructs(node) {
  if (Array.isArray(node)) return node.map((entry) => repairSchemaConstructs(entry));
  if (!isPlainObject(node)) return isSchemaPlaceholder(node) ? {} : node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (NUMERIC_KEYWORDS.has(key)) {
      out[key] = numericValue(value);
      continue;
    }
    if (SCHEMA_ARRAY_KEYWORDS.includes(key)) {
      const array = coerceIndexedObjectToArray(value);
      // A non-array value in an array keyword is invalid (upstream rejects
      // `enum: "[MaxDepth]"` before inference); drop the keyword instead.
      if (!array) continue;
      out[key] = SCHEMA_LIST_KEYWORDS.includes(key) ?
      array.map((entry) => repairSchemaConstructs(entry)) :
      array;
      continue;
    }
    if (SCHEMA_SLOT_KEYWORDS.includes(key)) {
      if (isPlainObject(value) || Array.isArray(value)) {
        out[key] = repairSchemaConstructs(value);
        continue;
      }
      // Boolean subschemas are valid JSON Schema (`additionalProperties: false`
      // locks the object down); they must not become a permissive `{}`.
      if (isBoolean(value)) {
        out[key] = value;
        continue;
      }
      out[key] = isSchemaPlaceholder(value) ? {} : value;
      continue;
    }
    if (key === "const") {
      // A truncated assertion carries no intent; a real one is kept.
      if (!isSchemaPlaceholder(value)) out[key] = value;
      continue;
    }
    if (SCHEMA_SUBSCHEMA_MAP_KEYWORDS.includes(key) && isPlainObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) =>
      [name, repairSchemaConstructs(child)]));
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Normalize and repair a client tool schema before a Chat Completions
 * upstream receives it: the shared validation and numeric coercion of
 * {@link normalizeToolSchema}, then the invalid-construct repair upstream
 * applies on the Responses → Chat path.
 *
 * A valid schema — its object shape, `required` list, strict intent and
 * annotation metadata — is preserved; only the constructs a strict validator
 * rejects are changed. Never mutates the caller's object.
 *
 * @param {unknown} schema
 * @param {string} [toolName]
 * @returns {unknown}
 */
export function sanitizeToolSchemaParameters(schema, toolName) {
  return repairSchemaConstructs(normalizeToolSchema(schema, toolName));
}

/**
 * Ensure object schema always has properties field (required by Codex Responses API)
 */
export function normalizeToolParameters(params) {
  if (!params) return { type: "object", properties: {} };
  if (params.type === "object" && !params.properties) return { ...params, properties: {} };
  return params;
}
