import { describe, it, expect } from "vitest";
import { streamJsonlToOpenAi } from "../../open-sse/executors/huggingchat/jsonlStream.js";

function makeBody(chunks) {
  let i = 0;
  const encoder = new TextEncoder();
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined };
          const value = typeof chunks[i] === "string" ? encoder.encode(chunks[i]) : chunks[i];
          i++;
          return { done: false, value };
        },
        releaseLock() {},
      };
    },
  };
}

async function collect(generator) {
  const out = [];
  for await (const chunk of generator) out.push(chunk);
  return out;
}

describe("streamJsonlToOpenAi", () => {
  it("throws when JSONL contains status:error", async () => {
    const body = makeBody([
      JSON.stringify({ type: "stream", token: "hello " }) + "\n",
      JSON.stringify({ type: "status", status: "error", message: "generation failed" }) + "\n",
    ]);
    const gen = streamJsonlToOpenAi(body, "model", "id", 123, null);
    await expect(collect(gen)).rejects.toThrow("generation failed");
  });

  it("throws default message when status:error has no message", async () => {
    const body = makeBody([
      JSON.stringify({ type: "status", status: "error" }) + "\n",
    ]);
    const gen = streamJsonlToOpenAi(body, "model", "id", 123, null);
    await expect(collect(gen)).rejects.toThrow("HuggingChat generation error");
  });

  it("emits final record without trailing newline at EOF", async () => {
    const body = makeBody([
      JSON.stringify({ type: "finalAnswer", text: "only answer" }),
    ]);
    const chunks = await collect(streamJsonlToOpenAi(body, "model", "id", 123, null));
    const joined = chunks.join("");
    expect(joined).toContain("only answer");
    expect(joined).toContain('[DONE]');
  });
});
