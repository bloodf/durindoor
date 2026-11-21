/**
 * OmniRoute #2104 port (durindoor #1073): keep the original turn order in an
 * existing Kiro request history.
 *
 * Upstream pins: head `2aef379e40b278d1d2788a27a8d80c1b350ed121`, merge
 * `4a6865650d127be0b1105ca01d46092c3b52cf59`.
 *
 * Kiro always needs a user turn as `conversationState.currentMessage`. When the
 * client's transcript ends with an assistant or tool turn, the request must
 * keep every original turn in `conversationState.history` — in order, exactly
 * once — and supply a neutral continuation as the current turn. Lifting an
 * older user turn into `currentMessage` instead would replay the transcript
 * backwards (the assistant turn would be sent before the user turn that
 * preceded it) and would restate that user content to the model.
 *
 * A transcript that really does end with a user turn keeps the existing
 * behavior: that turn becomes `currentMessage` and leaves `history`.
 *
 * Offline only: no provider call, no credential, no network.
 */
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const MODEL = "claude-sonnet-4.6";

const conversationOf = (result) => result.conversationState;
const contentOf = (result) => conversationOf(result).currentMessage.userInputMessage.content;

/** Ordered (role, content) view of the wire order: history, then currentMessage. */
function wireOrder(conversationState) {
  return [
    ...conversationState.history,
    conversationState.currentMessage,
  ].map((item) => {
    if (item.userInputMessage) {
      return { role: "user", content: item.userInputMessage.content };
    }
    if (item.assistantResponseMessage) {
      return { role: "assistant", content: item.assistantResponseMessage.content };
    }
    return { role: "unknown", content: "" };
  });
}

/** How many times a text appears across the whole conversation payload. */
function occurrences(conversationState, text) {
  const json = JSON.stringify(conversationState);
  return json.split(text).length - 1;
}

const READ_TOOL = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read a file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
};

