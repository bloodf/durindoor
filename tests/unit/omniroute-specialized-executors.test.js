import { afterEach, describe, expect, it, vi } from "vitest";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { PollinationsExecutor } from "../../open-sse/executors/pollinations.js";
import { PuterExecutor } from "../../open-sse/executors/puter.js";
import {
  generateRequestToken,
  mapModel,
  TheOldLlmExecutor,
} from "../../open-sse/executors/theoldllm.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

afterEach(() => {
  vi.restoreAllMocks();
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
  });

  it("maps The Old LLM model aliases and generates request tokens", () => {
    expect(mapModel("gpt-5.3")).toBe("GPT_5_3");
    expect(mapModel("CLAUDE_4_6_OPUS")).toBe("CLAUDE_4_6_OPUS");
    expect(mapModel("claude sonnet 4")).toBe("CLAUDE_4_6_SONNET");
    expect(generateRequestToken()).toMatch(/^[a-z0-9]+-[a-z0-9]+-[a-f0-9]{8}$/);
    expect(PROVIDERS.theoldllm.noAuth).toBe(true);
    expect(PROVIDER_MODELS.tllm.some((model) => model.id === "GPT_5_4")).toBe(true);
  });

  it("wraps The Old LLM streamed upstream into non-streaming OpenAI JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"hello "}}]}',
          'data: {"choices":[{"delta":{"content":"world"}}]}',
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("GPT_5_3");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(body.model).toBe("GPT_5_3");
    expect(body.choices[0].message.content).toBe("hello world");
  });

  it("retries The Old LLM once when the request token is rejected", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await response.json()).choices[0].message.content).toBe("ok");
  });
});
