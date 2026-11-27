// fal endpoint schema discovery for requests that carry `fal_input`.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/fal/compatibility.ts (prepareFalCompatibility: a
// connection-scoped definition store, else discovery with the selected key),
// open-sse/handlers/fal/client.ts (FalClient.discover and .definition: GET
// https://api.fal.ai/v1/models?endpoint_id=...&expand=openapi-3.0; `models`
// must be an array and `has_more` a boolean; the endpoint must be listed) and
// open-sse/handlers/fal/schema.ts (falInputSchema: OpenAPI 3.x, the POST
// operation at `/{endpoint_id}`, its application/json request schema with
// local `$ref`s; falInputProperties: properties merged across
// allOf/anyOf/oneOf; compileFalInput: unknown keys are refused unless
// `additionalProperties` is true, then the schema is validated).
//
// Fork deviations: the source validates with Ajv, which this package does not
// depend on. The local validator checks the subset below and nothing else:
// unknown keys, `required`, and per property `type`, `enum`, `const`,
// `minimum`/`maximum`, `exclusiveMinimum`/`exclusiveMaximum` (number form),
// `minLength`/`maxLength`, `minItems`/`maxItems`, through local `$ref`s and
// `allOf`. A property whose schema uses `anyOf`/`oneOf` is checked only by the
// alternatives' shared `type` when they agree. Discovery errors carry the HTTP
// status only, never the catalog body.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { FAL_CATALOG_ORIGIN } from "./config.js";
import { discard, falRead, readJsonObject } from "./transport.js";

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
const invalid = (message) => fail(HTTP_STATUS.BAD_REQUEST, message);

/** The catalog URL that describes one endpoint with its OpenAPI document. */
export function falDiscoveryUrl(endpoint) {
  const url = new URL("/v1/models", FAL_CATALOG_ORIGIN);
  url.searchParams.set("endpoint_id", endpoint);
  url.searchParams.set("expand", "openapi-3.0");
  return url.toString();
}

