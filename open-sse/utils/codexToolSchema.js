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
    if (key === "pattern" && isString(value) && UNICODE_PROPERTY_ESCAPE.test(value)) {
      if (cleaned === node) cleaned = { ...node };
      delete cleaned.pattern;
      continue;
    }

    let nextValue = value;
    if (SCHEMA_MAP_KEYWORDS.has(key)) nextValue = stripSchemaMap(value);
    else if (SCHEMA_VALUE_KEYWORDS.has(key)) nextValue = stripSchemaNode(value);
    if (nextValue === value) continue;
    if (cleaned === node) cleaned = { ...node };
    cleaned[key] = nextValue;
  }
  return cleaned;
}

/**
 * Remove Unicode-property regex constraints unsupported by Codex `/responses`.
 *
 * Codex rejects otherwise valid JSON Schema `pattern` values containing
 * `\p{...}` or `\P{...}`. This schema-aware, copy-on-write walk strips only
 * those constraints: schema-map keys remain names, annotation/data values are
 * opaque, and compatible schemas retain their original reference.
 *
 * @param {unknown} schema Tool parameter schema.
 * @returns {unknown} Original schema, or a minimally cloned sanitized schema.
 */
export function stripCodexUnsupportedPatterns(schema) {
  return stripSchemaNode(schema);
}
