// Per-transport thinking shape (#1561, upstream 9router d07e5bc3).
// Unverified: the upstream 503 "Endpoint is unavailable" was not reproduced live.
import "../translator/registerAll.js";
import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const MODEL = "deepseek-v4-flash-vision-exp";
const run = (target, intent) => {
  const body = { model: MODEL, input: "hi" };
  applyThinking(target, MODEL, body, "opencode-go", intent, getCapabilitiesForModel("opencode-go", MODEL));
  return body;
};

describe("opencode-go /responses transport thinking shape", () => {
  it("nests reasoning and drops Chat-shaped fields on openai-responses", () => {
    const body = run("openai-responses", { mode: "level", level: "high" });
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it("keeps the model's Chat shape on the openai transport", () => {
    const body = run("openai", { mode: "level", level: "high" });
    expect(body.reasoning).toBeUndefined();
    expect(body.reasoning_effort ?? body.thinking).toBeDefined();
  });
});
