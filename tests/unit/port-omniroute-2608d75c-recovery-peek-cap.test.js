import { afterEach, describe, expect, it, vi } from "vitest";
import { isInvalidEncryptedContentResponse } from "../../open-sse/executors/codex.js";
import { MinimaxCodeExecutor, MINIMAX_CODE_OPT_IN_KEY } from "../../open-sse/executors/minimax-code.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const CHUNK_BYTES = 16 * 1024;
const CHUNKS = 256;

// Chunked body without Content-Length; counts how much a reader actually pulled.
function chunkedResponse(init) {
  const seen = { pulls: 0 };
  const body = new ReadableStream({
    pull(controller) {
      if (seen.pulls === CHUNKS) return controller.close();
      seen.pulls += 1;
      controller.enqueue(new Uint8Array(CHUNK_BYTES).fill(32));
    },
  }, { highWaterMark: 0 });
  return { response: new Response(body, init), seen };
}

afterEach(() => vi.restoreAllMocks());

describe("OmniRoute 2608d75c (#19114) bounded recovery peeks", () => {
  it("still recognises Codex invalid_encrypted_content and leaves the body readable", async () => {
    const response = Response.json({ error: { code: "invalid_encrypted_content" } }, { status: 400 });
    await expect(isInvalidEncryptedContentResponse(response)).resolves.toBe(true);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_encrypted_content" } });
  });

  it("stops the Codex peek at its cap instead of buffering the whole body", async () => {
    const { response, seen } = chunkedResponse({ status: 400 });
    await expect(isInvalidEncryptedContentResponse(response)).resolves.toBe(false);
    expect(seen.pulls).toBeLessThan(10);
  });

  it("stops the MiniMax Code 200 refusal peek at its cap and passes the response through", async () => {
    const { response, seen } = chunkedResponse({ status: 200, headers: { "content-type": "application/json" } });
    vi.spyOn(DefaultExecutor.prototype, "execute").mockResolvedValue({ response });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected outbound request"); }));
    const executor = new MinimaxCodeExecutor();
    const result = await executor.execute({
      model: "MiniMax-M3", stream: false,
      body: { messages: [{ role: "user", content: "hi" }], max_tokens: 16 },
      credentials: { accessToken: "synthetic", providerSpecificData: { [MINIMAX_CODE_OPT_IN_KEY]: true } },
    });
    expect(result.response).toBe(response);
    expect(seen.pulls).toBeLessThan(10);
    vi.unstubAllGlobals();
  });
});
