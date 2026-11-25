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

// Follow a local `#/...` reference. `seen` is per branch, so two variants may share a definition.
function followLocalRef(schema, root, seen) {
  if (!isPlainObject(schema) || !isString(schema.$ref) || !schema.$ref.startsWith("#/")) return { schema, seen };
  if (seen.has(schema.$ref)) return { schema: {}, seen };
  const target = schema.$ref.slice(2).split("/").reduce((node, part) => {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    return isPlainObject(node) && Object.hasOwn(node, key) ? node[key] : undefined;
  }, root);
  if (!isPlainObject(target)) return { schema, seen };
  const { $ref, ...overrides } = schema;
  return followLocalRef({ ...target, ...overrides }, root, new Set(seen).add($ref));
}

// One property declared by several variants keeps every distinct declaration.
function combineDeclarations(declarations, keyword) {
  const distinct = [...new Map(declarations.map((item) => [JSON.stringify(item), item])).values()];
  return distinct.length === 1 ? distinct[0] : { [keyword]: distinct };
}

function mergeRootVariants(input, root, seenRefs) {
  const { schema, seen } = followLocalRef(input, root, seenRefs);
  if (!isPlainObject(schema)) return { type: "object", properties: {} };
  const { allOf, oneOf, anyOf, ...base } = schema;
  const properties = new Map(Object.entries(base.properties || {}));
  const required = new Set(Array.isArray(base.required) ? base.required : []);
  let closed = base.additionalProperties === false;

  for (const [keyword, list] of Object.entries({ allOf, oneOf, anyOf })) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const variants = list.map((variant) => mergeRootVariants(variant, root, seen));
    const isAll = keyword === "allOf";
    const declared = new Map();
    for (const variant of variants) {
      for (const [name, property] of Object.entries(variant.properties)) {
        declared.set(name, [...(declared.get(name) || []), property]);
      }
    }
    for (const [name, declarations] of declared) {
      const merged = combineDeclarations(declarations, isAll ? "allOf" : "anyOf");
      properties.set(name, properties.has(name) ? combineDeclarations([properties.get(name), merged], "allOf") : merged);
    }
    // Every allOf requirement applies; a union requires only what all its variants require.
    const names = variants.flatMap((variant) => variant.required || []);
    for (const name of names) {
      if (isAll || variants.every((variant) => variant.required?.includes(name))) required.add(name);
    }
    const isClosed = (variant) => variant.additionalProperties === false;
    if (isAll ? variants.some(isClosed) : variants.every(isClosed)) closed = true;
  }

  return {
    ...base,
    type: "object",
    properties: Object.fromEntries(properties),
    ...(required.size > 0 && { required: [...required] }),
    ...(closed && { additionalProperties: false }),
  };
}

/**
 * Anthropic rejects `oneOf` / `allOf` / `anyOf` at the root of `input_schema`
 * (9router #4472). Merge the variants into one object whose properties are their
 * superset, so tool calls keep the caller's argument shape. Nested unions and the
 * source object are left alone; a schema without a root union is returned as is.
 *
 * @param {unknown} schema
 * @returns {unknown}
 */
export function flattenRootSchemaUnion(schema) {
  if (!isPlainObject(schema) || !ROOT_COMBINATORS.some((key) => Array.isArray(schema[key]))) return schema;
  return mergeRootVariants(schema, schema, new Set());
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
  const schema = flattenRootSchemaUnion(normalizeToolSchema(rootType === "object" ? picked : untyped, toolName));
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
