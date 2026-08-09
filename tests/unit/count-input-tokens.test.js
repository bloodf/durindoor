// countInputTokens: the shared counter behind both the public count_tokens
// route and the chatCore context preflight. The preflight must reject on the
// provider's OWN number when one is available — the ~4-chars/token heuristic
// can be far enough off to reject a request the provider would have accepted.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  buildHeaders: vi.fn(() => ({ "Content-Type": "application/json" })),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ buildHeaders: mocks.buildHeaders })),
}));

const { countInputTokens, estimateTokens } = await import("../../open-sse/handlers/countTokensCore.js");

// "claude" is Claude-compatible, so deriveCountTokensUrl yields a native
// endpoint; "openai" is not, so it can never call one.
const nativeModel = { provider: "claude", model: "claude-sonnet-5" };
const nonNativeModel = { provider: "openai", model: "gpt-5.4" };
const body = { messages: [{ role: "user", content: "hello world" }] };

describe("countInputTokens", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the provider's native count, not the heuristic", async () => {
    const nativeCount = estimateTokens(body) + 5000;
    mocks.proxyAwareFetch.mockResolvedValue(
      new Response(JSON.stringify({ input_tokens: nativeCount }), { status: 200 }),
    );

    const result = await countInputTokens({ body, modelInfo: nativeModel });

    expect(mocks.proxyAwareFetch).toHaveBeenCalledOnce();
    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toMatch(/count_tokens$/);
    expect(result).toEqual({ tokens: nativeCount, approximate: false });
  });

  it("falls back to the estimate when the native call returns an error status", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(new Response("nope", { status: 500 }));

    const result = await countInputTokens({ body, modelInfo: nativeModel });

    expect(result).toEqual({ tokens: estimateTokens(body), approximate: true });
  });

  it("falls back to the estimate when the native call throws", async () => {
    mocks.proxyAwareFetch.mockRejectedValue(new Error("socket hang up"));

    const result = await countInputTokens({ body, modelInfo: nativeModel });

    expect(result).toEqual({ tokens: estimateTokens(body), approximate: true });
  });

  it("does not call any endpoint for providers without a native counter", async () => {
    const result = await countInputTokens({ body, modelInfo: nonNativeModel });

    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(result).toEqual({ tokens: estimateTokens(body), approximate: true });
  });


  // A translated body already carries the provider-facing id (upstreamModelId).
  // Replacing it with the catalog alias makes the upstream reject the count and
  // the preflight silently falls back to the heuristic.
  it("sends the body's own upstream model id rather than the catalog alias", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(
      new Response(JSON.stringify({ input_tokens: 123 }), { status: 200 }),
    );

    const translated = { ...body, model: "claude-sonnet-4-5-20250929" };
    await countInputTokens({ body: translated, modelInfo: { provider: "claude", model: "claude-sonnet-5-alias" } });

    const sent = JSON.parse(mocks.proxyAwareFetch.mock.calls[0][1].body);
    expect(sent.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("falls back to modelInfo when the body names no model", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(
      new Response(JSON.stringify({ input_tokens: 7 }), { status: 200 }),
    );

    await countInputTokens({ body, modelInfo: nativeModel });

    expect(JSON.parse(mocks.proxyAwareFetch.mock.calls[0][1].body).model).toBe(nativeModel.model);
  });
  // A zero count is legitimate (empty payload) and must not be mistaken for a
  // failed lookup — `Number(0) || estimate` would silently swap in a wrong number.
  it("accepts a native count of zero", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(
      new Response(JSON.stringify({ input_tokens: 0 }), { status: 200 }),
    );

    expect(await countInputTokens({ body, modelInfo: nativeModel })).toEqual({ tokens: 0, approximate: false });
  });

  it("falls back when the native response carries no usable number", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(
      new Response(JSON.stringify({ input_tokens: "not-a-number" }), { status: 200 }),
    );

    const result = await countInputTokens({ body, modelInfo: nativeModel });

    expect(result).toEqual({ tokens: estimateTokens(body), approximate: true });
  });
});
