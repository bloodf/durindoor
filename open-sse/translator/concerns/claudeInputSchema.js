/**
 * Normalize Chat/Anthropic tool schemas for Claude-bound `input_schema`.
 *
 * Shared by openai→claude, openai→commandcode, and prepareClaudeRequest so
 * every Claude-bound path applies the same rules (#1350 / #1352).
 */
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { invalidToolSchemaError, normalizeToolSchema } from "./toolSchema.js";

const isPlainObject = (value) => value !== null && isObject(value) && !Array.isArray(value);

const ROOT_COMBINATORS = ["allOf", "oneOf", "anyOf"];

// A `#/...` reference into the same schema; `seen` stops reference cycles.
function resolveLocalRef(node, root, seen) {
  if (!isPlainObject(node) || !isString(node.$ref) || !node.$ref.startsWith("#/")) return node;
  if (seen.has(node.$ref)) return {};
  seen.add(node.$ref);
  const target = node.$ref.slice(2).split("/").
  map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~")).
  reduce((value, part) => isPlainObject(value) && Object.hasOwn(value, part) ? value[part] : undefined, root);
  if (!isPlainObject(target)) return node;
  const { $ref, ...siblings } = node;
  return { ...resolveLocalRef(target, root, seen), ...siblings };
}

const mergeProperty = (first, second, keyword) =>
first === undefined || JSON.stringify(first) === JSON.stringify(second) ? second : { [keyword]: [first, second] };

function flattenObjectNode(node, root, seen) {
  const resolved = resolveLocalRef(node, root, seen);
  if (!isPlainObject(resolved)) return {};
  const { allOf, oneOf, anyOf, ...base } = resolved;
  // A Map keeps a property named like an Object member (`__proto__`) as data.
  const properties = new Map(Object.entries(base.properties || {}));
  const required = new Set(base.required || []);
  let closed = base.additionalProperties === false;
  for (const [keyword, list] of [["allOf", allOf], ["oneOf", oneOf], ["anyOf", anyOf]]) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const variants = list.map((variant) => flattenObjectNode(variant, root, new Set(seen)));
    const every = keyword === "allOf";
    const merged = new Map();
    for (const variant of variants) {
      for (const [name, property] of Object.entries(variant.properties || {})) {
        merged.set(name, mergeProperty(merged.get(name), property, every ? "allOf" : "anyOf"));
      }
    }
    for (const [name, property] of merged) properties.set(name, mergeProperty(properties.get(name), property, "allOf"));
    // allOf requires everything any member requires; oneOf/anyOf only what all share.
    const names = every ?
    variants.flatMap((variant) => variant.required || []) :
    (variants[0].required || []).filter((name) => variants.every((variant) => variant.required?.includes(name)));
    for (const name of names) required.add(name);
    const isClosed = (variant) => variant.additionalProperties === false;
    closed ||= every ? variants.some(isClosed) : variants.every(isClosed);
  }
  return {
    ...base,
    type: "object",
    properties: Object.fromEntries(properties),
    ...(required.size > 0 && { required: [...required] }),
    ...(closed && { additionalProperties: false })
  };
}

/**
 * Anthropic rejects oneOf/allOf/anyOf at the root of a tool schema. Merge the
 * object variants into one property superset; nested unions stay (upstream #4490).
 */
function flattenRootCombinators(schema) {
  return ROOT_COMBINATORS.some((keyword) => Array.isArray(schema[keyword])) ?
  flattenObjectNode(schema, schema, new Set()) :
  schema;
}

/**
 * Pick the first plain object among `parameters` / `input_schema`, then ensure
 * Claude-compatible object shape. Non-plain inputs fall back to a fresh
 * `{ type: "object", properties: {}, required: [] }`. A root `type: null` (Codex)
 * is treated as missing and a type list containing "object" as "object"; any
 * other root type (e.g. `{ type: "string" }`) is rejected with HTTP 400 naming
 * the tool, since Anthropic requires `type:"object"` (#1353); malformed schemas are rejected and
 * numeric-string constraints coerced by normalizeToolSchema (#1334). Never
 * mutates the caller's object.
 *
 * @param {unknown} parameters
 * @param {unknown} [inputSchema]
 * @param {string} [toolName]
 * @returns {Record<string, unknown>}
 */
export function toClaudeInputSchema(parameters, inputSchema, toolName) {
  const picked = [parameters, inputSchema].find(isPlainObject);
  if (!picked) return { type: "object", properties: {}, required: [] };
  const { type: rootType, ...untyped } = picked;
  const objectLike = rootType == null || rootType === "object" || (Array.isArray(rootType) && rootType.includes("object"));
  if (!objectLike) {
    throw invalidToolSchemaError(toolName, `Claude requires an object input_schema, got type ${JSON.stringify(rootType)}`);
  }
  // null / ["object", ...] roots drop their type and take the typeless path below.
  const schema = flattenRootCombinators(normalizeToolSchema(rootType === "object" ? picked : untyped, toolName));
  // Object or typeless: require type:"object" and a non-null properties map.
  // `properties: null` is treated like missing (Anthropic rejects null).
  if (schema.type === "object" && schema.properties !== undefined && schema.properties !== null) {
    return schema;
  }
  return {
    type: "object",
    ...schema,
    ...((schema.properties === undefined || schema.properties === null) && { properties: {} }),
  };
}
