import { afterEach, describe, expect, it, vi } from "vitest";
import codex from "../../open-sse/handlers/imageProviders/codex.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
const sse = (text) => new Response(text, { headers: { "content-type": "text/event-stream" } });
const parse = (text) => codex.parseResponse(sse(text), {}).catch((error) => error);

afterEach(() => vi.unstubAllGlobals());

describe("9router #3870 - Codex image stream failures keep their status", () => {
  it.each([
    ["response.failed", { response: { error: { code: "rate_limit_exceeded", message: "slow down" } } }, 429],
    ["response.failed", { response: { error: { type: "usage_limit_reached", message: "limit" } } }, 429],
    ["error", { code: "model_not_found", message: "no such model" }, 404],
    ["error", { error: { code: "invalid_api_key", message: "bad key" } }, 401],
    ["error", { message: "The 'x' model requires a newer version of Codex." }, 400],
    ["error", { status_code: 503, message: "busy" }, 503],
    ["response.failed", { response: { error: { code: "server_error", message: "boom" } } }, undefined],
  ])("classifies %s %j", async (event, data, status) => {
    expect((await parse(frame(event, data))).status).toBe(status);
  });

  it("returns that status from the buffered image handler", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(frame("response.failed", { response: { error: { code: "rate_limit_exceeded", message: "slow down" } } }))));
    const result = await handleImageGenerationCore({
      body: { prompt: "a square" },
      modelInfo: { provider: "codex", model: "gpt-5.4-image" },
      credentials: { accessToken: "test-token", providerSpecificData: {} },
    });
    expect(result).toMatchObject({ success: false, status: 429 });
  });
});
