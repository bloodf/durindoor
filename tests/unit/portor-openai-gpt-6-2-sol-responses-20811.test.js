// OmniRoute #20811: openai/gpt-6.2-sol must route through Responses. Without a
// catalog row the model fell back to Chat Completions, which rejects function
// tools combined with reasoning_effort (HTTP 400).
import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("openai gpt-6.2-sol Responses routing (#20811)", () => {
  it("targets openai-responses for the bare id and the effort-suffixed id", () => {
    expect(getModelTargetFormat("openai", "gpt-6.2-sol")).toBe(FORMATS.OPENAI_RESPONSES);
    expect(getModelTargetFormat("openai", "gpt-6.2-sol(high)")).toBe(FORMATS.OPENAI_RESPONSES);
  });

  it("builds the /v1/responses URL", () => {
    const transport = resolveTransport("openai", FORMATS.OPENAI_RESPONSES);
    const url = new DefaultExecutor("openai").buildUrl("gpt-6.2-sol", true, 0, { runtimeTransport: transport });
    expect(url).toBe("https://api.openai.com/v1/responses");
  });
});
