// fal endpoint schema discovery and the compatibility body for any fal video
// endpoint other than the three built-in models.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/fal/client.ts (FalClient.discover and .definition: GET
// https://api.fal.ai/v1/models?endpoint_id=…&expand=openapi-3.0, the
// `models` / `has_more` / `next_cursor` page check, at most two bounded
// Retry-After retries of a 429 or 503 read), open-sse/handlers/fal/schema.ts
// (falInputSchema, falInputProperties, resolveFalSchema, falCompatibilityInput,
// mapMediaReferences, mapFalSize, FAL_OPTIONAL_CONTROLS) and
// open-sse/handlers/fal/compatibility.ts (prepareFalCompatibility and its
// connection-scoped definition store).
//
// Fork deviations: the source compiles the discovered schema with Ajv. That
// package is not a dependency here, so this module checks a documented subset
// of each top-level property before submit: undocumented fields, required
// fields, the JSON type, `enum`/`const`, and numeric and length bounds (local
// `$ref`s and `allOf`/`anyOf`/`oneOf` resolved, `nullable` honored). Deeper
// constraints are left to fal, which refuses them with 422 before it bills.
// The discovered endpoint must
// be a video endpoint (metadata.category ends in `video`) with a queue
// status path. `n` other than 1, `mask`, `image(s)` and `stream` are
// refused rather than mapped or dropped. A cached definition belongs to the
// connection that discovered it and is never shared with another.
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { FAL_API_ORIGIN, canonicalFalEndpoint } from "./config.js";
import { badRequest, falAspectRatio, falImageReference } from "./request.js";

const record = (value) => (isRecord(value) && !Array.isArray(value) ? value : {});

// schema.ts FAL_OPTIONAL_CONTROLS: dropped when the endpoint does not document them.
const OPTIONAL_CONTROLS = new Set(["quality", "style", "user", "sync_mode"]);
// The OpenAI envelope, never forwarded as fal input.
const ENVELOPE = new Set(["model", "response_format", "fal_input", "size", "n", "stream", "image", "images", "mask"]);
const MAX_SCHEMA_DEPTH = 32;

function localRef(document, ref) {
  if (!ref.startsWith("#/")) throw badRequest("The fal endpoint schema uses an external reference");
  let value = document;
  for (const key of ref.slice(2).split("/")) value = record(value)[key.replace(/~1/g, "/").replace(/~0/g, "~")];
  if (value === undefined) throw badRequest("The fal endpoint schema has an unresolved reference");
  return value;
}

function resolve(document, schema, depth = 0) {
  let current = record(schema);
  while (isString(current.$ref)) {
    if (++depth > MAX_SCHEMA_DEPTH) throw badRequest("The fal endpoint schema is too deeply nested");
    current = record(localRef(document, current.$ref));
  }
  return current;
}

function inputProperties(document, schema, seen = new Set(), depth = 0) {
  if (seen.has(schema) || depth > MAX_SCHEMA_DEPTH) return {};
  seen.add(schema);
  const resolved = resolve(document, schema);
  const properties = { ...record(resolved.properties) };
  for (const composition of ["allOf", "anyOf", "oneOf"]) {
    if (!Array.isArray(resolved[composition])) continue;
    for (const alternative of resolved[composition]) Object.assign(properties, inputProperties(document, record(alternative), seen, depth + 1));
  }
  return properties;
}

function requiredFields(document, schema) {
  const resolved = resolve(document, schema);
  const required = new Set(Array.isArray(resolved.required) ? resolved.required.filter(isString) : []);
  for (const part of Array.isArray(resolved.allOf) ? resolved.allOf : []) {
    for (const name of requiredFields(document, record(part))) required.add(name);
  }
  return [...required];
}

