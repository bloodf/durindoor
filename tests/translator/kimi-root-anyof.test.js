/**
 * Regression (diegosouzapw/OmniRoute 99d19f8f3, #10079): Kimi/Moonshot's
 * OpenAI-compatible endpoints reject a root tool-schema anyOf. Strip only that
 * root combinator on Kimi-family OpenAI transports; nested combinators remain.
 */
import { describe, expect, it } from "vitest";
import { normalizeToolSchemaRoots } from "../../open-sse/translator/validate.js";

const rootSchema = () => ({
  anyOf: [{ type: "object", properties: { path: { type: "string" } } }],
  properties: {
    path: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
  required: ["path"],
});

const normalizeKimiOpenAI = (body) =>
  normalizeToolSchemaRoots(body, { provider: "kimi", transportFormat: "openai" });

describe("Kimi OpenAI tool schema normalization (#10079)", () => {
  it("removes only root anyOf from Chat Completions function parameters", () => {
    const body = {
      tools: [{ type: "function", function: { name: "read", parameters: rootSchema() } }],
    };

    normalizeKimiOpenAI(body);

    const parameters = body.tools[0].function.parameters;
    expect(parameters).toMatchObject({
      type: "object",
      properties: { path: { anyOf: [{ type: "string" }, { type: "null" }] } },
      required: ["path"],
    });
    expect(parameters).not.toHaveProperty("anyOf");
  });

  it("removes only root anyOf from flattened Responses parameters", () => {
    const body = {
      tools: [{ type: "function", name: "read", parameters: rootSchema() }],
    };

    normalizeKimiOpenAI(body);

    const parameters = body.tools[0].parameters;
    expect(parameters.type).toBe("object");
    expect(parameters).not.toHaveProperty("anyOf");
    expect(parameters.properties.path.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
  });

  it("applies same root-only normalization to kimi-coding", () => {
    const body = {
      tools: [{ type: "function", function: { name: "read", parameters: rootSchema() } }],
    };

    normalizeToolSchemaRoots(body, { provider: "kimi-coding", transportFormat: "openai" });

    expect(body.tools[0].function.parameters).toMatchObject({ type: "object", required: ["path"] });
    expect(body.tools[0].function.parameters).not.toHaveProperty("anyOf");
  });

  it("preserves other root combinators on Kimi OpenAI", () => {
    const body = {
      tools: [{ type: "function", function: { name: "read", parameters: { oneOf: [{ type: "object" }] } } }],
    };
    const before = JSON.stringify(body);

    normalizeKimiOpenAI(body);

    expect(JSON.stringify(body)).toBe(before);
  });

  it("leaves non-Kimi OpenAI schemas byte-equivalent", () => {
    const body = {
      tools: [{ type: "function", function: { name: "read", parameters: rootSchema() } }],
    };
    const before = JSON.stringify(body);

    normalizeToolSchemaRoots(body, { provider: "openai", transportFormat: "openai" });

    expect(JSON.stringify(body)).toBe(before);
  });

  it("leaves Kimi Claude schemas byte-equivalent", () => {
    const body = {
      tools: [{ type: "function", function: { name: "read", parameters: rootSchema() } }],
    };
    const before = JSON.stringify(body);

    normalizeToolSchemaRoots(body, { provider: "kimi", transportFormat: "claude" });

    expect(JSON.stringify(body)).toBe(before);
  });
});
