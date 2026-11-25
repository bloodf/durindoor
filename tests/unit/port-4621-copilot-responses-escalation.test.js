import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { GithubExecutor } from "../../open-sse/executors/github.js";

const chatRejects = (body) => vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
  response: new Response(body, { status: 400 }),
});

describe("Copilot Responses-only models (upstream decolua/9router#4621)", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
    JSON.stringify({ error: { code: "unsupported_api_for_model", message: "model is not available on this endpoint" } }),
  ])("escalates to /responses on: %s", async (errorBody) => {
    const executor = new GithubExecutor();
    const chat = chatRejects(errorBody);
    const responses = vi.spyOn(executor, "executeWithResponsesEndpoint").mockResolvedValue({ via: "responses" });

    await expect(executor.execute({ model: "gpt-6-luna", body: { messages: [] }, log: null }))
      .resolves.toEqual({ via: "responses" });
    expect(chat).toHaveBeenCalledOnce();
    expect(responses).toHaveBeenCalledOnce();
  });

  it("keeps an unrelated 400 on the chat route", async () => {
    const executor = new GithubExecutor();
    chatRejects(JSON.stringify({ error: { message: "messages: field required" } }));
    const responses = vi.spyOn(executor, "executeWithResponsesEndpoint");

    const result = await executor.execute({ model: "gpt-6-luna", body: { messages: [] }, log: null });

    expect(result.response.status).toBe(400);
    expect(responses).not.toHaveBeenCalled();
  });

  it.each(["gpt-6-luna", "gpt-6.1-sol"])("sends %s a max_completion_tokens cap on the chat route", (model) => {
    const executor = new GithubExecutor();
    for (const cap of [{ max_tokens: 64 }, { max_completion_tokens: 64 }]) {
      const out = executor.transformRequest(model, { messages: [], ...cap }, true, {});
      expect(out.max_completion_tokens).toBe(64);
      expect(out).not.toHaveProperty("max_tokens");
    }
  });

  it("keeps the legacy cap spelling for older Copilot chat models", () => {
    const out = new GithubExecutor().transformRequest("gpt-4.1", { messages: [], max_completion_tokens: 64 }, true, {});
    expect(out.max_tokens).toBe(64);
    expect(out).not.toHaveProperty("max_completion_tokens");
  });
});
