import { describe, expect, it } from "vitest";
import { getProvidersByKind, isHiddenProvider } from "../../src/shared/constants/providers.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

describe("retired MiMo Free service", () => {
  it("hides the retired service from provider selection while retaining its route", () => {
    expect(isHiddenProvider("mimo-free")).toBe(true);
    expect(getProvidersByKind("llm").some((provider) => provider.id === "mimo-free")).toBe(false);
    expect(PROVIDERS["mimo-free"].baseUrl).toBe("https://api.xiaomimimo.com/api/free-ai/openai/chat");
  });
});
