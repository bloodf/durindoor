import { describe, expect, it } from "vitest";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest
} from "../../open-sse/translator/request/openai-responses.js";

/**
 * Responses → Chat tool schema handling (OmniRoute #18806, pinned 47a52e1).
 *
 * The client declares tools in Responses shape; the Chat upstream receives
 * `tools[].function.parameters`. A valid schema must survive that hop intact
 * (object shape, `required` list, strict intent, annotation metadata), while
 * the invalid constructs a deep-truncating harness emits must not reach a
 * strict validator.
 */

const USER_INPUT = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];

function translateToChat(tools) {
  const result = openaiResponsesToOpenAIRequest("model", { input: USER_INPUT, tools }, false, {});
  return result.tools;
}

/** Every value found under an `enum` key, at any depth. */
function collectEnums(value, found = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectEnums(entry, found);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "enum") found.push(entry);
      collectEnums(entry, found);
    }
  }
  return found;
}

// The deep-truncated shape a harness sends when it cannot serialize a schema.
const truncatedSchema = {
  type: "object",
  properties: {
    target: {
      anyOf: [
        {
          type: "object",
          properties: {
            type: { type: "string", enum: "[MaxDepth]" },
            mode: { type: "string", enum: ["fast", "slow"] }
          }
        },
        { type: "null" }
      ]
    }
  }
};

describe("Responses to Chat tool schemas", () => {
  it("keeps a valid tool schema, its strict intent and its metadata intact", () => {
    const parameters = {
      type: "object",
      title: "Open file",
      properties: {
        path: { type: "string", description: "File path" },
        mode: { type: "string", enum: ["read", "write"] },
        options: { type: "object", additionalProperties: false, properties: {} }
      },
      required: ["path"],
      additionalProperties: false
    };
    const tools = translateToChat([
      { type: "function", name: "open_file", description: "Reads a file", strict: true, parameters }
    ]);

    expect(tools).toHaveLength(1);
    expect(tools[0].function.parameters).toEqual(parameters);
    expect(tools[0].function.strict).toBe(true);
    expect(tools[0].function.description).toBe("Reads a file");
    expect(tools[0].function.name).toBe("open_file");
  });

  it("drops a string-valued enum and keeps the valid sibling enum", () => {
    const [tool] = translateToChat([{ type: "function", name: "create_thread", parameters: truncatedSchema }]);

    expect(collectEnums(tool.function.parameters)).toEqual([["fast", "slow"]]);
  });

  it("sanitizes namespace (MCP) sub-tool schemas too", () => {
    const [tool] = translateToChat([
      { type: "namespace", name: "mcp__codex_app", tools: [{ name: "create_thread", parameters: truncatedSchema }] }
    ]);

    expect(tool.function.name).toBe("mcp__codex_app.create_thread");
    expect(collectEnums(tool.function.parameters)).toEqual([["fast", "slow"]]);
  });

  it("coerces an index-keyed enum object to an array", () => {
    const [tool] = translateToChat([
      {
        type: "function",
        name: "pick",
        parameters: { type: "object", properties: { choice: { type: "string", enum: { 0: "a", 1: "b" } } } }
      }
    ]);

    expect(collectEnums(tool.function.parameters)).toEqual([["a", "b"]]);
  });

  it("repairs a tool that already arrives in Chat shape", () => {
    const [tool] = translateToChat([
      {
        type: "function",
        function: { name: "pick", parameters: { type: "object", properties: { choice: { type: "string", enum: "[MaxDepth]" } } } }
      }
    ]);

    expect(collectEnums(tool.function.parameters)).toEqual([]);
  });

  it("coerces numeric-string constraints in every schema position", () => {
    const [tool] = translateToChat([
      {
        type: "function",
        name: "measure",
        parameters: {
          type: "object",
          properties: { size: { type: "number", minimum: "5" } },
          contains: { type: "number", minimum: "5" }
        }
      }
    ]);

    expect(tool.function.parameters.properties.size.minimum).toBe(5);
    expect(tool.function.parameters.contains.minimum).toBe(5);
  });

  it("replaces a placeholder in a schema slot and keeps boolean subschemas", () => {
    const [tool] = translateToChat([
      {
        type: "function",
        name: "lock",
        parameters: {
          type: "object",
          properties: {
            list: { type: "array", items: "[MaxDepth]" },
            onlyAdmin: false
          },
          additionalProperties: false
        }
      }
    ]);

    expect(tool.function.parameters.properties.list.items).toEqual({});
    expect(tool.function.parameters.properties.onlyAdmin).toBe(false);
    expect(tool.function.parameters.additionalProperties).toBe(false);
  });

  it("drops a truncated const assertion and keeps a real one", () => {
    const [tool] = translateToChat([
      {
        type: "function",
        name: "pin",
        parameters: {
          type: "object",
          properties: {
            truncated: { const: "[MaxDepth]" },
            real: { const: "fixed" }
          }
        }
      }
    ]);

    expect(tool.function.parameters.properties.truncated).toEqual({});
    expect(tool.function.parameters.properties.real).toEqual({ const: "fixed" });
  });

  it("does not mutate the caller's schema object", () => {
    const parameters = { type: "object", properties: { choice: { type: "string", enum: "[MaxDepth]" } } };
    translateToChat([{ type: "function", name: "pick", parameters }]);

    expect(parameters.properties.choice.enum).toBe("[MaxDepth]");
  });

  it("leaves the Chat to Responses route on its own schema handling", () => {
    const parameters = { type: "object", properties: { choice: { type: "string", enum: "[MaxDepth]" } } };
    const result = openaiToOpenAIResponsesRequest("model", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "pick", parameters } }]
    }, false, {});

    expect(result.tools[0].parameters.properties.choice.enum).toBe("[MaxDepth]");
  });
});