describe("Kiro request history keeps the original turn order (#1073)", () => {
  describe("transcript ends with an assistant turn", () => {
    it("keeps every turn in history and continues neutrally instead of lifting the older user turn", () => {
      const result = openaiToKiroRequest(MODEL, {
        messages: [
          { role: "user", content: "First user" },
          { role: "assistant", content: "Assistant answer" },
        ],
      }, true, {});
      const cs = conversationOf(result);

      // Every original turn survives, in the client's order.
      expect(cs.history).toEqual([
        { userInputMessage: { content: "First user", modelId: MODEL } },
        { assistantResponseMessage: { content: "Assistant answer" } },
      ]);

      // The current turn is a neutral continuation, not the earlier user turn.
      expect(contentOf(result)).toMatch(/^\[Context: Current time is .*Z\]\n\nContinue$/);
      expect(contentOf(result)).not.toContain("First user");

      // The user turn is present exactly once, in history.
      expect(occurrences(cs, "First user")).toBe(1);
      expect(occurrences(cs, "Assistant answer")).toBe(1);

      // Wire order: user, assistant, continuation — never user after assistant.
      expect(wireOrder(cs).map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    });

    it("does not restate the user content of any turn kept in history", () => {
      const result = openaiToKiroRequest(MODEL, {
        messages: [
          { role: "user", content: "Explain the build" },
          { role: "assistant", content: "It runs pnpm build." },
          { role: "user", content: "And the tests?" },
          { role: "assistant", content: "pnpm -C tests run test:ci" },
        ],
      }, true, {});
      const cs = conversationOf(result);

      expect(cs.history).toHaveLength(4);
      expect(wireOrder(cs).map((turn) => turn.role)).toEqual([
        "user", "assistant", "user", "assistant", "user",
      ]);
      expect(contentOf(result)).not.toContain("Explain the build");
      expect(contentOf(result)).not.toContain("And the tests?");
      expect(occurrences(cs, "Explain the build")).toBe(1);
      expect(occurrences(cs, "And the tests?")).toBe(1);
    });
  });

  describe("transcript ends with a tool turn", () => {
    it("keeps the tool call turn in history and continues neutrally", () => {
      const result = openaiToKiroRequest(MODEL, {
        messages: [
          { role: "user", content: "Read the file" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } },
            ],
          },
        ],
        tools: [READ_TOOL],
      }, true, {});
      const cs = conversationOf(result);

      expect(cs.history).toHaveLength(2);
      expect(cs.history[0].userInputMessage.content).toBe("Read the file");
      expect(cs.history[1].assistantResponseMessage.toolUses).toEqual([
        { toolUseId: "call_1", name: "read_file", input: { path: "a.txt" } },
      ]);

      // The continuation does not restate the user turn that stays in history.
      expect(contentOf(result)).toMatch(/^\[Context: Current time is .*Z\]\n\nContinue$/);
      expect(contentOf(result)).not.toContain("Read the file");
      expect(occurrences(cs, "Read the file")).toBe(1);

      // The declared schema still reaches the current turn, so Kiro's
      // "tools required" rule stays satisfied for a tool-bearing history.
      const tools = cs.currentMessage.userInputMessage.userInputMessageContext?.tools;
      expect(tools?.[0]?.toolSpecification?.name).toBe("read_file");
    });

    it("keeps a completed tool exchange in order and continues neutrally", () => {
      const result = openaiToKiroRequest(MODEL, {
        messages: [
          { role: "user", content: "Read the file" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "file contents" },
          { role: "assistant", content: "The file lists two routes." },
        ],
        tools: [READ_TOOL],
      }, true, {});
      const cs = conversationOf(result);

      expect(wireOrder(cs).map((turn) => turn.role)).toEqual([
        "user", "assistant", "user", "assistant", "user",
      ]);
      expect(cs.history[2].userInputMessage.userInputMessageContext.toolResults).toEqual([
        { toolUseId: "call_1", status: "success", content: [{ text: "file contents" }] },
      ]);
      expect(contentOf(result)).toMatch(/^\[Context: Current time is .*Z\]\n\nContinue$/);
      expect(contentOf(result)).not.toContain("Read the file");
      expect(occurrences(cs, "Read the file")).toBe(1);
      expect(occurrences(cs, "file contents")).toBe(1);
    });
  });

  describe("transcript ends with a real user turn", () => {
    it("keeps the existing currentMessage behavior", () => {
      const result = openaiToKiroRequest(MODEL, {
        messages: [
          { role: "user", content: "First user" },
          { role: "assistant", content: "Assistant answer" },
          { role: "user", content: "Follow up" },
        ],
      }, true, {});
      const cs = conversationOf(result);

      expect(cs.history).toEqual([
        { userInputMessage: { content: "First user", modelId: MODEL } },
        { assistantResponseMessage: { content: "Assistant answer" } },
      ]);
      expect(contentOf(result)).toContain("Follow up");
      expect(contentOf(result)).not.toContain("First user");
      expect(occurrences(cs, "First user")).toBe(1);
      expect(occurrences(cs, "Follow up")).toBe(1);
    });

    it("keeps the tool-result turn as the current turn", () => {
      const result = openaiToKiroRequest(MODEL, {
        messages: [
          { role: "user", content: "What is 2+2? Use the calc tool." },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "calc", arguments: '{"expr":"2+2"}' } },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "4" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "calc",
              description: "Eval",
              parameters: { type: "object", properties: { expr: { type: "string" } }, required: ["expr"] },
            },
          },
        ],
      }, true, {});
      const cs = conversationOf(result);
      const current = cs.currentMessage.userInputMessage;

      // The tool result stays on the current turn, with its empty user body.
      expect(current.userInputMessageContext.toolResults).toEqual([
        { toolUseId: "call_1", status: "success", content: [{ text: "4" }] },
      ]);
      expect(current.content.split("\n\n").pop()).toBe("");

      // The rest of the transcript stays in history, in order.
      expect(wireOrder(cs).map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
      expect(cs.history[0].userInputMessage.content).toBe("What is 2+2? Use the calc tool.");
      expect(cs.history[1].assistantResponseMessage.toolUses).toHaveLength(1);
    });
  });

  describe("preserved boundaries", () => {
    it("keeps the client session affinity on an assistant-tail request", () => {
      const body = {
        messages: [
          { role: "user", content: "First user" },
          { role: "assistant", content: "Assistant answer" },
        ],
      };

      const direct = openaiToKiroRequest(MODEL, body, true, {}, { clientSessionId: "session-2104" });
      expect(conversationOf(direct).conversationId).toBe("session-2104");

      const piped = translateRequest(
        FORMATS.OPENAI,
        FORMATS.KIRO,
        MODEL,
        body,
        true,
        null,
        "kiro",
      );
      expect(conversationOf(piped).conversationId).toBeTruthy();
      expect(wireOrder(conversationOf(piped)).map((turn) => turn.role)).toEqual([
        "user", "assistant", "user",
      ]);
    });

    it("keeps the existing output-ceiling rejection", () => {
      expect(() => openaiToKiroRequest(MODEL, {
        messages: [
          { role: "user", content: "First user" },
          { role: "assistant", content: "Assistant answer" },
        ],
        max_tokens: 1024,
      }, true, {})).toThrow(expect.objectContaining({ statusCode: 400 }));
    });
  });
});