/** The queue input schema of a discovered definition (schema.ts falInputSchema, direct/queue). */
export function falVideoInputSchema(definition) {
  canonicalFalEndpoint(definition.endpoint_id);
  const openapi = record(definition.openapi);
  if (!String(openapi.openapi ?? "").startsWith("3.")) throw badRequest("The fal endpoint has no usable OpenAPI schema");
  const posts = Object.entries(record(openapi.paths)).filter(([path, item]) => record(item).post && !path.includes("{request_id}"));
  const plain = posts.filter(([path]) => !path.endsWith("/stream"));
  const selected = posts.find(([path]) => path === `/${definition.endpoint_id}`) ?? (plain.length === 1 ? plain[0] : undefined);
  if (!selected) throw badRequest("The fal endpoint has no unambiguous input schema");
  const requestBody = resolve(openapi, record(record(selected[1]).post).requestBody);
  const schema = resolve(openapi, record(record(record(requestBody.content)["application/json"]).schema));
  if (Object.keys(schema).length === 0) throw badRequest("The fal endpoint has no JSON input schema");
  return { path: selected[0], schema, properties: inputProperties(openapi, schema), required: requiredFields(openapi, schema) };
}

/** Throws a 400 error unless the definition is a queued fal video endpoint. */
export function assertFalVideoDefinition(definition) {
  const category = record(definition.metadata).category;
  if (!isString(category) || !/(^|-)video$/.test(category)) {
    throw badRequest("This fal endpoint does not generate video; use the matching media route");
  }
  const paths = Object.keys(record(record(definition.openapi).paths));
  if (!paths.some((path) => path.includes("{request_id}/status"))) throw badRequest("This fal endpoint has no queue status path");
  return falVideoInputSchema(definition);
}

const TYPE_CHECKS = {
  string: isString,
  number: (value) => isNumber(value) && Number.isFinite(value),
  integer: Number.isInteger,
  boolean: isBoolean,
  array: Array.isArray,
  object: (value) => isRecord(value) && !Array.isArray(value),
  null: (value) => value === null,
};

function propertyErrors(document, name, rawSchema, value) {
  const schema = resolve(document, rawSchema);
  const alternatives = [...(Array.isArray(schema.anyOf) ? schema.anyOf : []), ...(Array.isArray(schema.oneOf) ? schema.oneOf : [])];
  if (alternatives.length) {
    const fits = alternatives.some((alternative) => propertyErrors(document, name, record(alternative), value).length === 0);
    if (!fits) return [`${name} does not match any documented form`];
  }
  for (const part of Array.isArray(schema.allOf) ? schema.allOf : []) {
    const errors = propertyErrors(document, name, record(part), value);
    if (errors.length) return errors;
  }
  if (value === null && schema.nullable === true) return [];
  const types = Array.isArray(schema.type) ? schema.type : isString(schema.type) ? [schema.type] : [];
  if (types.length && !types.some((type) => TYPE_CHECKS[type]?.(value))) return [`${name} must be ${types.join(" or ")}`];
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => option === value)) {
    return [`${name} must be one of: ${schema.enum.slice(0, 20).join(", ")}`];
  }
  if (schema.const !== undefined && schema.const !== value) return [`${name} must be ${schema.const}`];
  if (isNumber(value)) {
    if (isNumber(schema.minimum) && value < schema.minimum) return [`${name} must be at least ${schema.minimum}`];
    if (isNumber(schema.maximum) && value > schema.maximum) return [`${name} must be at most ${schema.maximum}`];
    if (isNumber(schema.exclusiveMinimum) && value <= schema.exclusiveMinimum) return [`${name} must be above ${schema.exclusiveMinimum}`];
    if (isNumber(schema.exclusiveMaximum) && value >= schema.exclusiveMaximum) return [`${name} must be below ${schema.exclusiveMaximum}`];
  }
  if (isString(value)) {
    if (isNumber(schema.minLength) && value.length < schema.minLength) return [`${name} is too short`];
    if (isNumber(schema.maxLength) && value.length > schema.maxLength) return [`${name} is too long`];
  }
  if (Array.isArray(value)) {
    if (isNumber(schema.minItems) && value.length < schema.minItems) return [`${name} needs at least ${schema.minItems} items`];
    if (isNumber(schema.maxItems) && value.length > schema.maxItems) return [`${name} takes at most ${schema.maxItems} items`];
  }
  return [];
}

