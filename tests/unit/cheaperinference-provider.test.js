// #1164: Cheaper Inference provider (OpenAI Chat + stateless Responses).
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getModelTargetFormat, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getExecutor } from "../../open-sse/executors/index.js";

const RESPONSES_URL = "https://api.cheaperinference.com/v1/responses";
const CHAT_URL = "https://api.cheaperinference.com/v1/chat/completions";

describe("cheaperinference registry", () => {
  it("registers an API-key OpenAI provider with chat and responses transports", () => {
    const p = PROVIDERS.cheaperinference;
    expect(p.baseUrl).toBe(CHAT_URL);
    expect(p.validateUrl).toBe("https://api.cheaperinference.com/v1/models");
    expect(p.transports.map((t) => [t.format, t.baseUrl])).toEqual([["openai", CHAT_URL], ["openai-responses", RESPONSES_URL]]);
    expect(PROVIDER_ID_TO_ALIAS.cheaperinference).toBe("cinf");
  });

  it("routes GPT-5.x models to Responses and the rest to Chat by targetFormat", () => {
    expect(getModelTargetFormat("cinf", "gpt-5.5")).toBe("openai-responses");
    expect(getModelTargetFormat("cinf", "claude-haiku-4.5")).not.toBe("openai-responses");
  });

  it("uses the default executor (no custom executor needed)", () => {
    expect(getExecutor("cheaperinference")).toBeInstanceOf(DefaultExecutor);
  });

  it("forces store:false on Responses bodies, overriding a client store:true", () => {
    const exec = new DefaultExecutor("cheaperinference");
    const out = exec.transformRequest("gpt-5.5", { model: "gpt-5.5", input: [{ type: "message", role: "user", content: "hi" }], store: true }, true, {
      runtimeTransport: { format: "openai-responses", baseUrl: RESPONSES_URL },
    });
    expect(out.store).toBe(false);
  });

  it("never adds store to Chat Completions bodies", () => {
    const exec = new DefaultExecutor("cheaperinference");
    const out = exec.transformRequest("claude-haiku-4.5", { model: "claude-haiku-4.5", messages: [{ role: "user", content: "hi" }] }, true, {
      runtimeTransport: { format: "openai", baseUrl: CHAT_URL },
    });
    expect(out).not.toHaveProperty("store");
  });
});
