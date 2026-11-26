/**
 * Argument validation for prompt-emulated tool calls, where nothing upstream
 * checks a call against the schema the client declared.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `open-sse/utils/toolArgumentSchema.ts`
 * at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
 *
 * The interpreted subset: type/integer, enum, object required/properties/
 * additionalProperties:false and homogeneous items. Not full JSON Schema;
 * unions and formats stay permissive.
 */
import { isRecord, isString, runtimeTypeName } from "../../src/shared/utils/typeChecks.js";

const record = (value) => isRecord(value) ? value : {};
const typeOf = (value) => Array.isArray(value) ? "array" : value === null ? "null" : runtimeTypeName(value);

function validateSchema(value, schema, path) {
  const errors = [];
  if (isString(schema.type)) {
    if (schema.type === "integer") {
      if (!Number.isInteger(value)) errors.push(`${path} must be integer`);
    } else if (typeOf(value) !== schema.type) {
      errors.push(`${path} must be ${schema.type}, got ${typeOf(value)}`);
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
    errors.push(`${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }
  if (schema.type === "object" || isRecord(value)) {
    const obj = record(value);
    const properties = record(schema.properties);
    for (const key of Array.isArray(schema.required) ? schema.required.map(String) : []) {
      if (!Object.hasOwn(obj, key)) errors.push(`${path}.${key} is required`);
    }
    for (const [key, propSchema] of Object.entries(properties)) {
      if (Object.hasOwn(obj, key)) errors.push(...validateSchema(obj[key], record(propSchema), `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => errors.push(...validateSchema(item, record(schema.items), `${path}[${index}]`)));
  }
  return errors;
}

/** True when `args` satisfies a tool's declared parameters. No parameters accepts anything. */
export const matchesToolSchema = (parameters, args) => validateSchema(args, record(parameters), "arguments").length === 0;
