// decolua/9router#5636: a `developer` turn is OpenAI's spelling of a system turn.
// Targets other than OpenAI / Responses / Codex dropped it (Gemini, Kiro, Cursor).
// translateRequest now normalizes it once, on a request-local copy.
import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE } from "../../open-sse/translator/schema/index.js";

const DEV_TEXT = "Always answer in French.";
const devBody = () => ({
  messages: [
    { role: ROLE.DEVELOPER, content: DEV_TEXT },
    { role: ROLE.USER, content: "hi" },
  ],
});
const T = (target, body) =>
  translateRequest(FORMATS.OPENAI, target, "m", body, true, null, "anthropic-compatible-x");

describe("developer role reaches non-OpenAI targets as a system turn", () => {
  it("openai → claude keeps the developer text as the system prompt", () => {
    const out = T(FORMATS.CLAUDE, devBody());
    expect(JSON.stringify(out.system)).toContain(DEV_TEXT);
  });

  it("openai → gemini keeps the developer text in systemInstruction", () => {
    const out = T(FORMATS.GEMINI, devBody());
    expect(JSON.stringify(out.systemInstruction)).toContain(DEV_TEXT);
  });

  it("openai → kiro keeps the developer text in the translated request", () => {
    expect(JSON.stringify(T(FORMATS.KIRO, devBody()))).toContain(DEV_TEXT);
  });

  it("openai → cursor treats developer exactly like system", () => {
    const sys = devBody();
    sys.messages[0].role = ROLE.SYSTEM;
    const out = T(FORMATS.CURSOR, devBody());
    expect(out).toEqual(T(FORMATS.CURSOR, sys));
    expect(JSON.stringify(out)).toContain(DEV_TEXT);
  });

  it("does not mutate the caller's body", () => {
    const body = devBody();
    T(FORMATS.GEMINI, body);
    expect(body.messages[0].role).toBe(ROLE.DEVELOPER);
  });

  it("responses input message items with role developer reach claude as system", () => {
    const body = {
      input: [
        { type: "message", role: ROLE.DEVELOPER, content: [{ type: "input_text", text: DEV_TEXT }] },
        { type: "message", role: ROLE.USER, content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "m", body, true, null, "anthropic-compatible-x");
    expect(JSON.stringify(out.system)).toContain(DEV_TEXT);
    expect(body.input[0].role).toBe(ROLE.DEVELOPER);
  });

  it.each([
    [FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES],
    [FORMATS.OPENAI_RESPONSES, FORMATS.CODEX],
    [FORMATS.CODEX, FORMATS.CODEX],
  ])("%s → %s keeps the native developer role", (source, target) => {
    const body = {
      input: [
        { type: "message", role: ROLE.DEVELOPER, content: [{ type: "input_text", text: DEV_TEXT }] },
        { type: "message", role: ROLE.USER, content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    const out = translateRequest(source, target, "gpt-5", body, true, null, "codex");
    expect((out.input || out.messages).map((item) => item.role)).toEqual([ROLE.DEVELOPER, ROLE.USER]);
  });
});
