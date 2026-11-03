// #1469: the forced-SSE Responses path must keep custom_tool_call output
// instead of dropping it, for Chat (declared and undeclared) and Claude clients.
import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const RAW = "*** Begin Patch\n*** End Patch";

function responsesSse() {
  const frames = [
    ["response.created", { response: { id: "resp-upstream", created_at: 1 } }],
    ["response.output_item.done", { output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "apply_patch", input: RAW, status: "completed" } }],
    ["response.output_item.done", { output_index: 1, item: { type: "function_call", id: "fc_1", call_id: "call_f", name: "get_weather", arguments: "{\"city\":\"x\"}", status: "completed" } }],
    ["response.completed", { response: { status: "completed", usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } }],
  ];
  return frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

async function run(sourceFormat, tools, { raw = responsesSse(), toolNameMap = null } = {}) {
  const result = await handleForcedSSEToJson({
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    provider: "codex",
    model: "gpt-test",
    body: { model: "gpt-test", stream: false, messages: [], tools },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "connection-test",
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess: vi.fn(async () => {}),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    log: { line: vi.fn(), debug: vi.fn() },
    usageEventId: "event-test",
    terminalProvenance: "upstream",
    toolNameMap,
  });
  return result.response.json();
}

const fnDecl = { type: "function", function: { name: "get_weather", parameters: { type: "object" } } };
const weather = { id: "call_f", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"x\"}" } };

describe("#1469 forced-SSE Responses path keeps custom_tool_call", () => {
  it("returns the Chat custom shape for a declared Chat custom tool", async () => {
    const body = await run(FORMATS.OPENAI, [{ type: "custom", custom: { name: "apply_patch" } }, fnDecl]);
    expect(body.choices[0].message.tool_calls).toEqual([
      { id: "call_1", type: "custom", custom: { name: "apply_patch", input: RAW } },
      weather,
    ]);
    expect(body.choices[0].finish_reason).toBe("tool_calls");
  });

  it("returns a function call with JSON {input} for an undeclared custom tool", async () => {
    const body = await run(FORMATS.OPENAI, [fnDecl]);
    const [custom, fn] = body.choices[0].message.tool_calls;
    expect(custom).toMatchObject({ id: "call_1", type: "function", function: { name: "apply_patch" } });
    expect(JSON.parse(custom.function.arguments)).toEqual({ input: RAW });
    expect(fn).toEqual(weather);
  });

  it("returns a Claude tool_use with {input} for a Claude client", async () => {
    const body = await run(FORMATS.CLAUDE, [{ name: "apply_patch", input_schema: { type: "object" } }]);
    const toolUses = body.content.filter((block) => block.type === "tool_use");
    expect(toolUses.map((block) => [block.name, block.input])).toEqual([
      ["apply_patch", { input: RAW }],
      ["get_weather", { city: "x" }],
    ]);
    expect(body.stop_reason).toBe("tool_use");
  });

  it("matches an aliased upstream custom tool name to the declared Chat custom tool", async () => {
    const raw = responsesSse().replace('"name":"apply_patch"', '"name":"apply_patch_alias"');
    const body = await run(FORMATS.OPENAI, [{ type: "custom", custom: { name: "apply_patch" } }, fnDecl], {
      raw, toolNameMap: new Map([["apply_patch_alias", "apply_patch"]]),
    });
    expect(body.choices[0].message.tool_calls[0]).toEqual({ id: "call_1", type: "custom", custom: { name: "apply_patch", input: RAW } });
  });
});
