import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");
const { OpenCodeGoExecutor } = await import("../../open-sse/executors/opencode-go.js");
const { OpenCodeZenExecutor } = await import("../../open-sse/executors/opencode-zen.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

// Two names that share their first 64 characters: truncation would merge them.
const PREFIX = `mcp__some_server__${"x".repeat(50)}`;
const LONG_A = `${PREFIX}_read`;
const LONG_B = `${PREFIX}_write`;
const EXACT = "b".repeat(64);

const request = () => ({
  tools: [
    { type: "function", name: LONG_A, parameters: { type: "object", properties: {} } },
    { type: "function", function: { name: LONG_B, parameters: { type: "object", properties: {} } } },
    { type: "function", name: EXACT, parameters: { type: "object", properties: {} } },
    { type: "function", name: "short", parameters: { type: "object", properties: {} } },
    { type: "custom", name: `custom_${"c".repeat(70)}` },
  ],
  tool_choice: { type: "function", name: LONG_B },
  input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
    { type: "function_call", call_id: "call_1", name: LONG_A, arguments: "{}" },
    { type: "function_call_output", call_id: "call_1", output: "ok" },
  ],
});

const EXECUTORS = [
  ["opencode-go", () => new OpenCodeGoExecutor(), "muse-spark-1.3-contributor"],
  ["opencode", () => new OpenCodeExecutor(), "muse-spark-1.3-contributor-free"],
  ["opencode-zen", () => new OpenCodeZenExecutor(), "gpt-5-nano"],
];

describe("port(upstream) #4545: OpenCode Responses tool names stay within 64 characters", () => {
  it.each(EXECUTORS)("%s aliases long names consistently and keeps short ones", (_id, build, model) => {
    const caller = request();
    const original = structuredClone(caller);
    const out = build().transformRequest(model, { ...caller }, true, {});
    const names = out.tools.map((tool) => tool.name ?? tool.function.name);

    expect(names.every((name) => name.length <= 64)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(EXACT);
    expect(names).toContain("short");
    const aliasA = out.input.find((item) => item.type === "function_call").name;
    expect(out._toolNameMap.get(aliasA)).toBe(LONG_A);
    expect(names).toContain(aliasA);
    expect(JSON.stringify(out)).not.toContain(PREFIX + "_");
    // The client's own declarations are what the response path resolves against.
    expect(caller).toEqual(original);
    // Same name, same alias on the next turn.
    expect(build().transformRequest(model, request(), true, {}).input.find((item) => item.type === "function_call").name)
      .toBe(aliasA);
  });

  it.each(EXECUTORS.slice(0, 2))("%s keeps a forced long tool_choice forced", (id, build, model) => {
    const out = build().transformRequest(model, request(), true, {});
    // The free tier demotes forced choices to auto for this model by design.
    if (id === "opencode") return expect(out.tool_choice).toBe("auto");
    expect(out._toolNameMap.get(out.tool_choice.name)).toBe(LONG_B);
  });

  it("keeps the alias map when the same body is transformed again", () => {
    const executor = new OpenCodeExecutor();
    const body = request();
    const first = executor.transformRequest("muse-spark-1.3-contributor-free", body, true, {});
    const again = executor.transformRequest("muse-spark-1.3-contributor-free", first, true, {});
    expect([...again._toolNameMap.values()]).toEqual(expect.arrayContaining([LONG_A, LONG_B]));
  });
});

const ALIAS = "mcp__some_server__alias";
const MAP = new Map([[ALIAS, LONG_A]]);
const CALL = { id: "fc_1", type: "function_call", call_id: "call_1", name: ALIAS, arguments: "{}" };
const frame = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const SSE = frame("response.created", { response: { id: "resp_1" } }) +
  frame("response.output_item.added", { output_index: 0, item: { ...CALL, arguments: "" } }) +
  frame("response.function_call_arguments.delta", { output_index: 0, item_id: "fc_1", delta: "{}" }) +
  frame("response.function_call_arguments.done", { output_index: 0, item_id: "fc_1", name: ALIAS, arguments: "{}" }) +
  frame("response.output_item.done", { output_index: 0, item: CALL }) +
  frame("response.completed", { response: { id: "resp_1", status: "completed", output: [CALL] } });

const pipe = (transform) => new Response(new Response(SSE).body.pipeThrough(transform)).text();

describe("port(upstream) #4545: clients get their own tool names back", () => {
  it("restores a native Responses stream", async () => {
    const text = await pipe(createPassthroughStreamWithLogger("opencode", null, MAP, "muse", "c", { tools: [] }, null, null, FORMATS.OPENAI_RESPONSES));
    expect(text).toContain(LONG_A);
    expect(text).not.toContain(`"${ALIAS}"`);
  });

  it("restores a Chat stream translated from Responses", async () => {
    const text = await pipe(createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "opencode", null, MAP, "muse", "c", { tools: [] }));
    expect(text).toContain(LONG_A);
    expect(text).not.toContain(`"${ALIAS}"`);
  });

  it.each([FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI])("restores a collapsed forced stream for a %s client", async (sourceFormat) => {
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(SSE, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat, targetFormat: FORMATS.OPENAI_RESPONSES, provider: "opencode", model: "muse",
      body: { tools: [] }, stream: false, requestStartTime: Date.now(), connectionId: "c",
      clientRawRequest: {}, trackDone: vi.fn(), appendLog: vi.fn(), toolNameMap: MAP,
    });
    const text = await result.response.text();
    expect(text).toContain(LONG_A);
    expect(text).not.toContain(`"${ALIAS}"`);
  });

  it("restores a same-format Responses JSON body", () => {
    const body = { id: "resp_1", object: "response", status: "completed", output: [{ ...CALL }] };
    const out = translateNonStreamingResponse(body, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, { toolNameMap: MAP });
    expect(out.output[0].name).toBe(LONG_A);
  });
});
