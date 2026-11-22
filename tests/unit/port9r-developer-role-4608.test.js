import "../translator/registerAll.js";
import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE } from "../../open-sse/translator/schema/index.js";

describe("OpenAI developer instructions", () => {
  it.each([["openai", ROLE.DEVELOPER], ["other", ROLE.SYSTEM]])("uses the supported role for %s", (provider, role) => {
    const body = { messages: [{ role: ROLE.DEVELOPER, content: "instruction" }] };
    const result = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "test", body, false, null, provider);
    expect(result.messages[0]).toMatchObject({ role, content: "instruction" });
  });
});
