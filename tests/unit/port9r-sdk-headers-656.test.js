import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

describe("9router #656 — strip SDK metadata on OpenAI-compatible dispatch", () => {
  beforeEach(() => {
    vi.mocked(proxyAwareFetch).mockReset().mockImplementation(async () => new Response("{}"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  });
  afterEach(() => vi.unstubAllGlobals());

  async function dispatch(provider, url, configured, asHeaders = false) {
    const executor = new BaseExecutor(provider, { baseUrl: url, headers: configured });
    executor.buildUrl = () => url;
    if (asHeaders) executor.buildHeaders = () => new Headers(configured);
    const result = await executor.execute({ model: "fixture", body: {}, stream: false, credentials: { apiKey: "fixture-key" } });
    await result.response.text();
    return new Headers(vi.mocked(proxyAwareFetch).mock.calls.at(-1)[1].headers);
  }

  it.each([
    ["openai-compatible-fixture", "https://fixture.test/custom", false],
    ["fixture", "https://fixture.test/v1/chat/completions", false],
    ["fixture", "https://fixture.test/prefix/v1/responses", true],
  ])("cleans %s at %s without mutating configured headers", async (provider, url, asHeaders) => {
    const configured = {
      "X-Stainless-OS": "Linux", "x-STAINLESS-retry-count": "0",
      "user-agent": "OpenAI/Node 6.0", "x-provider-required": "keep",
      "anthropic-beta": "provider-beta",
    };
    const headers = await dispatch(provider, url, configured, asHeaders);
    expect(headers.get("x-stainless-os")).toBeNull();
    expect(headers.get("x-stainless-retry-count")).toBeNull();
    expect(headers.get("user-agent")).toBe("Mozilla/5.0 (compatible; OpenAI Compatible)");
    expect(headers.get("x-provider-required")).toBe("keep");
    expect(headers.get("anthropic-beta")).toBe("provider-beta");
    if (!asHeaders) expect(headers.get("authorization")).toBe("Bearer fixture-key");
    expect(configured["X-Stainless-OS"]).toBe("Linux");
    expect(configured["user-agent"]).toBe("OpenAI/Node 6.0");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("preserves Anthropic SDK identity even with an OpenAI-looking query", async () => {
    const headers = await dispatch("anthropic-compatible-fixture", "https://fixture.test/v1/messages?next=/v1/responses", {
      "X-Stainless-OS": "Linux", "User-Agent": "OpenAI/Node 6.0",
    });
    expect(headers.get("x-stainless-os")).toBe("Linux");
    expect(headers.get("user-agent")).toBe("OpenAI/Node 6.0");
    expect(headers.get("x-api-key")).toBe("fixture-key");
  });

  it.each(["my-agent/1.0", "OpenAI/Python 1.0"])("preserves nonmatching User-Agent %s", async (userAgent) => {
    const headers = await dispatch("fixture", "https://fixture.test/v1/responses", { "User-Agent": userAgent });
    expect(headers.get("user-agent")).toBe(userAgent);
  });
});
