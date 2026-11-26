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

// Client schemas drive the flattener, so its total work is bounded (#2571).
const MAX_EXPANDED_NODES = 2000;
const MAX_DEPTH = 32;
const MAX_MERGED_ENTRIES = 100_000;
const MAX_MERGED_CHARS = 1_000_000;
const MAX_NOTE_CHARS = 2000;

const LIMIT_NOTE = "Some argument combinations were omitted because this schema is too large to expand.";

class ExpansionLimitError extends Error {}

function createState(root) {
  return {
    root,
    nodes: 0,
    entries: 0,
    chars: 0,
    cycles: 0,
    seen: new Set(), // refs on the current path; stops reference cycles
    memo: new Map(), // schema node -> flattened record
    keys: new Map(), // property schema -> serialization
    unions: new Map(), // property unions built here -> { keyword, members }
    notes: new Set()
  };
}

function spend(state, counter, amount, limit) {
  state[counter] += amount;
  if (state[counter] > limit) throw new ExpansionLimitError();
}

const lookupPointer = (root, ref) => ref.slice(2).split("/").
map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~")).
reduce((value, part) => isPlainObject(value) && Object.hasOwn(value, part) ? value[part] : undefined, root);

// Follow `#/...` references into the same schema. `followed` collects the refs
// this node added to the current path so the caller can release them.
function resolveLocalRef(node, state, followed) {
  let current = node;
  while (isPlainObject(current) && isString(current.$ref) && current.$ref.startsWith("#/")) {
    const { $ref, ...siblings } = current;
    if (state.seen.has($ref)) {
      state.cycles += 1;
      return siblings;
    }
    const target = lookupPointer(state.root, $ref);
    if (!isPlainObject(target)) break;
    spend(state, "nodes", 1, MAX_EXPANDED_NODES);
    state.seen.add($ref);
    followed.push($ref);
    current = { ...target, ...siblings };
  }
  return current;
}

function propertyKey(state, schema) {
  let key = state.keys.get(schema);
  if (key === undefined) {
    key = JSON.stringify(schema);
    state.keys.set(schema, key);
  }
  return key;
}

const distinctSchemas = (state, schemas) =>
[...new Map(schemas.map((schema) => [propertyKey(state, schema), schema])).values()];

// One schema for a property declared several times. Unions of the same keyword
// stay flat, so shared definitions cannot multiply the serialized output.
function mergeProperty(state, schemas, keyword) {
  const members = distinctSchemas(state, schemas.flatMap((schema) => {
    const union = state.unions.get(schema);
    return union?.keyword === keyword ? union.members : [schema];
  }));
  if (members.length === 1) return members[0];
  const keys = members.map((member) => propertyKey(state, member));
  spend(state, "chars", keys.reduce((total, key) => total + key.length, 0), MAX_MERGED_CHARS);
  const merged = { [keyword]: members };
  state.unions.set(merged, { keyword, members });
  state.keys.set(merged, `{"${keyword}":[${keys.join(",")}]}`);
  return merged;
}

// Describe a union whose branches cannot be merged without losing which
// arguments belong together.
function unionNote(state, keyword, variants, conflicting) {
  let note = `Argument combinations (${keyword}, match ${keyword === "oneOf" ? "exactly one" : "at least one"}):`;
  for (const [index, variant] of variants.entries()) {
    const values = conflicting.
    filter((name) => variant.properties.has(name)).
    map((name) => ` ${name}=${propertyKey(state, variant.properties.get(name))}`);
    const required = [...variant.required].join(", ") || "nothing";
    note += ` [${index + 1}] requires ${required}${values.length > 0 ? ` where${values.join(",")}` : ""};`;
    if (note.length > MAX_NOTE_CHARS) return `${note.slice(0, MAX_NOTE_CHARS)}...`;
  }
  return note;
}

