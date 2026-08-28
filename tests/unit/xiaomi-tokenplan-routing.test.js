import { describe, expect, it } from "vitest";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";
import { XiaomiTokenplanExecutor } from "../../open-sse/executors/xiaomi-tokenplan.js";

const API_KEY = { apiKey: "test-key", providerSpecificData: { region: "sgp" } };
const CLAUDE_URL = "https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages";

describe("Xiaomi Token Plan request routing", () => {
  it("sends the Claude-native model's translated body through its Claude endpoint and auth", () => {
    const { runtimeTransport, targetFormat } = resolveRequestTransport({
      provider: "xiaomi-tokenplan",
      alias: "xiaomi-tokenplan",
      model: "mimo-v2.5-pro-claude",
      sourceFormat: "openai",
      credentials: API_KEY,
    });
    const executor = new XiaomiTokenplanExecutor();
    const credentials = { ...API_KEY, runtimeTransport };

    expect(targetFormat).toBe("claude");
    expect(runtimeTransport?.format).toBe("claude");
    expect(executor.buildUrl("mimo-v2.5-pro", true, 0, credentials)).toBe(CLAUDE_URL);
    expect(executor.buildHeaders(credentials, true)).toMatchObject({ "x-api-key": "test-key" });
    expect(executor.buildHeaders(credentials, true)).not.toHaveProperty("Authorization");
  });

  it("keeps an unpinned model on the source-format transport", () => {
    const { runtimeTransport, targetFormat } = resolveRequestTransport({
      provider: "xiaomi-tokenplan",
      alias: "xiaomi-tokenplan",
      model: "mimo-v2.5-pro",
      sourceFormat: "openai",
      credentials: API_KEY,
    });

    expect(targetFormat).toBe("openai");
    expect(runtimeTransport?.format).toBe("openai");
  });
});
