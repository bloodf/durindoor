// Real Claude Code CLI requests (Claude format) → non-Claude provider via OpenAI bridge.
// Focuses on context components a real CLI sends: system arrays w/ cache_control, thinking
// signatures, tool_result with images, audio. KNOWN BUG = it.fails (source file:line in comments).
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../open-sse/config/defaultThinkingSignature.js";

const T = (src, tgt, body, provider = null) =>
  translateRequest(src, tgt, "m", body, true, null, provider);

describe("Claude Code CLI context → OpenAI", () => {
  // claude-to-openai.js:24-27 — system array only maps .text; cache_control/non-text dropped
  it("system array keeps all text parts", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      system: [
        { type: "text", text: "You are Claude Code.", cache_control: { type: "ephemeral" } },
        { type: "text", text: "Follow repo conventions." },
      ],
      messages: [{ role: "user", content: "hi" }],
    });
    const sys = out.messages.find((m) => m.role === "system");
    expect(sys?.content).toContain("Claude Code");
    expect(sys?.content).toContain("repo conventions");
  });

  // claude→claude is passthrough (same format) → thinking preserved. Guards against
  // accidental routing through the OpenAI bridge for same-format requests.
  it("assistant thinking block survives Claude→Claude passthrough", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.CLAUDE, {
      messages: [
        { role: "assistant", content: [
          { type: "thinking", thinking: "step-by-step plan", signature: "abc123" },
          { type: "text", text: "done" },
        ] },
        { role: "user", content: "next" },
      ],
    });
    expect(JSON.stringify(out)).toContain("step-by-step plan");
  });

  describe.each([true, false])("redacted thinking continuity (stream=%s)", (stream) => {
    const redacted = { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "ENCRYPTED_BLOB" };
    const thinking = { type: CLAUDE_BLOCK.THINKING, thinking: "plan", signature: "Eg==" };

    describe.each(["claude", "anthropic-compatible"])("native provider=%s", (provider) => {
      describe.each([false, true])("trailing assistant=%s", (trailing) => {
        it.each([
          ["redacted-only", [redacted]],
          ["empty opaque data", [{ type: CLAUDE_BLOCK.REDACTED_THINKING, data: "" }]],
          ["mixed", [thinking, redacted, { type: CLAUDE_BLOCK.TEXT, text: "answer" }]],
          ["normal text", [{ type: CLAUDE_BLOCK.TEXT, text: "answer" }]],
        ])("preserves %s content", (_label, content) => {
          const out = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, "claude-sonnet-4-6", {
            model: "claude-sonnet-4-6",
            messages: [
              { role: ROLE.USER, content: "Start" },
              { role: ROLE.ASSISTANT, content: structuredClone(content) },
              ...(!trailing ? [{ role: ROLE.USER, content: "go" }] : []),
            ],
          }, stream, null, provider);
          const expected = content.map((block) => block.type === CLAUDE_BLOCK.THINKING && provider !== "claude"
            ? { ...block, signature: DEFAULT_THINKING_CLAUDE_SIGNATURE }
            : block);
          expect(out.messages.map((message) => message.role)).toEqual([ROLE.USER, ROLE.ASSISTANT, ROLE.USER]);
          expect(out.messages[1].content.map(({ cache_control, ...block }) => block)).toEqual(expected);
          if (trailing) {
            expect(out.messages[2]).toEqual({
              role: ROLE.USER,
              content: [{ type: CLAUDE_BLOCK.TEXT, text: expect.stringMatching(/continue.*without repeating/i) }],
            });
          }
        });
      });
    });

    it.each([FORMATS.OPENAI, FORMATS.GEMINI, FORMATS.KIRO, FORMATS.OPENAI_RESPONSES])(
      "rejects opaque history before translating to %s",
      (target) => {
        expect(() => translateRequest(FORMATS.CLAUDE, target, "m", {
          messages: [
            { role: ROLE.ASSISTANT, content: [structuredClone(redacted), { type: CLAUDE_BLOCK.TEXT, text: "answer" }] },
            { role: ROLE.USER, content: "go" },
          ],
        }, stream)).toThrow(expect.objectContaining({
          statusCode: HTTP_STATUS.BAD_REQUEST,
          message: expect.stringContaining("redacted_thinking"),
        }));
      }
    );

    it.each([
      [FORMATS.GEMINI, []],
      [FORMATS.KIRO, []],
      [FORMATS.KIRO, [{ name: "Read", input_schema: { type: "object" } }]],
    ])("rejects redacted-only history on %s with tools=%j", (target, tools) => {
      expect(() => translateRequest(FORMATS.CLAUDE, target, "m", {
        tools,
        messages: [
          { role: ROLE.ASSISTANT, content: [structuredClone(redacted)] },
          { role: ROLE.USER, content: "go" },
        ],
      }, stream)).toThrow(expect.objectContaining({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        message: expect.stringContaining("redacted_thinking"),
      }));
    });
  });

  // Nested tool-result images must not become data URIs in a later user turn.
  it("tool_result image block becomes a placeholder, not raw base64", () => {
    const payload = "IMG".repeat(1000);
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "screenshot", input: {} }] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_1", content: [
            { type: "text", text: "saved to /tmp/shot.png" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: payload } },
          ] },
        ] },
      ],
    });
    const tool = out.messages.find((m) => m.role === "tool");
    const json = JSON.stringify(out);
    expect(tool?.content, "keeps surrounding text").toContain("saved to /tmp/shot.png");
    expect(tool?.content, "placeholder names the media").toContain("image/png");
    expect(json, "base64 payload is absent from converted request").not.toContain(payload);
  });

  it("image-only tool_result remains a media placeholder", () => {
    const payload = "ONLY_IMAGE".repeat(1000);
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "screenshot", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: payload } },
        ] }] },
      ],
    });
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool?.content, "placeholder names the media").toContain("image/png");
    expect(JSON.stringify(out), "base64 payload is absent from converted request").not.toContain(payload);
  });

  // decolua/9router#4323: container_upload blocks were silently dropped as
  // empty content on Claude→Claude passthrough (hasValidContent didn't know
  // the type) and had no error path when bridged through OpenAI, which has
  // no equivalent block.
  it("preserves container_upload user messages on Claude→Claude passthrough", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.CLAUDE, {
      messages: [
        { role: "user", content: [{ type: "container_upload" }] },
      ],
    });
    expect(out.messages?.[0]?.content?.[0]?.type).toBe("container_upload");
  });

  it("rejects container_upload when translating Claude→OpenAI", () => {
    expect(() =>
      T(FORMATS.CLAUDE, FORMATS.OPENAI, {
        messages: [
          { role: "user", content: [{ type: "container_upload" }] },
        ],
      })
    ).toThrow("Unsupported Claude content block type for OpenAI: container_upload");
  });
});
