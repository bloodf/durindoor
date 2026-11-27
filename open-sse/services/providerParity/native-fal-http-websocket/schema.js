// HTTP-WebSocket input validation: the endpoint's ordinary (direct) HTTP
// input schema, never the realtime one.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// src/app/api/v1/fal/run/route.ts (an `http-websocket` request validates its
// input with compileFalInput(definition, "direct")) and
// open-sse/handlers/fal/schema.ts (falInputSchema "direct": among the POST
// operations whose path has no `{request_id}`, the one at `/{endpoint_id}`,
// else the only one not ending in `/stream`; its requestBody and
// `application/json` schema are resolved through one local `$ref` each;
// compileFalInput refuses unknown top-level keys unless
// `additionalProperties` is true and never mutates the input).
//
// Fork deviation: the source compiles with Ajv. Here the selected schema is
// handed, read-only, to the realtime bundle's validator by wrapping it as an
// `x-fal-realtime.input_schema` override, so both transports share one
// validator and its documented JSON Schema subset (see
// ../native-fal-realtime/schema.js).
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { FalRealtimeError, compileFalRealtimeInput } from "../native-fal-realtime/schema.js";
import { canonicalFalEndpoint } from "./endpoint.js";

const invalid = (message) => new FalRealtimeError(message, 400);

function localRef(document, ref) {
  if (!ref.startsWith("#/")) throw invalid("External schema references are unsupported");
  let value = document;
  for (const key of ref.slice(2).split("/")) value = isRecord(value) ? value[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
  if (value === undefined) throw invalid("Unresolved fal schema reference");
  return value;
}

// One level of `$ref`, as the source's resolveFalSchema.
function resolveOnce(document, schema) {
  if (!isRecord(schema)) return {};
  if (!isString(schema.$ref)) return schema;
  const target = localRef(document, schema.$ref);
  return isRecord(target) ? target : {};
}

/** `{ path, schema }` of the endpoint's direct HTTP input (source falInputSchema "direct"). */
export function falHttpInputSchema(definition) {
  if (!isRecord(definition) || !isRecord(definition.openapi)) throw invalid("A fal definition needs an OpenAPI document");
  const endpoint = canonicalFalEndpoint(definition.endpoint_id);
  const paths = isRecord(definition.openapi.paths) ? definition.openapi.paths : {};
  const posts = Object.entries(paths).filter(([path, item]) => isRecord(item) && item.post && !path.includes("{request_id}"));
  const candidates = posts.filter(([path]) => !path.endsWith("/stream"));
  const operation = `/${endpoint}`;
  const selected = posts.find(([path]) => path === operation) ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!selected) throw invalid("No unambiguous direct input schema for this endpoint");
  const post = isRecord(selected[1].post) ? selected[1].post : {};
  const requestBody = resolveOnce(definition.openapi, post.requestBody);
  const content = isRecord(requestBody.content) ? requestBody.content : {};
  const json = isRecord(content["application/json"]) ? content["application/json"] : {};
  const schema = resolveOnce(definition.openapi, json.schema);
  if (Object.keys(schema).length === 0) throw invalid("Missing fal JSON input schema");
  return { path: selected[0], schema };
}

/**
 * A validator for one HTTP-WebSocket input (source compileFalInput "direct").
 * The returned function returns its input unchanged or throws a 400.
 */
export function compileFalHttpWebsocketInput(definition) {
  const { schema } = falHttpInputSchema(definition);
  const endpoint = canonicalFalEndpoint(definition.endpoint_id);
  // The realtime validator resolves `$ref`s against the OpenAPI document with
  // `components` taken from the schema when it carries its own.
  const wrapped = {
    endpoint_id: endpoint,
    openapi: { ...definition.openapi, "x-fal-realtime": { path: "/realtime", input_schema: schema } },
  };
  const validate = compileFalRealtimeInput(wrapped);
  return (input) => {
    if (!isRecord(input)) throw invalid("Invalid fal input: an HTTP input must be an object");
    return validate(input);
  };
}
