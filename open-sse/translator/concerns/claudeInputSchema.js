/**
 * Normalize Chat/Anthropic tool schemas for Claude-bound `input_schema`.
 *
 * Shared by openai→claude, openai→commandcode, and prepareClaudeRequest so
 * every Claude-bound path applies the same rules (#1350 / #1352).
 */
import { isObject } from "../../../src/shared/utils/typeChecks.js";
import { invalidToolSchemaError, normalizeToolSchema } from "./toolSchema.js";

const isPlainObject = (value) => value !== null && isObject(value) && !Array.isArray(value);

/**
 * Pick the first plain object among `parameters` / `input_schema`, then ensure
 * Claude-compatible object shape. Non-plain inputs fall back to a fresh
 * `{ type: "object", properties: {}, required: [] }`. Non-object typed schemas
 * (e.g. `{ type: "string" }`) are rejected with HTTP 400 naming the tool, since
 * Anthropic requires `type:"object"` (#1353); malformed schemas are rejected and
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
  if (picked.type !== undefined && picked.type !== "object") {
    throw invalidToolSchemaError(toolName, `Claude requires an object input_schema, got type ${JSON.stringify(picked.type)}`);
  }
  const schema = normalizeToolSchema(picked, toolName);
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
