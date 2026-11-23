import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

const { intercept } = require("../../src/mitm/handlers/kiro.js");

afterEach(() => vi.unstubAllGlobals());

describe("Kiro MITM inference settings", () => {
  it("forwards explicit settings and preserves a provider rejection", async () => {
    let forwarded;
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      forwarded = JSON.parse(options.body);
      return new Response('{"error":"unsupported limit"}', { status: 400, headers: { "content-type": "application/json" } });
    }));
    const response = {
      chunks: [],
      writeHead(status) { this.status = status; },
      write(chunk) { this.chunks.push(chunk); },
      end(chunk) { if (chunk) this.chunks.push(chunk); },
    };
    const body = {
      conversationState: { currentMessage: { userInputMessage: { content: "Hello" } } },
      inferenceConfig: { maxTokens: 123, temperature: 0, topP: 0.5 },
    };
    await intercept({ url: "/", headers: {} }, response, Buffer.from(JSON.stringify(body)), "chosen-model");
    expect(forwarded).toMatchObject({ max_tokens: 123, temperature: 0, top_p: 0.5 });
    expect(response.status).toBe(400);
    expect(response.chunks.join("")).toBe('{"error":"unsupported limit"}');
  });

  it("rejects explicit limits when routing back to Kiro", () => {
    expect(() => openaiToKiroRequest("model", { messages: [], max_tokens: 123 }, true, null))
      .toThrow("Kiro cannot enforce max_tokens output ceilings");
  });
});
