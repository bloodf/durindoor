/**
 * Remove the compatibility-only `reason` argument from translated Gemini tool calls.
 *
 * The Gemini cleaner gives every object schema without properties a required
 * `reason` property (`GEMINI_PLACEHOLDER_KEY`), because Gemini rejects an empty
 * OBJECT. The model fills it, and a strict client then rejects the call
 * ("unexpected parameter 'reason'"). The request keeps the placeholder; this
 * module drops the argument again, but only at object positions where all of
 * these hold:
 *
 * 1. The client's own tool declaration resolves exactly (one tool, known dialect).
 * 2. Re-running the request transformation on that declaration reports that the
 *    cleaner inserted the placeholder at that position (a `reason` the client
 *    declared is never reported, so it stays).
 * 3. The declaration actually sent upstream still carries the placeholder at the
 *    same position (a provider path that does not clean, or a schema the
 *    executor flattened, leaves the arguments untouched).
 *
 * Anything unresolved returns the arguments unchanged. Native Gemini bodies and
 * thought signatures are never read or rewritten here.
 */
import { GEMINI_PLACEHOLDER_KEY, buildGeminiToolParameters } from "../formats/gemini.js";
import { normalizeToolParameters, normalizeToolSchema, sanitizeToolSchemaParameters } from "./toolSchema.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

const isRecord = (value) => value !== null && isObject(value) && !Array.isArray(value);
const hasOwn = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
const EMPTY_OBJECT_SCHEMA = () => ({ type: "object", properties: {} });

/** Declared name of a client tool in any supported client dialect, or "". */
function declaredName(tool) {
  if (!isRecord(tool)) return "";
  const name = isRecord(tool.function) ? tool.function.name : tool.name;
  return isString(name) ? name.trim() : "";
}

/** Client tool declarations flattened to `{ name, schema }`, where `schema` is the pre-Gemini schema. */
function* clientDeclarations(clientTools) {
  for (const tool of Array.isArray(clientTools) ? clientTools : []) {
    if (!isRecord(tool)) continue;
    // Native Gemini client: tools[].functionDeclarations[].
    if (Array.isArray(tool.functionDeclarations)) {
      for (const fn of tool.functionDeclarations) {
        if (isRecord(fn) && isString(fn.name)) yield { name: fn.name.trim(), dialect: "gemini", raw: fn.parameters || fn.parametersJsonSchema || EMPTY_OBJECT_SCHEMA() };
      }
      continue;
    }
    // OpenAI Chat: { type: "function", function: { name, parameters } }.
    if (isRecord(tool.function)) {
      if (tool.type === undefined || tool.type === "function") yield { name: declaredName(tool), dialect: "chat", raw: tool.function.parameters };
      continue;
    }
    // Responses function tool: { type: "function", name, parameters }.
    if (tool.type === "function") {
      yield { name: declaredName(tool), dialect: "responses", raw: tool.parameters };
      continue;
    }
    // Claude Messages tool: { name, input_schema } (typeless or "custom"); typed server tools are not functions.
    if ((tool.type === undefined || tool.type === "custom") && "input_schema" in tool) {
      yield { name: declaredName(tool), dialect: "claude", raw: tool.input_schema ? tool.input_schema : EMPTY_OBJECT_SCHEMA() };
    }
  }
}

/** The parameter schema before the shared Gemini builder, following each client's request pivot. */
function preGeminiSchema({ dialect, raw, name }) {
  if (dialect === "claude") return raw === undefined ? EMPTY_OBJECT_SCHEMA() : normalizeToolSchema(raw, name);
  if (dialect === "responses") return normalizeToolParameters(sanitizeToolSchemaParameters(raw, name));
  return raw;
}

/** Declarations the provider request carried (native `tools` or a Cloud Code `request` envelope). */
function providerDeclarations(providerBody) {
  const tools = isRecord(providerBody?.request) && Array.isArray(providerBody.request.tools) ? providerBody.request.tools : providerBody?.tools;
  const result = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    for (const fn of Array.isArray(tool?.functionDeclarations) ? tool.functionDeclarations : []) {
      if (isRecord(fn) && isString(fn.name)) result.push(fn);
    }
  }
  return result;
}

/** Schema node at `path` (`{property}` / `{items}` steps), or null. */
function nodeAt(schema, path) {
  let node = schema;
  for (const step of path) {
    if (!isRecord(node)) return null;
    node = step.items ? node.items : isRecord(node.properties) && hasOwn(node.properties, step.property) ? node.properties[step.property] : null;
  }
  return isRecord(node) ? node : null;
}

/** True when `node` is an object whose only property is the placeholder string. */
function carriesPlaceholder(node) {
  const properties = node?.properties;
  if (!isRecord(properties)) return false;
  const keys = Object.keys(properties);
  return keys.length === 1 && keys[0] === GEMINI_PLACEHOLDER_KEY && isRecord(properties[keys[0]]) && properties[keys[0]].type === "string";
}

