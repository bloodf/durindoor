// Hosted image-tool usage is kept for the usage ledger without changing billed tokens.
// The upstream response is a local stub: no Codex account or network is involved.
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const sse = (completed) => [
  { type: "response.output_item.done", item: { type: "image_generation_call", result: "aGVsbG8=" } },
  { type: "response.completed", response: { status: "completed", ...completed } },
].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");

const HOST_USAGE = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
const toolUsage = (input, output) => ({ image_gen: { input_tokens: input, output_tokens: output } });

async function generate(completed, options = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(sse(completed), { headers: { "content-type": "text/event-stream" } })));
  return handleImageGenerationCore({
    body: { prompt: "a cat", size: "1024x1024" },
    modelInfo: { provider: "codex", model: "gpt-image-2.5" },
    credentials: { accessToken: "synthetic" },
    ...options,
  });
}

describe("Codex image tool usage in the ledger only (OmniRoute #20684)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("records the counts as metadata and leaves billed tokens and the body unchanged", async () => {
    const result = await generate({ usage: HOST_USAGE, tool_usage: toolUsage(12, 1056) });

    expect(result.accounting.meta.imageToolUsage).toEqual({ input_tokens: 12, output_tokens: 1056 });
    expect(result.accounting.tokens).toEqual(HOST_USAGE);
    expect(await result.response.json()).not.toHaveProperty("usage");
  });

  it("keeps the counts when the response has no host usage", async () => {
    const result = await generate({ tool_usage: toolUsage(12, 1056) });

    expect(result.accounting.meta.imageToolUsage).toEqual({ input_tokens: 12, output_tokens: 1056 });
    expect(result.accounting.tokens).toEqual({});
  });

  it("records the counts before a streamed result is committed", async () => {
    const committed = [];
    const result = await generate({ usage: HOST_USAGE, tool_usage: toolUsage(5, 7) }, {
      streamToClient: true,
      onStreamComplete: async (outcome) => committed.push(structuredClone(outcome.accounting)),
    });
    await result.response.text();
    await result.completion;

    expect(committed[0].meta.imageToolUsage).toEqual({ input_tokens: 5, output_tokens: 7 });
    expect(committed[0].tokens).toEqual(HOST_USAGE);
  });

  it.each([
    ["missing", undefined],
    ["zero", toolUsage(0, 0)],
  ])("records nothing when the block is %s", async (_label, tool_usage) => {
    const result = await generate({ usage: HOST_USAGE, tool_usage });

    expect(result.accounting.meta).not.toHaveProperty("imageToolUsage");
  });
});
