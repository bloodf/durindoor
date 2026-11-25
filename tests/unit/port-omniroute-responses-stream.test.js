import { describe, expect, it } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

async function events(chunks) {
  const input = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  const stream = new Response(input).body.pipeThrough(createResponsesApiTransformStream());
  const output = await new Response(stream).text();
  return output.split("\n\n").filter((frame) => frame.startsWith("event: ")).map((frame) => JSON.parse(frame.split("\n")[1].slice(6)));
}
const terminals = (all) => all.filter((event) => ["response.completed", "response.failed", "response.incomplete"].includes(event.type));
const finish = (reason, usage) => ({ choices: [{ index: 0, delta: {}, finish_reason: reason }], usage });

describe("OmniRoute 489e7499ee4159acec082eeee18805f7c988ff96 Responses streams", () => {
  it("sanitizes counts and emits one terminal on duplicate finishes", async () => {
    const result = terminals(await events([finish("stop", { prompt_tokens: "5.6", completion_tokens: 2.2, total_tokens: -1 }), finish("stop")]));
    expect(result).toHaveLength(1);
    expect(result[0].response.usage).toMatchObject({ input_tokens: 6, output_tokens: 2, total_tokens: 8 });
  });
  it("omits invalid usage and completes an empty stream", async () => {
    expect(terminals(await events([]))[0].response).not.toHaveProperty("usage");
    expect(terminals(await events([finish("stop", { prompt_tokens: "NaN" })]))[0].response).not.toHaveProperty("usage");
  });
  it("reports upstream errors once, including error-only chunks", async () => {
    const result = terminals(await events([{ error: { message: "failed", code: "stream_error" } }, finish("stop")]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "response.failed", response: { status: "failed", error: { code: "stream_error", message: "failed" } } });
  });
  it("marks length-limited output incomplete", async () => {
    expect(terminals(await events([finish("length")]))[0]).toMatchObject({ type: "response.incomplete", response: { status: "incomplete" } });
  });
});