/** Merge placeholder paths into a trie: `{ insert, properties: Map, items }`. */
function buildTrie(paths) {
  const root = { insert: false, properties: new Map(), items: null };
  for (const path of paths) {
    let node = root;
    for (const step of path) {
      if (step.items) node = node.items ??= { insert: false, properties: new Map(), items: null };
      else {
        if (!node.properties.has(step.property)) node.properties.set(step.property, { insert: false, properties: new Map(), items: null });
        node = node.properties.get(step.property);
      }
    }
    node.insert = true;
  }
  return root;
}

/** Copy-on-write walk: returns `value` itself when nothing was removed. */
function stripAt(value, node) {
  if (Array.isArray(value)) {
    if (!node.items) return value;
    let next = null;
    value.forEach((item, index) => {
      const stripped = stripAt(item, node.items);
      if (stripped === item) return;
      next ??= [...value];
      next[index] = stripped;
    });
    return next ?? value;
  }
  if (!isRecord(value)) return value;
  let out = value;
  if (node.insert && hasOwn(out, GEMINI_PLACEHOLDER_KEY)) {
    out = { ...value };
    delete out[GEMINI_PLACEHOLDER_KEY];
  }
  for (const [key, child] of node.properties) {
    if (!hasOwn(out, key)) continue;
    const stripped = stripAt(out[key], child);
    if (stripped === out[key]) continue;
    if (out === value) out = { ...value };
    out[key] = stripped;
  }
  return out;
}

/**
 * Resolve the placeholder positions for one client tool against the declaration
 * that was sent for it. Returns a trie, or null when nothing is provably synthetic.
 */
function resolvePlaceholderTrie(declaration, sentSchema) {
  const placeholderPaths = [];
  try {
    buildGeminiToolParameters(preGeminiSchema(declaration), declaration.name, { placeholderPaths });
  } catch {
    // The request path already rejected or rebuilt this schema; stay conservative.
    return null;
  }
  const confirmed = placeholderPaths.filter((path) => carriesPlaceholder(nodeAt(sentSchema, path)));
  return confirmed.length ? buildTrie(confirmed) : null;
}

/**
 * Build a stripper for one request. `clientTools` is the client's tools[] (any
 * supported dialect), `providerBody` the body sent upstream, and `toolNameMap` the
 * provider-name to client-name alias map the response path already restores with.
 * Returns `(providerToolName, args) => args`; `args` is returned as-is when
 * nothing is provably synthetic and is never mutated.
 */
export function createGeminiPlaceholderStripper({ clientTools, providerBody, toolNameMap } = {}) {
  const sent = providerDeclarations(providerBody);
  if (!sent.length || !Array.isArray(clientTools) || !clientTools.length) return (_name, args) => args;
  const clientByName = new Map();
  for (const declaration of clientDeclarations(clientTools)) {
    if (!declaration.name) continue;
    // Two client tools with one name cannot be told apart: leave both alone.
    clientByName.set(declaration.name, clientByName.has(declaration.name) ? null : declaration);
  }
  const cache = new Map();
  return (providerToolName, args) => {
    if (!isRecord(args) || !isString(providerToolName)) return args;
    if (!cache.has(providerToolName)) cache.set(providerToolName, resolveTrie(providerToolName));
    const trie = cache.get(providerToolName);
    return trie ? stripAt(args, trie) : args;
  };

  function resolveTrie(providerToolName) {
    const exact = sent.filter((fn) => fn.name === providerToolName);
    const folded = sent.filter((fn) => fn.name.toLowerCase() === providerToolName.toLowerCase());
    const matches = exact.length ? exact : folded;
    // An unresolvable or ambiguous provider declaration cannot show what was sent.
    if (matches.length !== 1) return null;
    const sentFn = matches[0];
    const lookup = (name) => toolNameMap instanceof Map ? toolNameMap.get(name) ?? toolNameMap.get(name.toLowerCase()) : undefined;
    const mapped = lookup(sentFn.name) ?? lookup(providerToolName);
    const declaration = clientByName.get(isString(mapped) && mapped ? mapped : sentFn.name);
    const sentSchema = sentFn.parameters ?? sentFn.parametersJsonSchema;
    return declaration && isRecord(sentSchema) ? resolvePlaceholderTrie(declaration, sentSchema) : null;
  }
}

/** Memoize the stripper on a translator state object (one per request or stream). */
export function geminiPlaceholderStripperFor(state) {
  if (!isRecord(state)) return (_name, args) => args;
  return state.geminiPlaceholderStripper ??= createGeminiPlaceholderStripper(state);
}
