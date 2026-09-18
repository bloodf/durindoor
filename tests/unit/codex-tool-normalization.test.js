import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";

function normalizeTools(tools) {
  const executor = new CodexExecutor();
  const body = {
    model: "gpt-5.5",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "probe" }] }],
    tools,
    stream: true,
  };

  executor.transformRequest("gpt-5.5", body, true, {
    connectionId: "test-codex-tools",
    providerSpecificData: {},
  });

  return body.tools;
}

describe("CodexExecutor tool normalization", () => {
  it.each([true, false])("preserves explicit strict=%s for flat and nested function tools", (strict) => {
    const parameters = { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false };
    for (const tool of [
      { type: "function", name: "Monitor", parameters, strict },
      { type: "function", function: { name: "Monitor", parameters, strict } },
    ]) {
      expect(normalizeTools([structuredClone(tool)])[0]).toMatchObject({ strict, parameters });
    }
  });

  it("leaves unspecified strict unchanged on native Responses tools", () => {
    expect(normalizeTools([{ type: "function", name: "native", parameters: { type: "object", properties: {} } }])[0]).not.toHaveProperty("strict");
  });

  it.each([undefined, false, true])("keeps Monitor optional inputs across Claude to Codex with strict=%s", (strict) => {
    const schema = {
      type: "object",
      properties: {
        description: { type: "string" },
        command: { type: "string" },
        ws: { type: "object", properties: { url: { type: "string" }, protocols: { type: "array", items: { type: "string" } } }, required: ["url"] },
      },
      required: ["description"],
    };
    const tool = { name: "Monitor", description: "Use exactly one of command or ws", input_schema: schema };
    if (strict !== undefined) tool.strict = strict;
    const request = translateRequest("claude", "openai-responses", "gpt-5.5", {
      messages: [{ role: "user", content: "Monitor using a command only" }],
      tools: [tool],
    }, true, {}, "codex");
    const [out] = normalizeTools(request.tools);
    expect(out.strict).toBe(strict ?? false);
    expect(out.parameters).toEqual(schema);
    expect(out.parameters.required).not.toContain("ws");
  });

  it("preserves non-strict Chat Completions defaults when translating to Responses", () => {
    const request = translateRequest("openai", "openai-responses", "gpt-5.5", {
      messages: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", function: { name: "optional", parameters: { type: "object", properties: { value: { type: "string" } } } } }],
    }, true, {}, "codex");
    expect(normalizeTools(request.tools)[0].strict).toBe(false);
  });

  it("preserves Responses text.format for structured outputs", () => {
    const executor = new CodexExecutor();
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
    };
    const body = {
      model: "gpt-5.4-mini",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "test for session title" }] }],
      stream: true,
      metadata: { unsupported: true },
      text: {
        format: {
          type: "json_schema",
          name: "codex_output_schema",
          strict: true,
          schema,
        },
      },
    };

    executor.transformRequest("gpt-5.4-mini", body, true, {
      connectionId: "test-codex-structured-output",
      providerSpecificData: {},
    });

    expect(body.text).toEqual({
      format: {
        type: "json_schema",
        name: "codex_output_schema",
        strict: true,
        schema,
      },
    });
    expect(body.metadata).toBeUndefined();
  });

  it("preserves Responses-native tool_search tools", () => {
    const tools = normalizeTools([
      {
        type: "tool_search",
        execution: "sync",
        description: "Discover deferred tools",
        parameters: { type: "object", properties: {} },
      },
      {
        type: "namespace",
        name: "codex_app",
        description: "app tools",
        tools: [
          {
            type: "function",
            name: "automation_update",
            description: "automation",
            parameters: { type: "object", properties: {} },
            defer_loading: true,
          },
        ],
      },
      {
        type: "function",
        name: "plain_fn",
        description: "plain",
        parameters: { type: "object", properties: {} },
      },
    ]);

    expect(tools.map((tool) => `${tool.type}:${tool.name || ""}`)).toEqual([
      "tool_search:",
      "namespace:codex_app",
      "function:plain_fn",
    ]);
  });

  it("preserves hosted Responses tools", () => {
    const tools = normalizeTools([
      { type: "web_search", search_context_size: "medium" },
      { type: "image_generation", size: "1024x1024" },
      { type: "mcp", server_label: "docs", server_url: "https://example.com/mcp" },
      { type: "local_shell" },
      { type: "code_interpreter", container: { type: "auto" } },
      { type: "computer", display_width: 1024, display_height: 768, environment: "browser" },
    ]);

    expect(tools.map((tool) => tool.type)).toEqual([
      "web_search",
      "image_generation",
      "mcp",
      "local_shell",
      "code_interpreter",
      "computer",
    ]);
  });

  it("strips unsupported patterns across schema maps without touching schema data", () => {
    const unsupported = "^[^\\p{Cc}\\P{Letter}]+$";
    const literal = "^\\\\p{Cc}$";
    const sourceParameters = {
      type: "object",
      properties: {
        pattern: { type: "string", pattern: unsupported },
        literal: { type: "string", pattern: literal },
      },
      patternProperties: {
        "^pattern$": { type: "string", pattern: unsupported },
      },
      $defs: {
        pattern: { type: "string", pattern: unsupported },
      },
      definitions: {
        nested: { allOf: [{ type: "string", pattern: unsupported }] },
      },
      dependentSchemas: {
        trigger: { properties: { value: { type: "string", pattern: unsupported } } },
      },
      enum: [{ pattern: unsupported }],
      const: { pattern: unsupported },
      default: { pattern: unsupported },
      examples: [{ pattern: unsupported }],
      "x-annotation": { pattern: unsupported },
    };

    const tools = normalizeTools([{
      type: "function",
      function: { name: "schema_probe", parameters: sourceParameters },
    }]);
    const parameters = tools[0].parameters;

    expect(parameters.properties.pattern.pattern).toBeUndefined();
    expect(parameters.properties.literal.pattern).toBe(literal);
    expect(parameters.patternProperties["^pattern$"].pattern).toBeUndefined();
    expect(parameters.$defs.pattern.pattern).toBeUndefined();
    expect(parameters.definitions.nested.allOf[0].pattern).toBeUndefined();
    expect(parameters.dependentSchemas.trigger.properties.value.pattern).toBeUndefined();
    expect(parameters.enum).toEqual([{ pattern: unsupported }]);
    expect(parameters.const).toEqual({ pattern: unsupported });
    expect(parameters.default).toEqual({ pattern: unsupported });
    expect(parameters.examples).toEqual([{ pattern: unsupported }]);
    expect(parameters["x-annotation"]).toEqual({ pattern: unsupported });
    expect(sourceParameters.properties.pattern.pattern).toBe(unsupported);
    expect(sourceParameters.patternProperties["^pattern$"].pattern).toBe(unsupported);
  });

  it("sanitizes nested draft07 dependencies and additionalItems schemas", () => {
    const unsupported = "^\\p{Letter}+$";
    const requiredDependencies = ["billing_address"];
    const parameters = {
      type: "object",
      dependencies: {
        credit_card: requiredDependencies,
        aliases: {
          type: "array",
          items: [{ type: "string" }],
          additionalItems: { type: "string", pattern: unsupported },
        },
      },
    };

    const tools = normalizeTools([{ type: "function", name: "draft07_probe", parameters }]);
    const normalized = tools[0].parameters;
    expect(normalized).not.toBe(parameters);
    expect(normalized.dependencies).not.toBe(parameters.dependencies);
    expect(normalized.dependencies.aliases).not.toBe(parameters.dependencies.aliases);

    expect(normalized.dependencies.credit_card).toBe(requiredDependencies);
    expect(normalized.dependencies.credit_card).toEqual(["billing_address"]);
    expect(normalized.dependencies.aliases.additionalItems.pattern).toBeUndefined();
    expect(normalized.dependencies.aliases.additionalItems.type).toBe("string");
    expect(parameters.dependencies.aliases.additionalItems.pattern).toBe(unsupported);
  });

  it("preserves schema identity when Codex has nothing to strip", () => {
    const parameters = {
      type: "object",
      properties: {
        simple: { type: "string", pattern: "^[A-Z]+$" },
        literal: { type: "string", pattern: "^\\\\P{Letter}$" },
      },
    };

    const tools = normalizeTools([{ type: "function", name: "probe", parameters }]);

    expect(tools[0].parameters).toBe(parameters);
  });

  it("sanitizes namespace subtool parameters without mutating caller schemas", () => {
    const parameters = {
      type: "object",
      properties: { name: { type: "string", pattern: "^\\p{Cc}+$" } },
    };
    const namespace = {
      type: "namespace",
      name: "agent",
      tools: [{ type: "function", name: "Artifact", parameters }],
    };
    const originalNamespace = structuredClone(namespace);
    const tools = normalizeTools([namespace]);

    expect(tools[0].tools[0].parameters.properties.name.pattern).toBeUndefined();
    expect(tools[0]).not.toBe(namespace);
    expect(tools[0].tools).not.toBe(namespace.tools);
    expect(namespace.tools[0].parameters).toBe(parameters);
    expect(namespace).toEqual(originalNamespace);
    expect(parameters.properties.name.pattern).toBe("^\\p{Cc}+$");
  });

  it("preserves custom freeform tools with format payloads", () => {
    const tools = normalizeTools([
      {
        type: "custom",
        name: "apply_patch",
        description: "patch",
        format: { type: "grammar", syntax: "lark", definition: "start: /.+/" },
      },
    ]);

    expect(tools).toEqual([
      {
        type: "custom",
        name: "apply_patch",
        description: "patch",
        format: { type: "grammar", syntax: "lark", definition: "start: /.+/" },
      },
    ]);
  });
});
