// OpenAI → Gemini / Cursor / CommandCode request translation.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const O2G = (body, stream) => translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "m", body, stream, null, "gemini");
const O2C = (body) => translateRequest(FORMATS.OPENAI, FORMATS.CURSOR, "m", body, true, null, "cursor");
const O2CC = (body) => translateRequest(FORMATS.OPENAI, FORMATS.COMMANDCODE, "m", body, true, null, "commandcode");

describe.each([true, false])("OpenAI → Gemini (stream=%s)", (stream) => {
  it("multiple system messages are all kept", () => {
    const out = O2G({
      messages: [
        { role: "system", content: "  RULE_ONE\n" },
        { role: "user", content: "hi" },
        { role: "system", content: "\tRULE_TWO  " },
        { role: "system", content: "" },
        { role: "system", content: [{ type: "text", text: "\nRULE_THREE " }] },
      ],
    }, stream);
    expect(out.systemInstruction).toEqual({
      role: "user",
      parts: [
        { text: "  RULE_ONE\n" },
        { text: "\tRULE_TWO  " },
        { text: "" },
        { text: "\nRULE_THREE " },
      ],
    });
    expect(out.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });

  it("does not promote conversation text into system instructions", () => {
    const out = O2G({
      messages: [
        { role: "user", content: "RULE_ONE" },
        { role: "assistant", content: "RULE_TWO" },
        { role: "user", content: "hi" },
      ],
    }, stream);
    expect(out.systemInstruction).toBeUndefined();
    expect(out.contents).toEqual([
      { role: "user", parts: [{ text: "RULE_ONE" }] },
      { role: "model", parts: [{ text: "RULE_TWO" }] },
      { role: "user", parts: [{ text: "hi" }] },
    ]);
  });

  it("preserves a single system instruction beside a user turn", () => {
    const out = O2G({
      messages: [
        { role: "system", content: "  rule\n" },
        { role: "user", content: "hi" },
      ],
    }, stream);
    expect(out.systemInstruction).toEqual({ role: "user", parts: [{ text: "  rule\n" }] });
  });

  it("retains the lone system message as a user turn", () => {
    const out = O2G({ messages: [{ role: "system", content: "rule" }] }, stream);
    expect(out.systemInstruction).toBeUndefined();
    expect(out.contents).toEqual([{ role: "user", parts: [{ text: "rule" }] }]);
  });

  it("preserves native Gemini system parts on same-format passthrough", () => {
    const body = {
      systemInstruction: { role: "user", parts: [{ text: "  first\n" }, { text: "\tsecond " }] },
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    };
    const expected = structuredClone(body);
    const out = translateRequest(FORMATS.GEMINI, FORMATS.GEMINI, "m", body, stream, null, "gemini");
    expect(out.systemInstruction).toEqual(expected.systemInstruction);
    expect(out.contents).toEqual(expected.contents);
  });
});

describe("OpenAI → Cursor", () => {
  // openai-to-cursor.js:12-24 — image content fully dropped (text only)
  // KNOWN BUG
  it.fails("image content is preserved", () => {
    const out = O2C({
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ] }],
    });
    expect(JSON.stringify(out), "image dropped").toContain("AAAA");
  });

  describe("output-token caps", () => {
    const translate = (body, stream) => translateRequest(
      FORMATS.OPENAI, FORMATS.CURSOR, "m",
      { messages: [{ role: "user", content: "hi" }], ...body }, stream, null, "cursor"
    );

    const expectBadRequest = (body, stream, message) => {
      let error;
      try {
        translate(body, stream);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe(message);
    };

    for (const stream of [true, false]) {
      describe(`stream=${stream}`, () => {
        it.each([
          ["max_tokens", 64],
          ["max_completion_tokens", 64],
          ["max_tokens", 100],
          ["max_tokens", 200],
          ["max_completion_tokens", 200],
          ["max_tokens", 1],
          ["max_tokens", Number.MAX_SAFE_INTEGER],
        ])("rejects unsupported %s=%s instead of claiming enforcement", (field, cap) => {
          expectBadRequest({ [field]: cap }, stream,
            `Cursor transport does not support ${field}; explicit output-token limits cannot be enforced`);
        });

        for (const field of ["max_tokens", "max_completion_tokens"]) {
          it.each([0, -1, 1.5, "200", false, null, NaN, Infinity, {}, []])(
            `rejects invalid ${field}=%j`, (cap) => {
              expectBadRequest({ [field]: cap }, stream, `${field} must be a positive integer`);
            }
          );
        }

        it.each([
          [{ max_tokens: 100, max_completion_tokens: 200 }, "max_tokens", false],
          [{ max_tokens: 100, max_completion_tokens: 0 }, "max_tokens", false],
          [{ max_tokens: 0, max_completion_tokens: 200 }, "max_tokens", true],
          [{ max_tokens: null, max_completion_tokens: 200 }, "max_tokens", true],
          [{ max_tokens: undefined, max_completion_tokens: 200 }, "max_completion_tokens", false],
        ])("uses the defined legacy cap before the completion cap: %j", (body, field, invalid) => {
          expectBadRequest(body, stream, invalid ? `${field} must be a positive integer` :
            `Cursor transport does not support ${field}; explicit output-token limits cannot be enforced`);
        });

        it("keeps uncapped requests uncapped", () => {
          const out = translate({}, stream);
          expect(out.messages).toEqual([{ role: "user", content: "hi" }]);
          expect(out.max_tokens).toBeUndefined();
          expect(out.max_completion_tokens).toBeUndefined();
        });

        it("leaves same-format Cursor caps untouched without promising enforcement", () => {
          const body = {
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 100,
            max_completion_tokens: 200,
          };
          const out = translateRequest(FORMATS.CURSOR, FORMATS.CURSOR, "m", body, stream, null, "cursor");
          expect(out.max_tokens).toBe(100);
          expect(out.max_completion_tokens).toBe(200);
        });
      });
    }
  });
});

describe("OpenAI → CommandCode", () => {
  it("malformed tool arguments are not silently emptied", () => {
    expect(() => O2CC({
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "", tool_calls: [
          { id: "c1", type: "function", function: { name: "f", arguments: "{bad" } },
        ] },
        { role: "tool", tool_call_id: "c1", content: "r" },
      ],
    })).toThrow("invalid arguments");
  });

  it("image content is preserved", () => {
    const out = O2CC({
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
      ] }],
    });
    expect(JSON.stringify(out), "image omitted").toContain("BBBB");
  });
});