/** Throws a 400 error naming the first fields the endpoint schema refuses. */
export function validateFalVideoInput(definition, input) {
  const { schema, properties, required } = falVideoInputSchema(definition);
  const document = record(definition.openapi);
  const closed = schema.additionalProperties === undefined || schema.additionalProperties === false;
  if (closed && Object.keys(properties).length > 0) {
    const unknown = Object.keys(input).filter((key) => !Object.hasOwn(properties, key));
    if (unknown.length) throw badRequest(`Unsupported fal input: ${unknown.slice(0, 10).join(", ")}`);
  }
  const missing = required.filter((name) => input[name] === undefined);
  if (missing.length) throw badRequest(`Missing fal input: ${missing.slice(0, 10).join(", ")}`);
  const errors = Object.entries(input)
    .filter(([key]) => Object.hasOwn(properties, key))
    .flatMap(([key, value]) => propertyErrors(document, key, properties[key], value));
  if (errors.length) throw badRequest(`Invalid fal input: ${errors.slice(0, 5).join("; ")}`);
  return input;
}

/**
 * The submit body for a discovered endpoint (schema.ts falCompatibilityInput).
 * Compatibility names are mapped only when the endpoint documents their target.
 */
export function falVideoCompatibilityInput(body, definition) {
  const { properties } = falVideoInputSchema(definition);
  const input = {};
  for (const [key, value] of Object.entries(body)) {
    if (ENVELOPE.has(key)) continue;
    if (Object.hasOwn(properties, key) || !OPTIONAL_CONTROLS.has(key)) input[key] = value;
  }
  // mapMediaReferences, image only: the caller's image list goes where the endpoint documents it.
  if (body.image_urls !== undefined && !Object.hasOwn(properties, "image_urls")) {
    if (!Array.isArray(body.image_urls)) throw badRequest("image_urls must be an array of image URLs");
    if (Object.hasOwn(properties, "reference_image_urls")) {
      input.reference_image_urls = body.image_urls;
    } else if (Object.hasOwn(properties, "image_url")) {
      if (body.image_urls.length !== 1) throw badRequest("This fal endpoint supports exactly one image reference");
      input.image_url = body.image_urls[0];
    }
    delete input.image_urls;
  }
  // mapFalSize, video endpoints: only an aspect_ratio target exists here.
  if (body.size !== undefined) {
    if (!Object.hasOwn(properties, "aspect_ratio")) throw badRequest("This fal endpoint does not support size; use fal_input");
    input.aspect_ratio ??= falAspectRatio({ size: body.size });
  }
  if (body.fal_input !== undefined && !(isRecord(body.fal_input) && !Array.isArray(body.fal_input))) {
    throw badRequest("fal_input must be an object");
  }
  const merged = { ...input, ...record(body.fal_input) };
  // fal fetches these, so they get the same public-URL rule as the built-in models.
  for (const key of ["image_url", "end_image_url", "first_frame_url", "last_frame_url"]) {
    if (isString(merged[key])) merged[key] = falImageReference(merged[key], key);
  }
  for (const key of ["image_urls", "reference_image_urls"]) {
    if (Array.isArray(merged[key])) merged[key] = merged[key].map((value, i) => falImageReference(value, `${key}[${i}]`));
  }
  return validateFalVideoInput(definition, merged);
}

/**
 * Discover one endpoint's OpenAPI definition (FalClient.definition), using
 * the caller's fetch helper for transport. `getJson(url)` must return the
 * parsed catalog page or throw.
 */
export async function discoverFalVideoDefinition(endpoint, getJson) {
  const id = canonicalFalEndpoint(endpoint);
  const query = new URLSearchParams({ endpoint_id: id, expand: "openapi-3.0" });
  const page = record(await getJson(`${FAL_API_ORIGIN}/v1/models?${query}`));
  if (!Array.isArray(page.models) || !isBoolean(page.has_more) || (page.has_more && !isString(page.next_cursor))) {
    throw Object.assign(new Error("fal returned an incomplete model catalog"), { status: 502 });
  }
  const model = page.models.find((item) => record(item).endpoint_id === id);
  if (!model) throw Object.assign(new Error("fal did not list this endpoint"), { status: 404 });
  const definition = { ...record(model), endpoint_id: id, openapi: record(record(model).openapi) };
  assertFalVideoDefinition(definition);
  return definition;
}
