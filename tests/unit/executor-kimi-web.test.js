import { describe, it, expect } from "vitest";

import { KimiWebExecutor, resolveModelConfig } from "../../open-sse/executors/kimi-web.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { getDefaultModel, getModelsByProviderId } from "../../open-sse/config/providerModels.js";

import { extractKimiJwt } from "../../src/lib/providers/webCookieAuth.js";

describe("kimi-web executor", () => {
  it("getExecutor returns the specialized KimiWebExecutor", () => {
    const executor = getExecutor("kimi-web");
    expect(executor).toBeInstanceOf(KimiWebExecutor);
  });

  it("resolveModelConfig maps k2d6-thinking to thinking=true", () => {
    expect(resolveModelConfig("k2d6-thinking")).toEqual({
      scenario: "SCENARIO_K2D5",
      thinking: true,
    });
  });

  it("resolveModelConfig defaults non-special ids to thinking=false", () => {
    expect(resolveModelConfig("k2d6")).toEqual({
      scenario: "SCENARIO_K2D5",
      thinking: false,
    });
    expect(resolveModelConfig("kimi-default")).toEqual({
      scenario: "SCENARIO_K2D5",
      thinking: false,
    });
  });

  it("catalog lists only currently supported non-agent kimi-web models", () => {
    const models = getModelsByProviderId("kimi-web");
    expect(models.map((m) => ({ id: m.id, name: m.name }))).toEqual([
      { id: "k2d6", name: "K2.6 Instant" },
      { id: "k2d6-thinking", name: "K2.6 Thinking" },
    ]);
    expect(models.find((m) => m.id === "k2d6-thinking")?.supportsReasoning).toBe(true);
    expect(models.some((m) => m.id.includes("agent"))).toBe(false);
    expect(
      models.some((m) => ["kimi-default", "kimi-k2.6", "kimi-128k"].includes(m.id))
    ).toBe(false);
  });

  it("extractKimiJwt pulls kimi-auth out of a full Cookie header", () => {
    const jwt = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJ1c2VyIn0.signature";
    expect(extractKimiJwt(`_ga=1; kimi-auth=${jwt}; theme=dark`)).toBe(jwt);
    expect(extractKimiJwt(jwt)).toBe(jwt);
    expect(extractKimiJwt("cookie: kimi-auth=abc.def.ghi")).toBe("abc.def.ghi");
    expect(extractKimiJwt("")).toBe("");
  });

  it("default model for kimi-web is k2d6", () => {
    expect(getDefaultModel("kimi-web")).toBe("k2d6");
  });
});