function localRef(document, ref) {
  if (!ref.startsWith("#/")) throw fail(502, "fal schema uses an external reference");
  let value = document;
  for (const key of ref.slice(2).split("/")) {
    value = isRecord(value) ? value[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
  }
  if (!isRecord(value)) throw fail(502, "fal schema has an unresolved reference");
  return value;
}

function resolve(document, schema, depth = 0) {
  if (depth > 16) throw fail(502, "fal schema references nest too deeply");
  if (!isRecord(schema)) return {};
  return isString(schema.$ref) ? resolve(document, localRef(document, schema.$ref), depth + 1) : schema;
}

/** Properties of an object schema, merged across allOf/anyOf/oneOf (source falInputProperties). */
export function falInputProperties(document, schema, seen = new Set()) {
  const resolved = resolve(document, schema);
  if (seen.has(resolved)) return {};
  seen.add(resolved);
  const properties = {};
  if (isRecord(resolved.properties)) Object.assign(properties, resolved.properties);
  for (const composition of ["allOf", "anyOf", "oneOf"]) {
    if (!Array.isArray(resolved[composition])) continue;
    for (const alternative of resolved[composition]) Object.assign(properties, falInputProperties(document, alternative, seen));
  }
  return properties;
}

/** The JSON input schema of the endpoint's POST operation (source falInputSchema, direct transport). */
export function falInputSchema(definition) {
  const openapi = definition.openapi;
  if (!isString(openapi.openapi) || !openapi.openapi.startsWith("3.")) throw fail(502, "fal endpoint has no usable OpenAPI schema");
  const paths = isRecord(openapi.paths) ? openapi.paths : {};
  const posts = Object.entries(paths).filter(([path, item]) => isRecord(item) && item.post && !path.includes("{request_id}"));
  const direct = posts.filter(([path]) => !path.endsWith("/stream"));
  const selected = posts.find(([path]) => path === `/${definition.endpoint_id}`) ?? (direct.length === 1 ? direct[0] : undefined);
  if (!selected) throw fail(502, "fal endpoint has no unambiguous input schema");
  const requestBody = resolve(openapi, selected[1].post.requestBody);
  const content = isRecord(requestBody.content) ? requestBody.content : {};
  const schema = resolve(openapi, content["application/json"]?.schema);
  if (!Object.keys(schema).length) throw fail(502, "fal endpoint has no JSON input schema");
  return schema;
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

function sharedType(document, alternatives) {
  const types = alternatives.map((item) => resolve(document, item).type);
  return types.length && types.every((type) => isString(type) && type === types[0]) ? types[0] : undefined;
}

function checkValue(document, name, schema, value) {
  const resolved = resolve(document, schema);
  for (const part of Array.isArray(resolved.allOf) ? resolved.allOf : []) checkValue(document, name, part, value);
  const type = resolved.type ?? sharedType(document, resolved.anyOf ?? resolved.oneOf ?? []);
  const types = Array.isArray(type) ? type : type === undefined ? [] : [type];
  if (resolved.nullable === true) types.push("null");
  if (types.length && !types.some((item) => TYPE_CHECKS[item]?.(value))) throw invalid(`Invalid fal input: ${name} must be ${types.join(" or ")}`);
  if (Array.isArray(resolved.enum) && !resolved.enum.some((item) => item === value)) throw invalid(`Invalid fal input: ${name} is not an allowed value`);
  if (resolved.const !== undefined && resolved.const !== value) throw invalid(`Invalid fal input: ${name} is not the allowed value`);
  if (isNumber(value)) {
    if (isNumber(resolved.minimum) && value < resolved.minimum) throw invalid(`Invalid fal input: ${name} must be >= ${resolved.minimum}`);
    if (isNumber(resolved.maximum) && value > resolved.maximum) throw invalid(`Invalid fal input: ${name} must be <= ${resolved.maximum}`);
    if (isNumber(resolved.exclusiveMinimum) && value <= resolved.exclusiveMinimum) throw invalid(`Invalid fal input: ${name} must be > ${resolved.exclusiveMinimum}`);
    if (isNumber(resolved.exclusiveMaximum) && value >= resolved.exclusiveMaximum) throw invalid(`Invalid fal input: ${name} must be < ${resolved.exclusiveMaximum}`);
  }
  if (isString(value)) {
    if (isNumber(resolved.minLength) && value.length < resolved.minLength) throw invalid(`Invalid fal input: ${name} is too short`);
    if (isNumber(resolved.maxLength) && value.length > resolved.maxLength) throw invalid(`Invalid fal input: ${name} is too long`);
  }
  if (Array.isArray(value)) {
    if (isNumber(resolved.minItems) && value.length < resolved.minItems) throw invalid(`Invalid fal input: ${name} has too few items`);
    if (isNumber(resolved.maxItems) && value.length > resolved.maxItems) throw invalid(`Invalid fal input: ${name} has too many items`);
  }
}

/**
 * Validate `input` against the endpoint's discovered schema, without
 * defaults, coercion, clamping or field removal (source compileFalInput).
 *
 * @returns {object} `input`, unchanged
 * @throws {Error} with `status` 400 naming the first problem
 */
export function validateFalInput(definition, input) {
  const document = definition.openapi;
  const schema = falInputSchema(definition);
  const properties = falInputProperties(document, schema);
  if ((schema.additionalProperties === undefined || schema.additionalProperties === false) && Object.keys(properties).length) {
    const unknown = Object.keys(input).filter((key) => !Object.hasOwn(properties, key));
    if (unknown.length) throw invalid(`Unsupported fal input: ${unknown.join(", ")}`);
  }
  for (const name of Array.isArray(schema.required) ? schema.required : []) {
    if (input[name] === undefined) throw invalid(`Invalid fal input: ${name} is required`);
  }
  for (const [name, value] of Object.entries(input)) {
    if (Object.hasOwn(properties, name)) checkValue(document, name, properties[name], value);
  }
  return input;
}

/**
 * Discover one endpoint's definition with the selected key (source
 * FalClient.definition). Nothing billable is sent.
 *
 * @returns {Promise<{ endpoint_id: string, metadata?: object, openapi: object }>}
 * @throws {Error} with an HTTP `status`; the caller's abort reason on abort
 */
export async function discoverFalDefinition(endpoint, { token, signal, timeoutMs, proxyOptions, wait, now }) {
  let response;
  try {
    response = await falRead(falDiscoveryUrl(endpoint), { token, signal, timeoutMs, proxyOptions, wait, now });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw fail(error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY, `fal schema discovery ${error?.name === "TimeoutError" ? "timed out" : "failed"}`);
  }
  if (!response.ok) {
    discard(response);
    const status = [401, 403, 404, 429].includes(response.status) ? response.status : HTTP_STATUS.BAD_GATEWAY;
    throw Object.assign(fail(status, `fal schema discovery failed (${response.status})`), { retryAfter: response.headers.get("retry-after") ?? undefined });
  }
  const page = await readJsonObject(response, { signal, timeoutMs: Math.max(1, timeoutMs()), maxBytes: MAX_CATALOG_BYTES });
  if (!page || !Array.isArray(page.models) || !isBoolean(page.has_more) || (page.has_more && !isString(page.next_cursor))) {
    throw fail(HTTP_STATUS.BAD_GATEWAY, "Incomplete fal catalog response");
  }
  const model = page.models.find((item) => isRecord(item) && item.endpoint_id === endpoint);
  if (!model) throw fail(HTTP_STATUS.NOT_FOUND, "fal endpoint was not discovered");
  const definition = { ...model, endpoint_id: endpoint, openapi: isRecord(model.openapi) ? model.openapi : {} };
  falInputSchema(definition);
  return definition;
}

/**
 * The validated fal input for a `fal_input` request: a connection-scoped
 * cached definition when the store has one, else discovery (source
 * prepareFalCompatibility). The definition is saved for this connection only.
 */
export async function prepareFalMusicInput({ endpoint, body, buildInput, credentials, store, ...read }) {
  const connectionId = isString(credentials?.connectionId) ? credentials.connectionId : null;
  const cached = connectionId && store ? store.get(connectionId, endpoint) : null;
  const definition = cached ?? (await discoverFalDefinition(endpoint, read));
  if (!cached && connectionId && store) store.save(connectionId, definition);
  const properties = falInputProperties(definition.openapi, falInputSchema(definition));
  return validateFalInput(definition, buildInput(body, properties));
}
