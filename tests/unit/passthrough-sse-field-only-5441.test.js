import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));

async function render(parts, format = FORMATS.OPENAI) {
  const encoder = new TextEncoder();
  const input = new ReadableStream({ start(controller) {
    for (const part of parts) controller.enqueue(encoder.encode(part));
    controller.close();
  } });
  return new Response(input.pipeThrough(createSSEStream({ mode: "passthrough", targetFormat: format }))).text();
}

const chunk = JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run", arguments: "{}" } }] }, finish_reason: null }] });
const finish = JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });

describe("OpenAI passthrough field-only SSE events (#5441)", () => {
  it("drops field-only events across chunks while preserving tool and finish frames", async () => {
    const out = await render([`event: message\nid: 1\ndata: ${chunk}\n\n`, `data: ${finish}\nid: 2\n\n`, "id:", " 26\n\nevent: ping\n\nretry: 5000\n\n: ping\n\ndata: [DONE]\n\nid: 27"]);
    expect(out).toContain("event: message\nid: 1\ndata: ");
    const payloads = out.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
    expect(payloads[0].choices[0].delta.tool_calls[0].function.name).toBe("run");
    expect(payloads[1].choices[0].finish_reason).toBe("tool_calls");
    expect(out).not.toMatch(/id: (?:2|26|27)|event: ping|retry:/);
    expect(out).toContain(": ping\n\n");
    expect(out.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("preserves native Claude event framing", async () => {
    const out = await render(["event: ping\n\ndata: {\"type\":\"ping\"}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"], FORMATS.CLAUDE);
    expect(out).toContain("event: ping\n\n");
  });
});
