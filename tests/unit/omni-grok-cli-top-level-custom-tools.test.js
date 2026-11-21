import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWithProviderAttemptContext, runQuotaBearingProviderRequest, runProviderAttemptDispatch, settleProviderAttemptDispatch } from "../../open-sse/services/providerAttemptContext.js";
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

  it("keeps interleaved function frames and suppresses replayed custom arguments", async () => {
    const normal = { type: "function_call", id: "fc_normal", call_id: "normal", name: "read", arguments: "{}" };
    const frames = [
      { type: "response.output_item.added", output_index: 0, item: { ...call, arguments: "" } },
      { type: "response.output_item.added", output_index: 1, item: normal },
      { type: "response.function_call_arguments.delta", item_id: "fc_normal", output_index: 0, delta: "{}", annotation: "keep" },
      { type: "response.function_call_arguments.done", item_id: "fc_1", output_index: 0, arguments: call.arguments, annotation: "custom metadata" },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "replay" },
      { type: "response.function_call_arguments.done", item_id: "fc_1", output_index: 0, arguments: call.arguments },
      { type: "response.output_item.done", output_index: 0, item: call },
      { type: "response.completed", response: { output: [call, normal] } },
    ];
    const bytes = new TextEncoder().encode(frames.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""));
    const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
    const { response } = await run(new Response(stream, { headers: { "content-type": "text/event-stream", "content-length": String(bytes.length) } }));
    expect(response.headers.has("content-length")).toBe(false);
    const result = events(await response.text());
    expect(result.find(e => e.annotation === "keep")).toEqual(frames[2]);
    expect(result.filter(e => e.type === "response.custom_tool_call_input.done")).toHaveLength(1);
    expect(result.find(e => e.type === "response.custom_tool_call_input.done")).toMatchObject({ item_id: "fc_1", annotation: "custom metadata" });
    expect(result.filter(e => e.type.startsWith("response.function_call_arguments"))).toEqual([frames[2]]);
    expect(result.at(-1).response.output).toEqual([{ ...call, type: "custom_tool_call", arguments: undefined, input: 'a\n"b"' }, normal].map(({ arguments: args, ...item }) => args === undefined ? item : { ...item, arguments: args }));
  });
  it("transfers the quota ticket to the rebuilt response", async () => {
    const settle = vi.fn().mockResolvedValue({ changed: true });
    const upstream = new Response("data: {}\n\n", { headers: { "content-type": "text/event-stream" } });
    proxyAwareFetch.mockImplementation(() => runProviderAttemptDispatch(async () => upstream));
    const result = await runWithProviderAttemptContext(() => 1, () => runQuotaBearingProviderRequest(() =>
      new GrokCliExecutor().execute({ model: "grok-build", body: body(), stream: true, credentials: { accessToken: "fixture" } })
    ), { beginQuotaDispatch: async () => ({ tracked: true, settle }) });
    expect(await settleProviderAttemptDispatch(upstream)).toEqual({ changed: false });
    await settleProviderAttemptDispatch(result.response, { success: true });
    expect(settle).toHaveBeenCalledWith({ success: true, reason: "success" });
    await result.response.body.cancel();
  });

});
