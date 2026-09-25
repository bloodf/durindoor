import { describe, expect, it } from "vitest";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";

// Upstream OmniRoute#14649: Codex desktop requests fail on grok-cli with
//   400 [invalid_client_tool_schema] <tool>: tool parameter root must be an object type
//   (root schema is an anyOf/oneOf union with a non-object branch)
// when a root anyOf/oneOf branch is not an inline object schema. Codex desktop's
// `automation_update` tool declares its modes as `$ref` branches into `$defs`, so
// every request carrying the tool catalog fails.
//
// Probed against Grok Build: `$ref`-only and `{type:"null"}` root branches are
// refused; a root union of inline object branches is accepted, but only yields
// correct arguments when the root is a bare union — next to a root `type: "object"`
// Grok emits junk values such as `{"id":true,"mode":true}`. Nested `$ref`s (inside
// properties) resolve fine.
const DEFS = {
  __schema0: {
    type: "object",
    properties: { id: { $ref: "#/$defs/__schema1" }, mode: { type: "string", enum: ["view"] } },
    required: ["mode", "id"],
    additionalProperties: false,
  },
  __schema1: { $ref: "#/$defs/__schema2" },
  __schema2: { type: "string" },
  __schema3: {
    type: "object",
    properties: { name: { type: "string" }, mode: { type: "string", enum: ["create"] } },
    required: ["mode", "name"],
    additionalProperties: false,
  },
};

function transformTools(tools) {
  const executor = new GrokCliExecutor();
  const out = executor.transformRequest(
    "grok-build",
    { model: "grok-build", input: [{ role: "user", content: "hi" }], tools },
    true,
    {},
  );
  return out.tools;
}

function fnTool(name, parameters) {
  return { type: "function", name, description: `${name} tool`, parameters };
}

