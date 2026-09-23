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

  it("resolveModelConfig maps legacy k2d6-thinking to k2d6 at LOW effort", () => {
    expect(resolveModelConfig("k2d6-thinking")).toMatchObject({
      model: "k2d6",
      scenario: "SCENARIO_K2D5",
      kimiplusId: "",
      defaultEffort: "REASONING_EFFORT_LOW",
    });
  });

  it("resolveModelConfig defaults non-special ids to k2d6 with reasoning off", () => {
    for (const id of ["k2d6", "kimi-default"]) {
      expect(resolveModelConfig(id)).toMatchObject({
        model: "k2d6",
        scenario: "SCENARIO_K2D5",
        defaultEffort: "REASONING_EFFORT_NONE",
      });
    }
  });

  it("resolveModelConfig maps k3 to the OK Computer scenario from the live catalog", () => {
    expect(resolveModelConfig("k3")).toEqual({
      model: "k3",
      scenario: "SCENARIO_OK_COMPUTER",
      kimiplusId: "ok-computer",
      efforts: ["REASONING_EFFORT_LOW", "REASONING_EFFORT_HIGH", "REASONING_EFFORT_MAX"],
      defaultEffort: "REASONING_EFFORT_HIGH",
    });
  });

  it("catalog lists only currently supported non-agent kimi-web models", () => {
    const models = getModelsByProviderId("kimi-web");
    expect(models.map((m) => ({ id: m.id, name: m.name }))).toEqual([
      { id: "k2d6", name: "K2.6 Instant" },
      { id: "k2d6-thinking", name: "K2.6 Thinking" },
      { id: "k3", name: "K3" },
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
