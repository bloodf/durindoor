import { afterEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: proxyAwareFetchMock,
}));

import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { PollinationsExecutor } from "../../open-sse/executors/pollinations.js";
import { PuterExecutor } from "../../open-sse/executors/puter.js";
import {
  generateRequestToken,
  mapModel,
  TheOldLlmExecutor,
} from "../../open-sse/executors/theoldllm.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  proxyAwareFetchMock.mockReset();
});

describe("OmniRoute specialized provider ports", () => {
  it("registers command-code as a specialized Command Code executor alias", () => {
    const executor = getExecutor("command-code");
    const headers = executor.buildHeaders({ apiKey: "user_test" }, true);

    expect(hasSpecializedExecutor("command-code")).toBe(true);
    expect(executor.getProvider()).toBe("command-code");
    expect(executor.buildUrl("gpt-5.4", true)).toBe("https://api.commandcode.ai/alpha/generate");
    expect(headers.Authorization).toBe("Bearer user_test");
    expect(headers["x-command-code-version"]).toBe("0.33.2");
    expect(PROVIDERS["command-code"].format).toBe("commandcode");
    expect(PROVIDER_MODELS.cmd.length).toBeGreaterThan(0);
  });

  it("routes Puter to the REST chat endpoint with bearer auth", () => {
    const executor = getExecutor("puter");
    const headers = executor.buildHeaders({ apiKey: "puter-token" }, true);

    expect(executor).toBeInstanceOf(PuterExecutor);
    expect(executor.buildUrl("gpt-5.4", true)).toBe(
      "https://api.puter.com/puterai/openai/v1/chat/completions"
    );
    expect(headers.Authorization).toBe("Bearer puter-token");
    expect(headers.Accept).toBe("text/event-stream");
    expect(PROVIDERS.puter.baseUrl).toContain("/puterai/openai/v1/chat/completions");
    expect(PROVIDER_MODELS.pu.some((model) => model.id === "deepseek/deepseek-v4-pro")).toBe(true);
  });

  it("sets Pollinations model and stream fields without forcing jsonMode", () => {
    const executor = getExecutor("pollinations");
    const baseBody = { messages: [{ role: "user", content: "hello" }], jsonMode: true };
    const normal = executor.transformRequest("openai", baseBody, false);
    const json = executor.transformRequest(
      "openai",
      { messages: [], response_format: { type: "json_schema" } },
      true
    );

    expect(executor).toBeInstanceOf(PollinationsExecutor);
    expect(executor.buildUrl("openai", false)).toBe(
      "https://gen.pollinations.ai/v1/chat/completions"
    );
    expect(normal).toMatchObject({ model: "openai", stream: false });
    expect(normal.jsonMode).toBeUndefined();
    expect(json.jsonMode).toBe(true);
    expect(PROVIDERS.pollinations.noAuth).toBe(true);
    // Registry entry (not the runtime transport map) carries UI/credential
    // metadata like authModes — keeping "apikey" here is what keeps a
    // premium key path reachable for an otherwise no-auth provider.
    const registryEntry = REGISTRY.find((entry) => entry.id === "pollinations");
    expect(registryEntry.authModes).toContain("apikey");
  });

  it("omits Authorization for Pollinations no-auth placeholder credentials but forwards a real key", () => {
    const executor = getExecutor("pollinations");

    // No credentials at all (typical no-auth request path).
    expect(executor.buildHeaders({}, true).Authorization).toBeUndefined();
    expect(executor.buildHeaders(undefined, true).Authorization).toBeUndefined();

    // "sk_durindoor" is the local placeholder DurinDoor injects for no-auth
    // providers — it is not a real Pollinations key and must never leak upstream.
    expect(
      executor.buildHeaders({ apiKey: "sk_durindoor" }, true).Authorization
    ).toBeUndefined();
    expect(
      executor.buildHeaders({ accessToken: "sk_durindoor" }, true).Authorization
    ).toBeUndefined();

    // A real premium key from enter.pollinations.ai must still be forwarded.
    expect(
      executor.buildHeaders({ apiKey: "real-premium-key" }, true).Authorization
    ).toBe("Bearer real-premium-key");
  });

  it("maps The Old LLM model aliases and generates request tokens", () => {
    expect(mapModel("gpt-5.3")).toBe("GPT_5_3");
    expect(mapModel("gpt-4o")).toBe("GPT_4o");
    expect(mapModel("gpt_4o")).toBe("GPT_4o");
    expect(
      PROVIDER_MODELS.tllm.some((model) => model.id === mapModel("gpt-4o"))
    ).toBe(true);
    expect(mapModel("CLAUDE_4_6_OPUS")).toBe("CLAUDE_4_6_OPUS");
    expect(mapModel("claude sonnet 4")).toBe("CLAUDE_4_6_SONNET");
    expect(mapModel("deepseek_v4")).toBe("deepseek_v4");
    expect(mapModel("gemini_3_flash")).toBe("gemini_3_flash");
    expect(generateRequestToken()).toMatch(/^[a-z0-9]+-[a-z0-9]+-[a-f0-9]{8}$/);
    expect(PROVIDERS.theoldllm.noAuth).toBe(true);
    expect(PROVIDERS.theoldllm.passthroughModels).toBeUndefined();
    expect(PROVIDER_MODELS.tllm.some((model) => model.id === "GPT_5_4")).toBe(true);
  });

  it("uses proxy-aware fetch for The Old LLM requests", async () => {
    proxyAwareFetchMock.mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    const executor = new TheOldLlmExecutor();
    const proxyOptions = { proxyUrl: "http://127.0.0.1:18080", strictProxy: true };

    const { response } = await executor.execute({
      model: "gpt-5.3",
      body: { messages: [{ role: "user", content: "Hi" }] },
      stream: false,
      credentials: {},
      proxyOptions,
    });

    expect((await response.json()).choices[0].message.content).toBe("ok");
    expect(proxyAwareFetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(proxyAwareFetchMock.mock.calls[0][1].body).model).toBe("GPT_5_3");
    expect(proxyAwareFetchMock.mock.calls[0][2]).toBe(proxyOptions);
  });

  it("pipes The Old LLM streaming bodies without buffering them", async () => {
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"live"}}]}\n\n'));
      },
    });
    proxyAwareFetchMock.mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    const executor = new TheOldLlmExecutor();

    const result = await Promise.race([
      executor.execute({
        model: "GPT_5_4",
        body: { messages: [] },
        stream: true,
        credentials: {},
      }),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);

    expect(result).not.toBe("timeout");
    const { response } = result;
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const reader = response.body.getReader();
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    expect(new TextDecoder().decode(value)).toContain("live");
    await reader.cancel();
  });

  it("keeps The Old LLM streaming requests abortable after headers return", async () => {
    let upstreamSignal;
    proxyAwareFetchMock.mockImplementation(async (_url, init) => {
      upstreamSignal = init.signal;
      return new Response(new ReadableStream(), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    const controller = new AbortController();
    const executor = new TheOldLlmExecutor();

    const { response } = await executor.execute({
      model: "GPT_5_4",
      body: { messages: [] },
      stream: true,
      credentials: {},
      signal: controller.signal,
    });

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(upstreamSignal.aborted).toBe(false);
    controller.abort(new Error("client disconnected"));
    expect(upstreamSignal.aborted).toBe(true);
  });

  it("preserves The Old LLM non-streaming SSE metadata in OpenAI JSON", async () => {
    proxyAwareFetchMock.mockResolvedValue(
      new Response(
        [
          'data: {"id":"chatcmpl-up","created":123,"model":"GPT_5_3","choices":[{"delta":{"reasoning_content":"think "}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\""}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"x\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}',
          "data: [DONE]",
          "",
        ].join("\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
    );
    const executor = new TheOldLlmExecutor();

    const { response } = await executor.execute({
      model: "gpt-5.3",
      body: { messages: [{ role: "user", content: "Hi" }] },
      stream: false,
      credentials: {},
    });

    const body = await response.json();
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(body).toMatchObject({
      id: "chatcmpl-up",
      created: 123,
      model: "GPT_5_3",
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            reasoning_content: "think ",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: '{"q":"x"}' },
              },
            ],
          },
        },
      ],
    });
  });

  it("retries The Old LLM once when the request token is rejected", async () => {
    proxyAwareFetchMock
      .mockResolvedValueOnce(new Response('{"error":{"type":"access_denied"}}', { status: 403 }))
      .mockResolvedValueOnce(
        new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      );
    const executor = new TheOldLlmExecutor();

    const { response } = await executor.execute({
      model: "GPT_5_4",
      body: { messages: [] },
      stream: false,
      credentials: {},
    });

    expect(proxyAwareFetchMock).toHaveBeenCalledTimes(2);
    expect((await response.json()).choices[0].message.content).toBe("ok");
  });

  it("propagates The Old LLM aborts so chatCore can treat them as cancellations", async () => {
    const controller = new AbortController();
    controller.abort();
    const executor = new TheOldLlmExecutor();

    await expect(
      executor.execute({
        model: "GPT_5_4",
        body: { messages: [] },
        stream: false,
        credentials: {},
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
