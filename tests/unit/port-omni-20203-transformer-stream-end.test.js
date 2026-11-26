import { describe, it, expect } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const chunk = (delta, finish = null, usage) => ({ id: "c1", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : null) });
const zero = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
const real = { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 };
const encoder = new TextEncoder();
const wire = (frame) => encoder.encode(`data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`);

describe("OmniRoute #20203: Responses transformer stream end", () => {
  it("waits past zero usage placeholders for the real counts", async () => {
    const frames = [chunk({ content: "hi" }, null, zero), chunk({}, "stop", zero), { id: "c1", choices: [], usage: real }];
    const body = new ReadableStream({ start(c) { frames.forEach((frame) => c.enqueue(wire(frame))); c.close(); } });
    const out = await new Response(body.pipeThrough(createResponsesApiTransformStream())).text();
    const completed = JSON.parse(out.split("event: response.completed\ndata: ")[1].split("\n")[0]);
    expect(completed.response.usage).toMatchObject({ input_tokens: 4, output_tokens: 2 });
  });

  it("completes on [DONE] while the upstream socket stays open", async () => {
    const stream = createResponsesApiTransformStream();
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const decoder = new TextDecoder();
    for (const frame of [chunk({ content: "hi" }), chunk({}, "stop"), "[DONE]"]) writer.write(wire(frame)).catch(() => {});
    let out = "";
    while (!out.includes("event: response.completed")) out += decoder.decode((await reader.read()).value);
    expect(out).toContain("event: response.completed");
    await reader.cancel();
  }, 2000);
});