describe("grok-cli root union tool schemas (omniroute-14649)", () => {
  it("inlines $ref branches into a bare root oneOf (Codex desktop automation_update)", () => {
    const parameters = {
      type: "object",
      properties: {},
      oneOf: [{ $ref: "#/$defs/__schema0" }, { $ref: "#/$defs/__schema3" }],
      $defs: DEFS,
    };
    const [tool] = transformTools([fnTool("automation_update", parameters)]);

    expect(tool.parameters).toEqual({ oneOf: [DEFS.__schema0, DEFS.__schema3], $defs: DEFS });
    expect(tool.name).toBe("automation_update");
    expect(tool.description).toBe("automation_update tool");
  });

  it("expands a branch that is itself a union into root object branches", () => {
    const update = {
      type: "object",
      properties: { id: { type: "string" }, mode: { type: "string", enum: ["update"] } },
      required: ["mode", "id"],
    };
    const defs = {
      ...DEFS,
      createModes: { oneOf: [{ $ref: "#/$defs/__schema3" }, { $ref: "#/$defs/draft" }] },
      draft: { type: "object", properties: { mode: { type: "string", enum: ["draft"] } } },
    };
    const parameters = {
      type: "object",
      properties: {},
      oneOf: [
        { $ref: "#/$defs/__schema0" },
        { $ref: "#/$defs/createModes" },
        { anyOf: [update, { type: "null" }] },
      ],
      $defs: defs,
    };
    const [tool] = transformTools([fnTool("automation_update", parameters)]);

    expect(tool.parameters).toEqual({
      oneOf: [DEFS.__schema0, DEFS.__schema3, defs.draft, update],
      $defs: defs,
    });
  });

  it("moves shared root properties and required into every branch", () => {
    const view = { type: "object", properties: { mode: { enum: ["view"] } }, required: ["mode"] };
    const create = {
      type: "object",
      properties: { mode: { enum: ["create"] }, workspace: { type: "integer" } },
      required: ["mode", "workspace"],
    };
    const parameters = {
      type: "object",
      description: "Manage an item",
      properties: { workspace: { type: "string" }, dryRun: { type: "boolean" } },
      required: ["workspace"],
      additionalProperties: false,
      anyOf: [view, create],
    };
    const [tool] = transformTools([fnTool("shared", parameters)]);

    expect(tool.parameters).toEqual({
      description: "Manage an item",
      anyOf: [
        {
          type: "object",
          properties: { workspace: { type: "string" }, dryRun: { type: "boolean" }, mode: { enum: ["view"] } },
          required: ["workspace", "mode"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { workspace: { type: "integer" }, dryRun: { type: "boolean" }, mode: { enum: ["create"] } },
          required: ["workspace", "mode"],
          additionalProperties: false,
        },
      ],
    });
  });

  it("stops expanding a self-referencing union", () => {
    const parameters = {
      oneOf: [DEFS.__schema3, { $ref: "#/$defs/loop" }],
      $defs: { loop: { oneOf: [{ $ref: "#/$defs/loop" }] } },
    };
    const [tool] = transformTools([fnTool("loop", parameters)]);

    expect(tool.parameters.oneOf).toEqual([DEFS.__schema3]);
  });

  it("drops branches that can never be an object argument", () => {
    const parameters = { anyOf: [DEFS.__schema3, { type: "null" }, { type: "string" }] };
    const [tool] = transformTools([fnTool("nullable", parameters)]);

    expect(tool.parameters).toEqual({ anyOf: [DEFS.__schema3] });
  });

  it("pins typeless and object|null branches to type object", () => {
    const parameters = {
      oneOf: [
        { properties: { a: { type: "string" } }, required: ["a"] },
        { type: ["object", "null"], properties: { b: { type: "number" } } },
      ],
    };
    const [tool] = transformTools([fnTool("typeless", parameters)]);

    expect(tool.parameters.oneOf).toEqual([
      { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
      { type: "object", properties: { b: { type: "number" } } },
    ]);
  });

  it("removes a root union whose branches cannot be resolved (external, missing, cyclic)", () => {
    const parameters = {
      properties: { keep: { type: "string" } },
      required: ["keep"],
      oneOf: [
        { $ref: "https://example.com/schema.json" },
        { $ref: "#/$defs/missing" },
        { $ref: "#/$defs/loopA" },
      ],
      $defs: { loopA: { $ref: "#/$defs/loopB" }, loopB: { $ref: "#/$defs/loopA" } },
    };
    const [tool] = transformTools([fnTool("unresolvable", parameters)]);

    expect(tool.parameters).toEqual({
      type: "object",
      properties: { keep: { type: "string" } },
      required: ["keep"],
      $defs: parameters.$defs,
    });
  });

  it("leaves bare unions, nested unions and non-function tools untouched", () => {
    const nested = {
      type: "object",
      properties: { choice: { oneOf: [{ $ref: "#/$defs/__schema2" }, { type: "null" }] } },
      $defs: DEFS,
    };
    const bareUnion = { oneOf: [DEFS.__schema0, DEFS.__schema3], $defs: DEFS };
    const tools = [fnTool("nested", nested), fnTool("bare_union", bareUnion), { type: "web_search" }];

    const out = transformTools(tools);

    expect(out[0].parameters).toBe(nested);
    expect(out[1].parameters).toBe(bareUnion);
    expect(out[2]).toEqual({ type: "web_search" });
  });

  it("leaves a union unchanged when it would exceed 64 root branches", () => {
    const defs = {};
    const branches = Array.from({ length: 65 }, (_, i) => {
      defs[`mode${i}`] = { type: "object", properties: { mode: { enum: [`m${i}`] } } };
      return { $ref: `#/$defs/mode${i}` };
    });
    const parameters = { type: "object", properties: {}, oneOf: branches, $defs: defs };
    const [tool] = transformTools([fnTool("wide", parameters)]);

    expect(tool.parameters).toBe(parameters);
  });

  it("leaves schemas alone whose refs point outside $defs/definitions", () => {
    const parameters = {
      type: "object",
      properties: { t: { type: "string" } },
      anyOf: [{ properties: { u: { $ref: "#/properties/t" } } }, { $ref: "#/anyOf/0" }],
    };
    const [tool] = transformTools([fnTool("root_refs", parameters)]);

    expect(tool.parameters).toBe(parameters);
  });
});
