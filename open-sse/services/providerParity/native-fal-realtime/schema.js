// Realtime endpoint path selection and input validation.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/falEndpoint.ts (canonicalFalEndpoint: `owner/app[/subpath]`,
// at most 300 chars, no `.`/`..` segments; falRealtimePath:
// `x-fal-realtime.path` when a string, else `/realtime` for documented
// endpoints, else none; the path must match `^/[a-zA-Z0-9_/-]+$` without `//`)
// and open-sse/handlers/fal/schema.ts (falInputSchema "realtime": an explicit
// `x-fal-realtime.input_schema`, else the bundled ./realtimeSchema.json for
// fal-ai/fast-lcm-diffusion when there is no override at all; a path-only
// override needs an input schema. compileFalInput: no defaults, coercion,
// clamping or field removal; unknown top-level keys are refused unless
// `additionalProperties` is true).
//
// Fork deviations: the source compiles with Ajv + ajv-formats, which this
// package does not depend on. The local validator covers the JSON Schema
// subset the realtime schemas use: `$ref` (local), `allOf`, `anyOf`, `oneOf`,
// `type` (incl. arrays and `nullable`), `enum`, `const`, numeric bounds,
// string and array lengths, `items`, nested `properties`/`required`/
// `additionalProperties: false`, and `format: "uri"`. Other keywords and
// formats are not checked. The legacy alias table is not ported: realtime
// endpoints are always given in full.
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { FAL_DOCUMENTED_REALTIME_ENDPOINTS } from "./config.js";
import bundled from "./realtimeSchema.json" with { type: "json" };

const ENDPOINT_RE = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/;
const PATH_RE = /^\/[a-zA-Z0-9_/-]+$/;
const MAX_SCHEMA_DEPTH = 32;

export class FalRealtimeError extends Error {
  constructor(message, status, extra = {}) {
    super(message);
    this.name = "FalRealtimeError";
    this.status = status;
    Object.assign(this, extra);
  }
}
const invalid = (message) => new FalRealtimeError(message, 400);

/** A fal endpoint id, or throws (source canonicalFalEndpoint without the legacy alias table). */
export function canonicalFalRealtimeEndpoint(value) {
  if (!isString(value) || value.length > 300 || !ENDPOINT_RE.test(value) || value.split("/").some((s) => s === "." || s === "..")) {
    throw invalid("A fal endpoint must be an owner/app[/subpath] ID");
  }
  return value;
}

function realtimeOverride(definition) {
  const value = definition?.openapi?.["x-fal-realtime"];
  return isRecord(value) ? value : {};
}

/** `owner/app[/subpath]/realtime-path` for a realtime-capable definition, else null (source falRealtimePath). */
export function falRealtimePath(definition) {
  if (!isRecord(definition) || !isRecord(definition.openapi)) throw invalid("A fal definition needs an OpenAPI document");
  const endpoint = canonicalFalRealtimeEndpoint(definition.endpoint_id);
  const override = realtimeOverride(definition);
  const path = isString(override.path) ? override.path : FAL_DOCUMENTED_REALTIME_ENDPOINTS.includes(endpoint) ? "/realtime" : null;
  if (path === null) return null;
  if (!PATH_RE.test(path) || path.includes("//") || path.length > 200) throw invalid("Invalid documented fal realtime path");
  return `${endpoint}${path}`;
}

/** `wss://fal.run/{path}` for a definition, or throws when it has no realtime path. */
export function falRealtimeUrl(definition) {
  const path = falRealtimePath(definition);
  if (!path) throw new FalRealtimeError("This fal endpoint has no documented realtime transport", 400);
  return `wss://fal.run/${path}`;
}

/** The realtime input schema and the document its `$ref`s resolve in (source falInputSchema "realtime"). */
export function falRealtimeInputSchema(definition) {
  const path = falRealtimePath(definition);
  if (!path) throw new FalRealtimeError("This fal endpoint has no documented realtime transport", 400);
  const override = realtimeOverride(definition);
  // Legacy path-only overrides remain stored, but need an explicit input_schema upgrade.
  if (isRecord(override.input_schema) && Object.keys(override.input_schema).length) {
    const schema = override.input_schema;
    return { path, schema, document: { ...definition.openapi, components: schema.components ?? definition.openapi.components } };
  }
  if (definition.endpoint_id === "fal-ai/fast-lcm-diffusion" && !Object.keys(override).length) {
    return { path, schema: bundled.schema, document: { components: bundled.components } };
  }
  throw new FalRealtimeError("No verified realtime input schema; register x-fal-realtime.input_schema", 400);
}

