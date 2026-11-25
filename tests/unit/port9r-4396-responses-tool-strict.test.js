import { describe, expect, it } from "vitest";

import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";
import { OpenCodeZenExecutor } from "../../open-sse/executors/opencode-zen.js";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";

// On Responses an omitted `strict` makes every property required, so a declared
// opt-out (false, or null as LangChain sends it) must survive executor rebuilds.
const PARAMETERS = {
  type: "object",
  properties: { id: { type: "string" }, statement: { type: "string" } },
  required: ["statement"],
  additionalProperties: false,
};

const flatTool = (extra = {}) => ({ type: "function", name: "submit_page", description: "submit", parameters: PARAMETERS, ...extra });
const chatTool = (extra = {}) => ({ type: "function", function: { name: "submit_page", description: "submit", parameters: PARAMETERS, ...extra } });
const userInput = () => [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];

const EXECUTORS = [
  ["codex", () => new CodexExecutor(), "gpt-5.5", { connectionId: "t-codex", providerSpecificData: {} }],
  ["opencode", () => new OpenCodeExecutor(), "muse-spark-1.3-contributor-free", {}],
  ["opencode-go", () => new OpenCodeGoExecutor(), "muse-spark-1.3-contributor", {}],
  ["grok-cli", () => new GrokCliExecutor(), "grok-4.5-high", { connectionId: "t-grok" }],
];

function send([, make, model, credentials], tools) {
  const body = { model, input: userInput(), tools: structuredClone(tools), stream: true };
  const out = make().transformRequest(model, body, true, credentials) || body;
  const lite = out.input?.find((item) => item?.type === "additional_tools")?.tools;
  return (out.tools || lite).find((tool) => tool.name === "submit_page");
}

describe.each(EXECUTORS)("upstream #4396 - %s keeps tool strict", (...executor) => {
  it.each([false, true, null])("keeps strict=%s on a flat Responses tool", (strict) => {
    expect(send(executor, [flatTool({ strict })]).strict).toBe(strict);
  });

  it.each([false, true, null])("keeps strict=%s on a nested Chat-shaped tool", (strict) => {
    const tool = send(executor, [chatTool({ strict })]);
    expect(tool.strict).toBe(strict);
    expect(tool).not.toHaveProperty("function");
  });

  it("adds no strict when a Responses client declared none", () => {
    expect(send(executor, [flatTool()])).not.toHaveProperty("strict");
  });
});

describe("upstream #4396 - opencode-zen leaves tool declarations untouched", () => {
  it.each([false, true, null])("keeps strict=%s on flat and nested tools", (strict) => {
    const tools = [flatTool({ strict }), chatTool({ strict })];
    const body = { model: "muse-spark-1.3", input: userInput(), tools: structuredClone(tools), stream: true };
    const out = new OpenCodeZenExecutor().transformRequest("muse-spark-1.3", body, true, {}) || body;
    expect(out.tools).toEqual(tools);
  });
});

describe("upstream #4396 - translators spell out Chat strict semantics", () => {
  const request = (from, to, body) => translateRequest(from, to, "gpt-6-sol", { model: "gpt-6-sol", ...body });
  const messages = [{ role: "user", content: "hi" }];

  it.each([[undefined, false], [null, false], [false, false], [true, true]])("sends Chat strict=%s to Responses as %s", (strict, expected) => {
    const out = request(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, { messages, tools: [chatTool(strict === undefined ? {} : { strict })] });
    expect(out.tools[0].strict).toBe(expected);
  });

  it("sends an undeclared Claude strict to Responses as false", () => {
    const out = request(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, { max_tokens: 100, messages, tools: [{ name: "submit_page", input_schema: PARAMETERS }] });
    expect(out.tools[0].strict).toBe(false);
  });

  it("does not leak strict=null from Responses into Chat", () => {
    const out = request(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, { input: userInput(), tools: [flatTool({ strict: null })] });
    expect(out.tools[0].function).not.toHaveProperty("strict");
  });
});
