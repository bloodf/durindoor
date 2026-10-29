/**
 * Normalize Chat/Anthropic tool schemas for Claude-bound `input_schema`.
 *
 * Shared by openai→claude, openai→commandcode, and prepareClaudeRequest so
 * every Claude-bound path applies the same rules (#1350 / #1352).
 */
import { isObject } from "../../../src/shared/utils/typeChecks.js";

const isPlainObject = (value) => value !== null && isObject(value) && !Array.isArray(value);

/**
 * Pick the first plain object among `parameters` / `input_schema`, then ensure
 * Claude-compatible object shape. Non-plain inputs fall back to a fresh
 * `{ type: "object", properties: {}, required: [] }`. Non-object typed schemas
 * (e.g. `{ type: "string" }`) pass through. Never mutates the caller's object.
 *
 * @param {unknown} parameters
 * @param {unknown} [inputSchema]
 * @returns {Record<string, unknown>}
 */
export function toClaudeInputSchema(parameters, inputSchema) {
  const schema = [parameters, inputSchema].find(isPlainObject);
  if (!schema) return { type: "object", properties: {}, required: [] };
  if (schema.type !== undefined && schema.type !== "object") return schema;
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
