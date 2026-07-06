import { afterEach, describe, expect, it, vi } from "vitest";
import { BedrockExecutor, openAIToBedrockConverse } from "../../open-sse/executors/bedrock.js";
import {
  ChipotleExecutor,
  extractAmeliaText,
  parseStompMessageBody,
  randomServerId,
  randomSessionId,
} from "../../open-sse/executors/chipotle.js";
import {
  InnerAiExecutor,
  findModel,
  parseCredential,
} from "../../open-sse/executors/inner-ai.js";
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

  it("registers Bedrock with native Converse URL and OpenAI request conversion", () => {
    const executor = getExecutor("bedrock");
    const converted = openAIToBedrockConverse("anthropic.claude-sonnet-4-6", {
      messages: [
        { role: "system", content: "Be concise" },
        { role: "user", content: "hello" },
      ],
      max_tokens: 128,
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "Lookup a thing",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        },
      ],
      tool_choice: "required",
    });

    expect(executor).toBeInstanceOf(BedrockExecutor);
    expect(hasSpecializedExecutor("bedrock")).toBe(true);
    expect(
      executor.buildUrl("anthropic.claude-sonnet-4-6", false, 0, {
        providerSpecificData: { region: "eu-west-2" },
      })
    ).toBe("https://bedrock-runtime.eu-west-2.amazonaws.com/model/anthropic.claude-sonnet-4-6/converse");
    expect(converted.system).toEqual([{ text: "Be concise" }]);
    expect(converted.messages[0]).toEqual({ role: "user", content: [{ text: "hello" }] });
    expect(converted.inferenceConfig.maxTokens).toBe(128);
    expect(converted.toolConfig.toolChoice).toEqual({ any: {} });
    expect(PROVIDERS.bedrock.baseUrl).toContain("bedrock-runtime");
    expect(PROVIDER_MODELS.bedrock.some((model) => model.id === "anthropic.claude-sonnet-4-6")).toBe(true);
  });

  it("wraps a Bedrock Converse response into OpenAI JSON without live AWS calls", async () => {
    const executor = new BedrockExecutor(() => ({
      send: vi.fn(async () => ({
        output: {
          message: {
            content: [
              { text: "hi" },
              { toolUse: { toolUseId: "toolu_1", name: "lookup", input: { q: "x" } } },
            ],
          },
        },
        stopReason: "tool_use",
        usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
      })),
    }));

    const { response, transformedBody } = await executor.execute({
      model: "anthropic.claude-sonnet-4-6",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "bedrock-key", providerSpecificData: { region: "us-east-1" } },
    });

    const body = await response.json();
    expect(transformedBody.modelId).toBe("anthropic.claude-sonnet-4-6");
    expect(body.choices[0].message.tool_calls[0].function.name).toBe("lookup");
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.usage.total_tokens).toBe(9);
  });

  it("parses Chipotle Amelia STOMP messages and exposes a no-auth executor", async () => {
    const frame = 'MESSAGE\ndestination:/user/queue/session\n\n{"type":"message","body":{"text":"burrito"}}\0';
    const fakeClient = { chat: vi.fn(async () => "pepper reply") };
    const executor = new ChipotleExecutor(async () => fakeClient);

    const { response } = await executor.execute({
      model: "pepper-1",
      body: { messages: [{ role: "user", content: "menu" }] },
      stream: false,
      credentials: {},
    });

    expect(randomServerId()).toMatch(/^\d{3}$/);
    expect(randomSessionId()).toMatch(/^[a-f0-9]{32}$/);
    expect(extractAmeliaText(parseStompMessageBody(frame))).toBe("burrito");
    expect(getExecutor("chipotle")).toBeInstanceOf(ChipotleExecutor);
    expect(PROVIDERS.chipotle.noAuth).toBe(true);
    expect(PROVIDER_MODELS.pepper[0].id).toBe("pepper-1");
    expect((await response.json()).choices[0].message.content).toBe("pepper reply");
    expect(fakeClient.chat).toHaveBeenCalledWith("menu", 15000, undefined);
  });

  it("resolves Inner.ai credentials/models and converts text tool blocks", async () => {
    const payload = Buffer.from(JSON.stringify({ device_id: "dev-1", plan: "pro" })).toString("base64url");
    const token = `eyJhbGciOiJub25lIn0.${payload}.sig`;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { email: "profile@example.com" } })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "model-1", llm_model: "gpt-4o", ai_model_categories: [{ unique_identifier: "text" }] },
              { id: "image-1", llm_model: "flux", ai_model_categories: [{ unique_identifier: "image" }] },
            ],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"text","item":"<tool>{\\"name\\":\\"lookup\\",\\"arguments\\":{\\"q\\":\\"abc\\"}}</tool>"}\n\ndata: {"type":"end_stream","item":"end"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        )
      );
    const executor = new InnerAiExecutor();

    expect(parseCredential(`token=${token} user@example.com`)).toEqual({
      token,
      credEmail: "user@example.com",
    });
    expect(findModel([{ llm_model: "gpt-4o", id: "model-1" }], "4o")).toEqual({
      llm_model: "gpt-4o",
      id: "model-1",
    });

    const { response, transformedBody } = await executor.execute({
      model: "gpt-4o",
      stream: false,
      credentials: { apiKey: `${token} user@example.com` },
      body: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "use a tool" }],
        tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
      },
    });

    const body = await response.json();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(transformedBody.ai_model.id).toBe("model-1");
    expect(transformedBody.message).toContain("Available tools:");
    expect(body.choices[0].message.tool_calls[0].function).toEqual({
      name: "lookup",
      arguments: "{\"q\":\"abc\"}",
    });
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(getExecutor("inner-ai")).toBeInstanceOf(InnerAiExecutor);
    expect(getExecutor("in-ai")).toBeInstanceOf(InnerAiExecutor);
    expect(PROVIDER_MODELS["in-ai"].some((model) => model.id === "gpt-4o")).toBe(true);
  });
});