function mergeCombinator(state, record, keyword, variants) {
  const every = keyword === "allOf";
  const declared = new Map();
  const requiredCounts = new Map();
  for (const variant of variants) {
    spend(state, "entries", variant.properties.size + variant.required.size, MAX_MERGED_ENTRIES);
    for (const [name, property] of variant.properties) {
      if (!declared.has(name)) declared.set(name, []);
      declared.get(name).push(property);
    }
    for (const name of variant.required) requiredCounts.set(name, (requiredCounts.get(name) || 0) + 1);
  }
  // allOf requires everything any member requires; oneOf/anyOf only what all share.
  const names = [...requiredCounts.keys()].filter((name) => every || requiredCounts.get(name) === variants.length);
  if (!every && variants.length > 1) {
    // A union merges losslessly enough when shared properties agree and one
    // branch asks for nothing beyond the shared requirements.
    const conflicting = [...declared.keys()].filter((name) => distinctSchemas(state, declared.get(name)).length > 1);
    if (conflicting.length > 0 || !variants.some((variant) => variant.required.size === names.length)) {
      state.notes.add(unionNote(state, keyword, variants, conflicting));
    }
  }
  for (const [name, schemas] of declared) {
    const merged = mergeProperty(state, schemas, every ? "allOf" : "anyOf");
    const existing = record.properties.get(name);
    record.properties.set(name, existing === undefined ? merged : mergeProperty(state, [existing, merged], "allOf"));
  }
  for (const name of names) record.required.add(name);
  const isClosed = (variant) => variant.closed;
  record.closed ||= every ? variants.some(isClosed) : variants.every(isClosed);
}

function flattenObjectNode(node, state, depth) {
  const memoized = state.memo.get(node);
  if (memoized) return memoized;
  if (depth > MAX_DEPTH) throw new ExpansionLimitError();
  spend(state, "nodes", 1, MAX_EXPANDED_NODES);

  const cyclesBefore = state.cycles;
  const followed = [];
  const resolved = resolveLocalRef(node, state, followed);
  const { allOf, oneOf, anyOf, ...base } = isPlainObject(resolved) ? resolved : {};
  // A Map keeps a property named like an Object member (`__proto__`) as data.
  const record = {
    base,
    properties: new Map(isPlainObject(base.properties) ? Object.entries(base.properties) : []),
    required: new Set(Array.isArray(base.required) ? base.required.filter(isString) : []),
    closed: base.additionalProperties === false
  };
  spend(state, "entries", record.properties.size + record.required.size, MAX_MERGED_ENTRIES);
  for (const [keyword, list] of [["allOf", allOf], ["oneOf", oneOf], ["anyOf", anyOf]]) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const variants = list.map((variant) => flattenObjectNode(variant, state, depth + 1));
    mergeCombinator(state, record, keyword, variants);
  }
  for (const ref of followed) state.seen.delete(ref);
  // A result cut short by a cycle depends on the path that reached it.
  if (state.cycles === cyclesBefore) state.memo.set(node, record);
  return record;
}

const appendDescription = (description, notes) =>
[...isString(description) && description ? [description] : [], ...notes].join("\n\n");

/**
 * Anthropic rejects oneOf/allOf/anyOf at the root of a tool schema. Merge the
 * object variants into one property superset; nested unions stay (upstream #4490).
 * Unions that cannot merge cleanly are also described in `description`. A schema
 * past the expansion limits keeps only what its root declares (#2571).
 * Anything without a root union is returned as is (also used for passthrough tools).
 */
export function flattenRootCombinators(schema) {
  if (!isPlainObject(schema) || !ROOT_COMBINATORS.some((keyword) => Array.isArray(schema[keyword]))) return schema;
  const state = createState(schema);
  try {
    const { base, properties, required, closed } = flattenObjectNode(schema, state, 0);
    const notes = [...state.notes].join("\n");
    return {
      ...base,
      type: "object",
      properties: Object.fromEntries(properties),
      ...(required.size > 0 && { required: [...required] }),
      ...(closed && { additionalProperties: false }),
      ...(notes && {
        description: appendDescription(base.description,
        [notes.length > MAX_NOTE_CHARS ? `${notes.slice(0, MAX_NOTE_CHARS)}...` : notes])
      })
    };
  } catch (error) {
    if (!(error instanceof ExpansionLimitError)) throw error;
    // The variants' properties are unknown here, so the object must stay open.
    const { allOf, oneOf, anyOf, additionalProperties, ...base } = schema;
    return {
      ...base,
      type: "object",
      properties: base.properties || {},
      description: appendDescription(base.description, [LIMIT_NOTE])
    };
  }
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
