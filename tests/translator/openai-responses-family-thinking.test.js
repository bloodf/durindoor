import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const translate = (model, provider, body, context) => translateRequest(
  FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, model,
  { model, messages: [{ role: "user", content: "hello" }], ...body },
  false, null, provider, null, [], null, null, context,
);

describe("unlisted OpenAI Responses family reasoning", () => {
  it.each(["gpt-7-future", "gpt-9-future"])("preserves explicit effort for %s", (model) => {
    expect(getModelTargetFormat("openai", model)).toBe(FORMATS.OPENAI_RESPONSES);
    expect(getThinkingLevels("openai", model)).toBeNull();
    expect(translate(model, "openai", { reasoning_effort: "max" }).reasoning?.effort).toBe("max");
    expect(translate(model, "openai", { reasoning: { effort: "high" } }).reasoning?.effort).toBe("high");
  });

  it("keeps other providers and known non-chat models unchanged", () => {
    expect(getCapabilitiesForModel("xai", "gpt-7-future").reasoning).toBe(false);
    expect(translate("gpt-7-future", "xai", { reasoning_effort: "high" }).reasoning).toBeUndefined();
    expect(getCapabilitiesForModel("openai", "gpt-6.1-sol-image", "image").reasoning).toBe(false);
    expect(getCapabilitiesForModel("openai", "text-embedding-3-small").reasoning).toBe(false);
  });

  it("keeps explicit model capability overrides and known effort metadata", () => {
    expect(translate("gpt-7-future", "openai", { reasoning_effort: "high" }, {
      modelCapabilities: { reasoning: false },
    }).reasoning?.effort).toBeUndefined();
    expect(getThinkingLevels("openai", "gpt-6.1-terra")).toContain("xhigh");
    expect(getCapabilitiesForModel("openai", "gpt-6.1-terra").thinkingLevelsUnknown).toBeUndefined();
  });
});
