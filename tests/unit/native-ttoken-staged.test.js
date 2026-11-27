// Staged contracts only. No registration, real credentials, or network.
import { describe, it, expect } from "vitest";
import { TTOKEN_PROVIDER as provider } from "../../open-sse/services/providerParity/native-ttoken/index.js";
import { parseModel } from "../../open-sse/services/model.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const CHAT = "https://api.ttoken.dev/v1/chat/completions";
const MODELS = "https://api.ttoken.dev/v1/models";

describe("staged TTOken contract", () => {
  it("contains the source seed, Gateway key auth and only the chat lane", () => {
    expect(provider).toMatchObject({ id: "ttoken", alias: "ttoken", category: "apikey", authType: "apikey", passthroughModels: true, serviceKinds: ["llm"], transport: { baseUrl: CHAT, validateUrl: MODELS }, modelsFetcher: { url: MODELS, type: "openai" } });
    expect(provider.display.textIcon).toBe("TT");
    expect(provider.models.map(({ id }) => id)).toEqual(["deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3-flash", "qwen/qwen3.8-27b", "netra/deepseek-v4.1-flash-netra", "ttoken/auto"]);
    expect(provider.transports).toBeUndefined();
    expect(provider.oauth).toBeUndefined();
  });

  it("preserves first-slash model IDs and the literal upstream seed spelling", () => {
    expect(parseModel("ttoken/deepseek/deepseek-v4.1-flash")).toMatchObject({ provider: "ttoken", model: "deepseek/deepseek-v4.1-flash" });
    expect(parseModel("ttoken/ttoken/auto")).toMatchObject({ provider: "ttoken", model: "ttoken/auto" });
  });

  it("uses the existing executor with injected staging configuration", () => {
    const previous = PROVIDERS.ttoken;
    try {
      PROVIDERS.ttoken = { ...provider.transport, format: "openai", authType: "apikey" };
      const executor = new DefaultExecutor("ttoken");
      expect(executor.buildUrl("vendor/example", false)).toBe(CHAT);
      expect(executor.buildUrl("vendor/example", true)).toBe(CHAT);
      expect(executor.buildHeaders({ apiKey: "synthetic-key" }, true).Authorization).toBe("Bearer synthetic-key");
    } finally {
      if (previous === undefined) delete PROVIDERS.ttoken;
      else PROVIDERS.ttoken = previous;
    }
  });
});
