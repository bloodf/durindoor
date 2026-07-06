/**
 * Unit tests for the ZenMux Free web-cookie provider.
 *
 * Covers the shippable contract for this web-session port:
 *   - registry/model exposure
 *   - cookie normalization and ctoken validation
 *   - OpenAI chat request -> ZenMux Anthropic-compatible request shape
 *   - Anthropic SSE -> OpenAI non-stream and streaming responses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import {
  ZenmuxFreeExecutor,
  buildZenmuxAnthropicBody,
  extractZenmuxCtoken,
  normalizeZenmuxCookie,
  ZENMUX_FREE_CHAT_URL,
} from "../../open-sse/executors/zenmux-free.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { WEB_COOKIE_PROVIDERS } from "../../src/shared/constants/providers.js";

const originalFetch = global.fetch;

function zenmuxSse(chunks) {
  const body = chunks
    .map((chunk) => `data: ${JSON.stringify({ type: "content_block_delta", delta: { text: chunk } })}\n\n`)
    .join("") + "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"stop\"}}\n\n";
  return new Response(new Blob([body]).stream(), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function readText(response) {
  return await response.text();
}

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("zenmux-free registry", () => {
  it("exposes the provider as a web-cookie provider with cookie auth", () => {
    expect(WEB_COOKIE_PROVIDERS["zenmux-free"]).toMatchObject({
      id: "zenmux-free",
      alias: "zmf",
      authType: "cookie",
    });
    expect(PROVIDERS["zenmux-free"]).toMatchObject({
      baseUrl: ZENMUX_FREE_CHAT_URL,
      executor: "zenmux-free",
      authType: "cookie",
    });
  });

  it("registers models under the zmf alias", () => {
    expect(PROVIDER_ID_TO_ALIAS["zenmux-free"]).toBe("zmf");
    expect(PROVIDER_MODELS.zmf.map((model) => model.id)).toContain("deepseek/deepseek-chat");
  });

  it("uses the specialized executor", () => {
    expect(hasSpecializedExecutor("zenmux-free")).toBe(true);
    expect(getExecutor("zenmux-free")).toBeInstanceOf(ZenmuxFreeExecutor);
  });
});

describe("zenmux-free credential helpers", () => {
  it("normalizes copied Cookie headers", () => {
    expect(normalizeZenmuxCookie("Cookie: foo=1\nctoken=abc; bar=2")).toBe("foo=1; ctoken=abc; bar=2");
  });

  it("extracts ctoken from a full cookie header", () => {
    expect(extractZenmuxCtoken("foo=1; ctoken=abc%20123; bar=2")).toBe("abc 123");
  });

  it("returns an empty ctoken when the required cookie is missing", () => {
    expect(extractZenmuxCtoken("foo=1; bar=2")).toBe("");
  });
});

describe("buildZenmuxAnthropicBody", () => {
  it("flattens system and last user message into ZenMux's Anthropic message shape", () => {
    const body = buildZenmuxAnthropicBody({
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "old" },
        { role: "assistant", content: "old answer" },
        { role: "user", content: [{ type: "text", text: "new" }] },
      ],
      max_tokens: 123,
      temperature: 0.2,
    }, "z-ai/glm-4.7-flash-free");

    expect(body).toMatchObject({
      model: "z-ai/glm-4.7-flash-free",
      max_tokens: 123,
      stream: true,
      temperature: 0.2,
    });
    expect(body.messages[0].content[0].text).toBe("Be concise.\n\nnew");
  });
});

describe("ZenmuxFreeExecutor.execute", () => {
  it("rejects credentials that do not include ctoken before making a network request", async () => {
    const exec = new ZenmuxFreeExecutor();
    const result = await exec.execute({
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "foo=1" },
      stream: false,
    });
    expect(result.response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await result.response.json()).toMatchObject({
      error: { message: expect.stringContaining("ctoken not found") },
    });
  });

  it("sends ctoken in the query string and full cookies in the Cookie header", async () => {
    global.fetch.mockResolvedValueOnce(zenmuxSse(["hello"]));
    const exec = new ZenmuxFreeExecutor();
    const result = await exec.execute({
      body: { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }], stream: false },
      credentials: { apiKey: "foo=1; ctoken=tok123; bar=2" },
      stream: false,
    });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain(`${ZENMUX_FREE_CHAT_URL}?ctoken=tok123`);
    expect(options.headers.Cookie).toBe("foo=1; ctoken=tok123; bar=2");
    expect(options.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(options.body).messages[0].content[0].text).toBe("hi");
    expect(result.transformedBody.model).toBe("deepseek/deepseek-chat");
  });

  it("converts Anthropic SSE into a non-streaming OpenAI chat response", async () => {
    global.fetch.mockResolvedValueOnce(zenmuxSse(["hel", "lo"]));
    const exec = new ZenmuxFreeExecutor();
    const result = await exec.execute({
      body: { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "ctoken=tok123" },
      stream: false,
    });

    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("hello");
    expect(json.choices[0].finish_reason).toBe("stop");
  });

  it("converts Anthropic SSE into OpenAI streaming chunks", async () => {
    global.fetch.mockResolvedValueOnce(zenmuxSse(["hel", "lo"]));
    const exec = new ZenmuxFreeExecutor();
    const result = await exec.execute({
      body: { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }], stream: true },
      credentials: { apiKey: "ctoken=tok123" },
      stream: true,
    });

    const text = await readText(result.response);
    expect(text).toContain('"delta":{"role":"assistant"}');
    expect(text).toContain('"delta":{"content":"hel"}');
    expect(text).toContain('"delta":{"content":"lo"}');
    expect(text).toContain("data: [DONE]");
  });
});
