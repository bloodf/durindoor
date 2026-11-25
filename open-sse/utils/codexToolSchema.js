import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

// An odd backslash run introduces \p{...}/\P{...}; an even run leaves literal text.
const UNICODE_PROPERTY_ESCAPE = /(^|[^\\])(\\\\)*\\[pP]\{/;
const SCHEMA_MAP_KEYWORDS = new Set([
  "$defs",
  "definitions",
  "dependencies",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);
const SCHEMA_VALUE_KEYWORDS = new Set([
  "additionalItems",
  "additionalProperties",
  "allOf",
  "anyOf",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "oneOf",
  "prefixItems",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);
const INTEGER_KEYWORDS = new Set([
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "minContains",
  "minItems",
  "minLength",
  "minProperties",
]);
const NUMBER_KEYWORDS = new Set([
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maximum",
  "minimum",
  "multipleOf",
]);

// Turn a numeric string into a number of the wanted kind. Anything else, including
// a value that would lose precision as a JS number, is returned unchanged.
function toSchemaNumber(value, kind) {
  if (!isString(value) || value.trim() === "") return value;
  const number = Number(value);
  if (kind === "integer") return Number.isSafeInteger(number) ? number : value;
  return Number.isFinite(number) ? number : value;
}

function normalizeNumericValue(node, key, value) {
  if (INTEGER_KEYWORDS.has(key)) return toSchemaNumber(value, "integer");
  if (NUMBER_KEYWORDS.has(key)) return toSchemaNumber(value, "number");
  if (key === "default" && (node.type === "integer" || node.type === "number")) {
    return toSchemaNumber(value, node.type);
  }
  return value;
}

function stripSchemaMap(map) {
  if (!map || !isObject(map) || Array.isArray(map)) return map;

  let cleaned = map;
  for (const [name, schema] of Object.entries(map)) {
    const nextSchema = stripSchemaNode(schema);
    if (nextSchema === schema) continue;
    if (cleaned === map) cleaned = { ...map };
    cleaned[name] = nextSchema;
  }
  return cleaned;
}

function stripSchemaNode(node) {
  if (Array.isArray(node)) {
    let cleaned = node;
    for (let index = 0; index < node.length; index++) {
      const nextItem = stripSchemaNode(node[index]);
      if (nextItem === node[index]) continue;
      if (cleaned === node) cleaned = node.slice();
      cleaned[index] = nextItem;
    }
    return cleaned;
  }
  if (!node || !isObject(node)) return node;

  let cleaned = node;
  for (const [key, value] of Object.entries(node)) {
    if (key === "uniqueItems" || (key === "pattern" && isString(value) && UNICODE_PROPERTY_ESCAPE.test(value))) {
      if (cleaned === node) cleaned = { ...node };
      delete cleaned[key];
      continue;
    }

    let nextValue = normalizeNumericValue(node, key, value);
    if (SCHEMA_MAP_KEYWORDS.has(key)) nextValue = stripSchemaMap(value);
    else if (SCHEMA_VALUE_KEYWORDS.has(key)) nextValue = stripSchemaNode(value);
    if (nextValue === value) continue;
    if (cleaned === node) cleaned = { ...node };
    cleaned[key] = nextValue;
  }
  return cleaned;
}

/**
 * Make a tool schema acceptable to Codex `/responses`: remove uniqueItems and
 * Unicode-property regex constraints, and send numeric keywords as numbers.
 *
 * Codex rejects otherwise valid JSON Schema `pattern` values containing
 * `\p{...}` or `\P{...}`. This schema-aware, copy-on-write walk strips only
 * those constraints and uniqueItems. Codex also rejects numeric keywords (and the
 * `default` of an integer or number schema) encoded as strings, so those are
 * converted. Schema-map keys remain names, annotation/data values are
 * opaque, and compatible schemas retain their original reference.
 *
 * @param {unknown} schema Tool parameter schema.
 * @returns {unknown} Original schema, or a minimally cloned sanitized schema.
 */
export function stripCodexUnsupportedPatterns(schema) {
  return stripSchemaNode(schema);
}
