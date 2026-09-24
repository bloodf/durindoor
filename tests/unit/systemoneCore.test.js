/**
 * Unit tests for open-sse/handlers/systemoneCore.js
 *
 * System One (Jev) is a config-driven, non-streaming decision passthrough
 * (state + questions in, typed answers out) — no chat translation layer.
 * Tests cover URL/header derivation from PROVIDER_MEDIA[provider].systemoneConfig,
 * the x-opencode-session header, usage mapping, and error paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { handleSystemoneCore } from "../../open-sse/handlers/systemoneCore.js";

function makeProviderResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeOptions(overrides = {}) {
  return {
    body: {
      model: "jev-1.13",
      state: "Customer: I was charged twice for my order this morning.",
      questions: { is_urgent: { type: "noul", instructions: "Is this urgent?" } },
    },
    modelInfo: { provider: "opencode-zen", model: "jev-1.13" },
    credentials: { apiKey: "zen-key" },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    onRequestSuccess: vi.fn(),
    ...overrides,
  };
}

describe("handleSystemoneCore", () => {
  beforeEach(() => {
    vi.mocked(proxyAwareFetch).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("unsupported provider (no systemoneConfig) → 400, no fetch", async () => {
    const result = await handleSystemoneCore(makeOptions({
      modelInfo: { provider: "openai", model: "gpt-5" },
    }));

    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/does not support System One/i);
  });

  it("posts to the registry's systemoneConfig.baseUrl with model overridden", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(makeProviderResponse({
      model: "jev-1.13",
      answers: { is_urgent: { type: "noul", noul: 0.9 } },
    }));

    await handleSystemoneCore(makeOptions());

    const [url, init] = vi.mocked(proxyAwareFetch).mock.calls[0];
    expect(url).toBe("https://opencode.ai/zen/v1/systemone");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("jev-1.13");
    expect(sent.state).toMatch(/charged twice/);
    expect(sent.questions.is_urgent.type).toBe("noul");
  });

  it("sends Authorization bearer from apiKey and a generated x-opencode-session header", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(makeProviderResponse({ answers: {} }));

    await handleSystemoneCore(makeOptions({ credentials: { apiKey: "zen-key" } }));

    const [, init] = vi.mocked(proxyAwareFetch).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer zen-key");
    expect(init.headers["x-opencode-session"]).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  });

  it("falls back to accessToken when apiKey is absent (noAuth free lane)", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(makeProviderResponse({ answers: {} }));

    await handleSystemoneCore(makeOptions({
      modelInfo: { provider: "opencode", model: "jev-1.13-free" },
      credentials: { accessToken: "public" },
    }));

    const [, init] = vi.mocked(proxyAwareFetch).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer public");
  });

  it("maps provider usage.input_tokens/output_tokens to prompt/completion tokens", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(makeProviderResponse({
      model: "jev-1.13",
      answers: { is_urgent: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 312, output_tokens: 48 },
    }));

    const result = await handleSystemoneCore(makeOptions());

    expect(result.success).toBe(true);
    expect(result.usage).toEqual({ prompt_tokens: 312, completion_tokens: 48 });
  });

  it("no usage in provider response → usage is null", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(makeProviderResponse({ answers: {} }));

    const result = await handleSystemoneCore(makeOptions());

    expect(result.usage).toBeNull();
  });

  it("calls onRequestSuccess on success, not on failure", async () => {
    const onRequestSuccess = vi.fn();
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(makeProviderResponse({ answers: {} }));
    await handleSystemoneCore(makeOptions({ onRequestSuccess }));
    expect(onRequestSuccess).toHaveBeenCalledOnce();

    onRequestSuccess.mockClear();
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(makeProviderResponse({ error: "bad" }, 500));
    await handleSystemoneCore(makeOptions({ onRequestSuccess }));
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("network error (fetch throws) → 502 Bad Gateway", async () => {
    vi.mocked(proxyAwareFetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await handleSystemoneCore(makeOptions());

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("provider 4xx/5xx → success=false with upstream status", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(makeProviderResponse({ error: { message: "bad key" } }, 401));

    const result = await handleSystemoneCore(makeOptions());

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
  });

  it("invalid JSON from provider → 502", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(
      new Response("not json", { status: 200, headers: { "Content-Type": "text/plain" } })
    );

    const result = await handleSystemoneCore(makeOptions());

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("response passes through the provider's answers untouched, with CORS header", async () => {
    const providerBody = { model: "jev-1.13", answers: { is_urgent: { type: "noul", noul: 0.99 } } };
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(makeProviderResponse(providerBody));

    const result = await handleSystemoneCore(makeOptions());
    const body = await result.response.json();

    expect(body).toEqual(providerBody);
    expect(result.response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("openrouter's systemoneConfig routes to its own baseUrl and headers", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(makeProviderResponse({ answers: {} }));

    await handleSystemoneCore(makeOptions({
      body: { model: "typesafe/jev-1.13", state: "hi", questions: { q: { type: "noul", instructions: "x" } } },
      modelInfo: { provider: "openrouter", model: "typesafe/jev-1.13" },
      credentials: { apiKey: "or-key" },
    }));

    const [url, init] = vi.mocked(proxyAwareFetch).mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(init.headers["HTTP-Referer"]).toBeDefined();
    expect(init.headers["X-Title"]).toBeDefined();
  });
});
