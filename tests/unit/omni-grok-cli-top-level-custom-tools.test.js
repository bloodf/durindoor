import { beforeEach, describe, expect, it, vi } from "vitest";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";

const { proxyAwareFetch } = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const custom = { type: "custom", name: "patch", description: "Edit", format: { type: "text" } };
const second = { type: "custom", name: "shell" };
const fn = { type: "function", name: "read", parameters: { type: "object", properties: {} } };
const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "patch", arguments: JSON.stringify({ input: 'a\n"b"' }) };
const body = () => ({ model: "grok-build", input: [
  { type: "custom_tool_call", call_id: "old", name: "patch", input: "previous" },
  { type: "custom_tool_call_output", call_id: "old", output: "result" },
], tools: [custom, second, fn] });
const events = (text) => text.split(/\r?\n\r?\n/).map(b => b.split(/\r?\n/).find(l => l.startsWith("data:"))).filter(Boolean).map(l => JSON.parse(l.slice(5)));
async function run(response) {
  let sent;
  proxyAwareFetch.mockImplementation(async (_url, init) => { sent = JSON.parse(init.body); return response; });
  const result = await new GrokCliExecutor().execute({ model: "grok-build", body: body(), stream: true, credentials: { accessToken: "fixture" } });
  return { sent, response: result.response };
}
describe("Grok CLI top-level Responses custom tools", () => {
  beforeEach(() => { proxyAwareFetch.mockReset(); });
  it("lowers history and declarations and restores JSON without changing functions", async () => {
    const normal = { type: "function_call", call_id: "call_2", name: "read", arguments: "{}" };
    const shellCall = { type: "function_call", call_id: "call_3", name: "shell", arguments: '{"input":"pwd"}' };
    const { sent, response } = await run(Response.json({ output: [call, normal, shellCall], tools: [ { type: "function", name: "patch" }, fn ] }));
    expect(sent.tools[0].parameters).toEqual({ type: "object", properties: { input: { type: "string" } }, required: ["input"], additionalProperties: false });
    expect(sent.input).toEqual([{ type: "function_call", call_id: "old", name: "patch", arguments: '{"input":"previous"}' }, { type: "function_call_output", call_id: "old", output: "result" }]);
    const result = await response.json();
    expect(result.output).toEqual([{ type: "custom_tool_call", id: "fc_1", call_id: "call_1", name: "patch", input: 'a\n"b"' }, normal, { type: "custom_tool_call", call_id: "call_3", name: "shell", input: "pwd" }]);
    expect(result.tools[0]).toEqual(custom);
    expect(JSON.stringify(result)).not.toContain('_customTool');
  });
  it("restores streamed custom input and retains call identity", async () => {
    const upstream = [
      { type: "response.output_item.added", output_index: 0, item: { ...call, arguments: "" } },
      ...Array.from(call.arguments, delta => ({ type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta })),
      { type: "response.function_call_arguments.done", item_id: "fc_1", output_index: 0, arguments: call.arguments },
      { type: "response.output_item.done", output_index: 0, item: call },
    ];
    const text = upstream.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
    const { response } = await run(new Response(text, { headers: { "content-type": "text/event-stream" } }));
    const result = events(await response.text());
    expect(result[0].item).toMatchObject({ type: "custom_tool_call", call_id: "call_1", name: "patch" });
    expect(result.filter(e => e.type === "response.custom_tool_call_input.delta").map(e => e.delta).join("")).toBe('a\n"b"');
    expect(result.find(e => e.type === "response.custom_tool_call_input.done").input).toBe('a\n"b"');
    expect(result.at(-1).item).toMatchObject({ type: "custom_tool_call", call_id: "call_1", name: "patch", input: 'a\n"b"' });
    expect(JSON.stringify(result)).not.toContain('_customTool');
  });
  it("propagates downstream cancellation to the upstream stream", async () => {
    let cancelled = false;
    const upstream = new ReadableStream({ cancel() { cancelled = true; } });
    const { response } = await run(new Response(upstream, { headers: { "content-type": "text/event-stream" } }));
    await response.body.cancel();
    expect(cancelled).toBe(true);
  });

});
