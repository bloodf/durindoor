import { describe, expect, it, vi } from "vitest";
import { HuggingChatStreamError, readJsonlResponse, streamJsonlToOpenAi } from "../../open-sse/executors/huggingchat/jsonlStream.js";

function body(chunks) {
  const cancel = vi.fn();
  const stream = new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); },
    cancel,
  });
  return { stream, cancel };
}

describe("HuggingChat JSONL bounds", () => {
  it("rejects an oversized non-streaming response and cancels the reader", async () => {
    const input = body(["123", "456"]);
    await expect(readJsonlResponse(input.stream, null, 5)).rejects.toThrow(HuggingChatStreamError);
    expect(input.cancel).toHaveBeenCalledOnce();
  });

  it("reports an oversized stream without a successful finish", async () => {
    const input = body(["123456"]);
    const chunks = [];
    for await (const chunk of streamJsonlToOpenAi(input.stream, "m", "i", 1, null, null, 5)) chunks.push(chunk);
    expect(chunks.join("")).toContain("huggingchat_payload_too_large");
    expect(chunks.join("")).not.toContain('"finish_reason":"stop"');
    expect(input.cancel).toHaveBeenCalledOnce();
  });

  it("normalizes malformed error messages in both paths", async () => {
    const line = JSON.stringify({ type: "status", status: "error", message: { secret: "value" } }) + "\n";
    await expect(readJsonlResponse(body([line]).stream)).rejects.toThrow("HuggingChat generation error");
    const consume = async () => { for await (const unused of streamJsonlToOpenAi(body([line]).stream, "m", "i", 1)) void unused; };
    await expect(consume()).rejects.toThrow("HuggingChat generation error");
  });

  it("cancels a stalled read when aborted", async () => {
    const input = body([]);
    const controller = new AbortController();
    const result = readJsonlResponse(input.stream, controller.signal);
    controller.abort();
    await result;
    expect(input.cancel).toHaveBeenCalledOnce();
  });
});