function localRef(document, ref) {
  if (!ref.startsWith("#/")) throw invalid("External schema references are unsupported");
  let value = document;
  for (const key of ref.slice(2).split("/")) value = isRecord(value) ? value[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
  if (value === undefined) throw invalid("Unresolved fal schema reference");
  return value;
}

function resolve(document, schema, depth = 0) {
  if (depth > MAX_SCHEMA_DEPTH) throw invalid("fal schema references nest too deeply");
  if (schema === true || schema === undefined) return {};
  if (!isRecord(schema)) return { not: true };
  return isString(schema.$ref) ? resolve(document, localRef(document, schema.$ref), depth + 1) : schema;
}

/** Properties of an object schema, merged across allOf/anyOf/oneOf (source falInputProperties). */
export function falRealtimeInputProperties(document, schema, seen = new Set()) {
  const resolved = resolve(document, schema);
  if (seen.has(resolved)) return {};
  seen.add(resolved);
  const properties = {};
  if (isRecord(resolved.properties)) Object.assign(properties, resolved.properties);
  for (const composition of ["allOf", "anyOf", "oneOf"]) {
    if (!Array.isArray(resolved[composition])) continue;
    for (const alternative of resolved[composition]) Object.assign(properties, falRealtimeInputProperties(document, alternative, seen));
  }
  return properties;
}

const TYPE_CHECKS = {
  string: isString,
  number: (v) => isNumber(v) && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: isBoolean,
  array: Array.isArray,
  object: isRecord,
  null: (v) => v === null,
};

const isUri = (v) => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v) && URL.canParse(v);

function check(document, name, schema, value, depth) {
  if (depth > MAX_SCHEMA_DEPTH) throw invalid(`Invalid fal input: ${name} nests too deeply`);
  const s = resolve(document, schema);
  if (s.not === true) throw invalid(`Invalid fal input: ${name} is not allowed`);
  const fail = (rule) => { throw invalid(`Invalid fal input: ${name} ${rule}`); };
  for (const part of Array.isArray(s.allOf) ? s.allOf : []) check(document, name, part, value, depth + 1);
  for (const key of ["anyOf", "oneOf"]) {
    if (!Array.isArray(s[key])) continue;
    let matches = 0;
    for (const alternative of s[key]) {
      try { check(document, name, alternative, value, depth + 1); matches++; } catch (error) { if (!(error instanceof FalRealtimeError)) throw error; }
    }
    if (key === "anyOf" ? matches === 0 : matches !== 1) fail(`does not match ${key}`);
  }
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? [...s.type] : [s.type];
  if (types.length && s.nullable === true) types.push("null");
  if (types.length && !types.some((type) => TYPE_CHECKS[type]?.(value))) fail(`must be ${types.join(" or ")}`);
  if (Array.isArray(s.enum) && !s.enum.some((item) => item === value)) fail("is not an allowed value");
  if (s.const !== undefined && s.const !== value) fail("is not the allowed value");
  if (isNumber(value)) {
    if (isNumber(s.minimum) && value < s.minimum) fail(`must be >= ${s.minimum}`);
    if (isNumber(s.maximum) && value > s.maximum) fail(`must be <= ${s.maximum}`);
    if (isNumber(s.exclusiveMinimum) && value <= s.exclusiveMinimum) fail(`must be > ${s.exclusiveMinimum}`);
    if (isNumber(s.exclusiveMaximum) && value >= s.exclusiveMaximum) fail(`must be < ${s.exclusiveMaximum}`);
  }
  if (isString(value)) {
    if (isNumber(s.minLength) && value.length < s.minLength) fail("is too short");
    if (isNumber(s.maxLength) && value.length > s.maxLength) fail("is too long");
    if (s.format === "uri" && !isUri(value)) fail("must be a URI");
  }
  if (Array.isArray(value)) {
    if (isNumber(s.minItems) && value.length < s.minItems) fail("has too few items");
    if (isNumber(s.maxItems) && value.length > s.maxItems) fail("has too many items");
    if (s.items !== undefined && !Array.isArray(s.items)) value.forEach((item, i) => check(document, `${name}[${i}]`, s.items, item, depth + 1));
  }
  if (isRecord(value)) {
    const properties = isRecord(s.properties) ? s.properties : {};
    for (const key of Array.isArray(s.required) ? s.required : []) if (value[key] === undefined) fail(`.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) check(document, `${name}.${key}`, properties[key], item, depth + 1);
      else if (s.additionalProperties === false) fail(`.${key} is not allowed`);
      else if (isRecord(s.additionalProperties)) check(document, `${name}.${key}`, s.additionalProperties, item, depth + 1);
    }
  }
}

/**
 * A validator for one realtime input message (source compileFalInput "realtime").
 * The returned function returns its input unchanged or throws a 400.
 */
export function compileFalRealtimeInput(definition) {
  const { schema, document } = falRealtimeInputSchema(definition);
  const properties = falRealtimeInputProperties(document, schema);
  const closed = (schema.additionalProperties === undefined || schema.additionalProperties === false) && Object.keys(properties).length > 0;
  return (input) => {
    if (!isRecord(input)) throw invalid("Invalid fal input: a realtime message must be an object");
    if (closed) {
      const unknown = Object.keys(input).filter((key) => !Object.hasOwn(properties, key));
      if (unknown.length) throw invalid(`Unsupported fal input: ${unknown.join(", ")}`);
    }
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (input[key] === undefined) throw invalid(`Invalid fal input: ${key} is required`);
    }
    for (const [key, value] of Object.entries(input)) {
      if (Object.hasOwn(properties, key)) check(document, key, properties[key], value, 0);
    }
    // Composition at the top level (allOf/anyOf/oneOf) is checked as a whole.
    if (schema.allOf || schema.anyOf || schema.oneOf) check(document, "input", { allOf: schema.allOf, anyOf: schema.anyOf, oneOf: schema.oneOf }, input, 0);
    return input;
  };
}
