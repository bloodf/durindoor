import { describe, expect, it } from "vitest";
import { openaiToCommandCodeRequest } from "../../open-sse/translator/request/openai-to-commandcode.js";
import { CommandCodeExecutor } from "../../open-sse/executors/commandcode.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const MODEL = "deepseek/deepseek-v4-pro";
const translate = (limit) => openaiToCommandCodeRequest(MODEL, { messages: [{ role: "user", content: "hi" }], ...limit }, true).params.max_tokens;

describe("upstream PR #4691: CommandCode max_tokens ceiling", () => {
  it.each([{ max_tokens: 1000000 }, { max_output_tokens: 384000 }])("clamps %j to 200000", (limit) => {
    expect(translate(limit)).toBe(200000);
  });

  it("passes a lower limit through", () => {
    expect(translate({ max_tokens: 8192 })).toBe(8192);
  });

  it("clamps a body that is already in CommandCode shape", () => {
    const executor = new CommandCodeExecutor();
    expect(executor.transformRequest(MODEL, { params: { max_tokens: 384000 } }, true, {}).params.max_tokens).toBe(200000);
    expect(executor.transformRequest(MODEL, { params: { max_tokens: 4096 } }, true, {}).params.max_tokens).toBe(4096);
  });

  it("advertises no more than the wire accepts", () => {
    expect(getCapabilitiesForModel("commandcode", MODEL).maxOutput).toBe(200000);
  });
});
