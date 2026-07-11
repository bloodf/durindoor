import { describe, expect, it, vi } from "vitest";
import { createPxpipeDispatcher } from "../../src/lib/pxpipe/loader.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("pxpipe format dispatcher", () => {
  it("uses the OpenAI transformer and preserves OpenAI image_url blocks", async () => {
    const anthropic = vi.fn();
    const openai = vi.fn(async () => ({
      body: encoder.encode(JSON.stringify({
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }],
      })),
      info: { compressed: true, imageCount: 1 },
    }));
    const dispatch = createPxpipeDispatcher({
      transformAnthropicMessages: anthropic,
      transformOpenAIChatCompletions: openai,
    });

    const result = await dispatch({ format: "openai", body: encoder.encode("{}"), model: "blackboxai/anthropic/claude-fable-5" });
    const output = JSON.parse(decoder.decode(result.body));

    expect(result.applied).toBe(true);
    expect(openai).toHaveBeenCalledTimes(1);
    expect(openai).toHaveBeenCalledWith(expect.any(Uint8Array), expect.objectContaining({ compress: true }));
    expect(anthropic).not.toHaveBeenCalled();
    expect(output.messages[0].content[0]).toMatchObject({ type: "image_url" });
    expect(output.messages[0].content[0].source).toBeUndefined();
  });

  it("fails open when an installed version lacks the requested transformer", async () => {
    const body = encoder.encode("{}");
    const dispatch = createPxpipeDispatcher({ transformAnthropicMessages: vi.fn() });
    await expect(dispatch({ format: "openai", body })).resolves.toMatchObject({
      applied: false,
      body,
      reason: "unsupported_format",
    });
  });
});
