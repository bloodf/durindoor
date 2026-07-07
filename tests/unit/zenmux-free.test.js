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
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
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
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { WEB_COOKIE_PROVIDERS } from "../../src/shared/constants/providers.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn((url, options) => global.fetch(url, options)),
}));

const originalFetch = global.fetch;

function zenmuxSse(chunks, stopReason = "stop") {
  const body = chunks
    .map((chunk) => `data: ${JSON.stringify({ type: "content_block_delta", delta: { text: chunk } })}\n\n`)
    .join("") + `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: stopReason } })}\n\n`;
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
  proxyAwareFetch.mockClear();
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

  it("marks ZenMux models as text-only so clients do not expect tool calls", () => {
    expect(getCapabilitiesForModel("zenmux-free", "deepseek/deepseek-chat").tools).toBe(false);
    expect(getCapabilitiesForModel("zmf", "deepseek/deepseek-chat").tools).toBe(false);
  });

  it("preserves reasoning capabilities for ZenMux thinking models", () => {
    const reasoner = getCapabilitiesForModel("zenmux-free", "deepseek/deepseek-reasoner");
    expect(reasoner.tools).toBe(false);
    expect(reasoner.reasoning).toBe(true);
    expect(reasoner.thinkingFormat).toBe("deepseek");

    const v4 = getCapabilitiesForModel("zmf", "deepseek/deepseek-v4-pro");
    expect(v4.tools).toBe(false);
    expect(v4.reasoning).toBe(true);
    expect(v4.thinkingFormat).toBe("deepseek");
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
  it("preserves earlier user and assistant turns in ZenMux's Anthropic message shape", () => {
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
      system: "Be concise.",
    });
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "old" }] },
      { role: "assistant", content: [{ type: "text", text: "old answer" }] },
      { role: "user", content: [{ type: "text", text: "new" }] },
    ]);
  });

  it("applies provider-native reasoning controls for thinking models", () => {
    const body = buildZenmuxAnthropicBody({
      model: "deepseek/deepseek-reasoner",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    }, "deepseek/deepseek-reasoner");

    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
  });

  it("preserves OpenAI JSON response_format in the system prompt", () => {
    const body = buildZenmuxAnthropicBody({
      model: "deepseek/deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_object" },
    }, "deepseek/deepseek-chat");

    expect(body.system).toContain("You must respond with valid JSON");
  });

  it("preserves JSON schema response_format in the system prompt", () => {
    const body = buildZenmuxAnthropicBody({
      model: "deepseek/deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_schema", json_schema: { schema: { type: "object" } } },
    }, "deepseek/deepseek-chat");

    expect(body.system).toContain("JSON schema");
    expect(body.system).toContain('"type": "object"');
  });

  it("maps OpenAI stop sequences to Anthropic stop_sequences", () => {
    expect(buildZenmuxAnthropicBody({
      messages: [{ role: "user", content: "hi" }],
      stop: "END",
    }).stop_sequences).toEqual(["END"]);

    expect(buildZenmuxAnthropicBody({
      messages: [{ role: "user", content: "hi" }],
      stop: ["END", "STOP"],
    }).stop_sequences).toEqual(["END", "STOP"]);
  });

  it("merges adjacent same-role messages before sending to Anthropic", () => {
    const body = buildZenmuxAnthropicBody({
      messages: [
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: "c" },
        { role: "assistant", content: "d" },
      ],
    });

    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
      { role: "assistant", content: [{ type: "text", text: "c" }, { type: "text", text: "d" }] },
    ]);
  });

  it("uses a default user message when no conversation messages exist", () => {
    const body = buildZenmuxAnthropicBody({
      messages: [{ role: "system", content: "Be helpful." }],
    });

    expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hello" }] }]);
    expect(body.system).toBe("Be helpful.");
  });

  it("honors modern Chat Completions and Responses output cap aliases", () => {
    expect(buildZenmuxAnthropicBody({ max_completion_tokens: 7 }).max_tokens).toBe(7);
    expect(buildZenmuxAnthropicBody({ max_output_tokens: 8 }).max_tokens).toBe(8);
    expect(buildZenmuxAnthropicBody({ max_tokens: 6, max_completion_tokens: 7 }).max_tokens).toBe(6);
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
    expect(proxyAwareFetch).not.toHaveBeenCalled();
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
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(url).toContain(`${ZENMUX_FREE_CHAT_URL}?ctoken=tok123`);
    expect(options.headers.Cookie).toBe("foo=1; ctoken=tok123; bar=2");
    expect(options.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(options.body).messages[0].content[0].text).toBe("hi");
    expect(result.transformedBody.model).toBe("deepseek/deepseek-chat");
  });

  it("rethrows AbortError instead of converting it to a 502", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    proxyAwareFetch.mockRejectedValueOnce(abortError);
    const exec = new ZenmuxFreeExecutor();

    await expect(
      exec.execute({
        body: { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }] },
        credentials: { apiKey: "ctoken=tok123" },
        stream: false,
      }),
    ).rejects.toBe(abortError);
  });
  it("passes configured proxy options through the proxy-aware fetch helper", async () => {
    global.fetch.mockResolvedValueOnce(zenmuxSse(["ok"]));
    const exec = new ZenmuxFreeExecutor();
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.local:8080" };

    await exec.execute({
      body: { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "ctoken=tok123" },
      stream: false,
      proxyOptions,
    });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      expect.stringContaining(`${ZENMUX_FREE_CHAT_URL}?ctoken=tok123`),
      expect.objectContaining({ method: "POST" }),
      proxyOptions,
    );
  });

  it("converts Anthropic SSE into a non-streaming OpenAI chat response", async () => {
    global.fetch.mockResolvedValueOnce(zenmuxSse(["hel", "lo"], "max_tokens"));
    const exec = new ZenmuxFreeExecutor();
    const result = await exec.execute({
      body: { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "ctoken=tok123" },
      stream: false,
    });

    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("hello");
    expect(json.choices[0].finish_reason).toBe("length");
  });

  it("returns reasoning_content separately from content for thinking models", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        new Blob([
          'data: ' +
            JSON.stringify({ type: "content_block_delta", delta: { thinking: "step" } }) +
            "\n\n",
          'data: ' +
            JSON.stringify({ type: "content_block_delta", delta: { text: "answer" } }) +
            "\n\n",
          'data: ' + JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } }) + "\n\n",
        ]).stream(),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const exec = new ZenmuxFreeExecutor();
    const result = await exec.execute({
      body: { model: "deepseek/deepseek-reasoner", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "ctoken=tok123" },
      stream: false,
    });

    const json = await result.response.json();
    expect(json.choices[0].message.content).toBe("answer");
    expect(json.choices[0].message.reasoning_content).toBe("step");
    expect(json.choices[0].finish_reason).toBe("stop");
  });

  it("converts Anthropic SSE into OpenAI streaming chunks", async () => {
    global.fetch.mockResolvedValueOnce(zenmuxSse(["hel", "lo"], "max_tokens"));
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
    expect(text).toContain('"finish_reason":"length"');
    expect(text).toContain("data: [DONE]");
  });

  it("emits reasoning_content deltas for thinking models in streaming", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        new Blob([
          'data: ' +
            JSON.stringify({ type: "content_block_delta", delta: { thinking: "step" } }) +
            "\n\n",
          'data: ' +
            JSON.stringify({ type: "content_block_delta", delta: { text: "answer" } }) +
            "\n\n",
          'data: ' + JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } }) + "\n\n",
        ]).stream(),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const exec = new ZenmuxFreeExecutor();
    const result = await exec.execute({
      body: { model: "deepseek/deepseek-reasoner", messages: [{ role: "user", content: "hi" }], stream: true },
      credentials: { apiKey: "ctoken=tok123" },
      stream: true,
    });

    const text = await readText(result.response);
    expect(text).toContain('"delta":{"reasoning_content":"step"}');
    expect(text).toContain('"delta":{"content":"answer"}');
    expect(text).toContain("data: [DONE]");
  });

  it("returns an OpenAI error body for Anthropic SSE error events in streaming", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        new Blob([
          'data: ' + JSON.stringify({ type: "error", error: { message: "quota exceeded" } }) + "\n\n",
        ]).stream(),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const exec = new ZenmuxFreeExecutor();
    const result = await exec.execute({
      body: { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }], stream: true },
      credentials: { apiKey: "ctoken=tok123" },
      stream: true,
    });

    const text = await readText(result.response);
    expect(text).toContain('"error"');
    expect(text).toContain("quota exceeded");
    expect(text).toContain("data: [DONE]");
  });

  it("does not close an already-errored streaming controller when the reader throws", async () => {
    const brokenBody = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: ok\n\n"));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ).body;

    const error = new Error("socket reset");
    brokenBody.getReader = () => ({
      read: vi.fn().mockRejectedValue(error),
      releaseLock: vi.fn(),
    });

    global.fetch.mockResolvedValueOnce(new Response(brokenBody, { status: 200 }));
    const exec = new ZenmuxFreeExecutor();
    const result = await exec.execute({
      body: { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }], stream: true },
      credentials: { apiKey: "ctoken=tok123" },
      stream: true,
    });

    await expect(readText(result.response)).rejects.toThrow("socket reset");
  });
});
