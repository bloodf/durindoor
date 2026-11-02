/**
 * #1352 — every Claude-bound tool-schema path shares one normalizer.
 *
 * Covers openai→claude, openai→commandcode, and prepareClaudeRequest's
 * OpenAI-function fold. Cases match #1350/#1351 plus `properties: null`.
 */
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { isObject } from "../../src/shared/utils/typeChecks.js";

const DEFAULT = { type: "object", properties: {}, required: [] };
const VALID = {
  type: "object",
  properties: { q: { type: "string" } },
  additionalProperties: false,
};

const isPlainObject = (value) => value !== null && isObject(value) && !Array.isArray(value);

/** @type {Array<{ label: string, parameters: unknown, expected: object }>} */
const CASES = [
  { label: "missing", parameters: undefined, expected: DEFAULT },
  { label: "null", parameters: null, expected: DEFAULT },
  { label: "empty array", parameters: [], expected: DEFAULT },
  { label: "non-empty array", parameters: [{ a: 1 }], expected: DEFAULT },
  { label: "string", parameters: "x", expected: DEFAULT },
  { label: "number", parameters: 5, expected: DEFAULT },
  { label: "empty object", parameters: {}, expected: { type: "object", properties: {} } },
  { label: "type-only object", parameters: { type: "object" }, expected: { type: "object", properties: {} } },
  {
    label: "properties null",
    parameters: { type: "object", properties: null },
    expected: { type: "object", properties: {} },
  },
  { label: "valid schema", parameters: VALID, expected: VALID },
];

function openaiClaudeSchema(parameters) {
  const tool = { type: "function", function: { name: "lookup" } };
  if (parameters !== undefined) tool.function.parameters = parameters;
  return translateRequest(
    FORMATS.OPENAI,
    FORMATS.CLAUDE,
    "m",
    { tools: [tool] },
    true,
    null,
    "anthropic-compatible-x"
  ).tools[0].input_schema;
}

function commandcodeSchema(parameters) {
  const tool = { type: "function", function: { name: "lookup" } };
  if (parameters !== undefined) tool.function.parameters = parameters;
  const out = translateRequest(
    FORMATS.OPENAI,
    FORMATS.COMMANDCODE,
    "m",
    { messages: [{ role: "user", content: "hi" }], tools: [tool] },
    true,
    null,
    "commandcode"
  );
  return out.params.tools[0].input_schema;
}

function prepareSchema(parameters) {
  const fn = { name: "lookup", description: "d" };
  if (parameters !== undefined) fn.parameters = parameters;
  // Non-native provider so prepareClaudeRequest folds function → input_schema.
  const out = prepareClaudeRequest(
    {
      model: "m",
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: fn }],
    },
    "openai"
  );
  return out.tools[0].input_schema;
}

describe.each([
  { path: "openai-to-claude", extract: openaiClaudeSchema },
  { path: "openai-to-commandcode", extract: commandcodeSchema },
  { path: "prepareClaudeRequest", extract: prepareSchema },
])("Claude tool schema normalizer via $path (#1352)", ({ extract }) => {
  it.each(CASES)("$label → expected schema", ({ parameters, expected }) => {
    const input = isPlainObject(parameters) ? structuredClone(parameters) : parameters;
    const original = isPlainObject(input) ? structuredClone(input) : input;

    expect(extract(input)).toEqual(expected);

    if (isPlainObject(original)) {
      expect(input).toEqual(original);
    }
  });
});
