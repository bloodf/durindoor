import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { CLAUDE_SYSTEM_PROMPT } from "../../open-sse/config/appConstants.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const prompt = "Keep the answer concise.";
const block = (text, cache_control) => ({ type: "text", text, ...(cache_control && { cache_control }) });
const cache = { type: "ephemeral", ttl: "1h" };

describe("upstream #5775 Claude system ordering", () => {
  it("keeps a cached leading identity and caller content before injection, once", () => {
    const identity = block(`${CLAUDE_SYSTEM_PROMPT}\nCaller instruction`, cache);
    const caller = block("More caller content");
    const body = { system: [identity, caller], messages: [] };
    injectSystemPrompt(body, FORMATS.CLAUDE, prompt);
    injectSystemPrompt(body, FORMATS.CLAUDE, prompt);
    expect(body.system).toEqual([identity, block(prompt), caller]);
    expect(body.system[0]).toBe(identity);
    expect(identity.cache_control).toEqual(cache);
  });

  it("retains insertion before a later cache boundary and caller block order", () => {
    const identity = block(CLAUDE_SYSTEM_PROMPT);
    const caller = block("Caller instruction", cache);
    const body = { system: [identity, caller] };
    injectSystemPrompt(body, FORMATS.CLAUDE, prompt);
    expect(body.system).toEqual([identity, block(prompt), caller]);
  });

  it("preserves existing behavior for other Claude systems and OpenAI messages", () => {
    const cached = block("Caller instruction", cache);
    const claude = { system: [cached] };
    injectSystemPrompt(claude, FORMATS.CLAUDE, prompt);
    expect(claude.system).toEqual([block(prompt), cached]);
    const stringBody = { system: "Caller instruction" };
    injectSystemPrompt(stringBody, FORMATS.CLAUDE, prompt);
    injectSystemPrompt(stringBody, FORMATS.CLAUDE, prompt);
    expect(stringBody.system).toBe(`Caller instruction\n\n${prompt}`);
    const openai = { messages: [{ role: "system", content: CLAUDE_SYSTEM_PROMPT }, { role: "user", content: "Hello" }] };
    injectSystemPrompt(openai, FORMATS.OPENAI, prompt);
    injectSystemPrompt(openai, FORMATS.OPENAI, prompt);
    expect(openai.messages).toEqual([{ role: "system", content: `${CLAUDE_SYSTEM_PROMPT}\n\n${prompt}` }, { role: "user", content: "Hello" }]);
  });
});
