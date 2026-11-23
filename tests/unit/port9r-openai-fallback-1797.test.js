import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn(), evictResponseDispatcher: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openAIResponsesBodyToOpenAI } from "../../open-sse/translator/response/openai-responses-nonstream.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rejected = () => json({ error: { message: "This is not a chat model and thus not supported in the /v1/chat/completions endpoint." } }, 404);
const options = (stream = false) => ({ model: "gpt-5.3-codex", body: { messages: [{ role: "user", content: "hello" }], max_tokens: 32 }, stream, credentials: { apiKey: "test" } });

describe("OpenAI Responses fallback", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([false, true])("replays a rejected chat request as Responses (stream=%s)", async (stream) => {
    proxyAwareFetch.mockResolvedValueOnce(rejected()).mockResolvedValueOnce(json({ id: "resp_1", object: "response", output: [] }));
    const onProviderAttempt = vi.fn().mockReturnValue(123);
    const result = await new DefaultExecutor("openai").execute({ ...options(stream), onProviderAttempt });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(onProviderAttempt).toHaveBeenCalledTimes(2);
    expect(proxyAwareFetch.mock.calls[1][0]).toMatch(/\/responses$/);
    const body = JSON.parse(proxyAwareFetch.mock.calls[1][1].body);
    expect(body.input[0].content[0].text).toBe("hello");
    expect(body.max_output_tokens).toBe(32);
    expect(body.stream).toBe(stream);
    expect(result.responseFormat).toBe(FORMATS.OPENAI_RESPONSES);
    expect(result.attemptStartedAt).toBe(123);
  });

  it("does not retry unrelated errors or another provider", async () => {
    proxyAwareFetch.mockResolvedValueOnce(json({ error: { message: "bad request" } }, 400));
    expect((await new DefaultExecutor("openai").execute(options())).response.status).toBe(400);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    proxyAwareFetch.mockClear();
    proxyAwareFetch.mockResolvedValueOnce(rejected());
    expect((await new DefaultExecutor("openai-compatible-test").execute(options())).response.status).toBe(404);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("returns a failed Responses attempt without another fallback", async () => {
    proxyAwareFetch.mockResolvedValueOnce(rejected()).mockResolvedValueOnce(json({ error: { message: "invalid" } }, 400));
    const result = await new DefaultExecutor("openai").execute(options());
    expect(result.response.status).toBe(400);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("honors the transport ceiling", async () => {
    proxyAwareFetch.mockResolvedValueOnce(rejected());
    const result = await new DefaultExecutor("openai").execute({ ...options(), requestPolicy: { maxTransportAttempts: 1 } });
    expect(result.response.status).toBe(404);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("retries an unsupported token field once without losing its limit", async () => {
    const executor = new DefaultExecutor("openai");
    executor.transformRequest = (_model, body) => ({ ...body });
    const error = { error: { code: "unsupported_parameter", param: "max_tokens", message: "unsupported max_tokens" } };
    proxyAwareFetch.mockResolvedValueOnce(json(error, 400)).mockResolvedValueOnce(json(error, 400));
    const result = await executor.execute(options());
    expect(result.response.status).toBe(400);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(proxyAwareFetch.mock.calls[1][1].body)).toMatchObject({ max_completion_tokens: 32 });
  });

  it("projects Responses tools and usage in JSON and streaming output", () => {
    const response = { id: "resp_1", model: "gpt-5", status: "completed", output: [{ type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" }], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } };
    const completion = openAIResponsesBodyToOpenAI(response);
    expect(completion.choices[0].message.tool_calls[0].function.name).toBe("lookup");
    expect(completion.usage.total_tokens).toBe(14);
    const chunk = openaiResponsesToOpenAIResponse({ type: "response.completed", response }, {});
    const chunks = Array.isArray(chunk) ? chunk : [chunk];
    expect(chunks.some((item) => item.choices?.[0]?.delta?.tool_calls)).toBe(true);
    expect(chunks.at(-1).usage.total_tokens).toBe(14);
  });

  it("preserves cancellation before dispatch", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new DefaultExecutor("openai").execute({ ...options(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});
