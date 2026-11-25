/**
 * #1073 — Kiro must keep the caller's declared tool schema on `currentMessage`.
 *
 * Kiro's CodeWhisperer validator rejects a request whose history references a
 * tool use while `currentMessage.userInputMessage.userInputMessageContext.tools`
 * is missing ("Improperly formed request", HTTP 400).
 *
 * The translator attaches the schema to the first *emitted user turn*, which is
 * not always the turn that ends up as `currentMessage`:
 *   - a transcript that opens with an assistant turn puts the schema on a later
 *     user turn, so reading `history[0]` alone dropped it;
 *   - a transcript with no user turn at all attaches it to no turn, so the
 *     schema was lost entirely.
 *
 * Only caller-declared specifications are ever carried. Nothing is synthesized
 * for a tool the client did not declare, and the local flatten-to-text path for
 * clients that declare no tools stays as it is.
 */
import { describe, it, expect } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";

const OPENAI_TOOLS = [
  {
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
  },
];

const CLAUDE_TOOLS = [
  {
    name: "read_file",
    description: "Read a file",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
];

const toolsOf = (payload) =>
  payload.conversationState.currentMessage.userInputMessage.userInputMessageContext?.tools;

const historyOf = (payload) => payload.conversationState.history;

describe("Kiro declared tool schema on currentMessage", () => {
  describe("OpenAI → Kiro", () => {
    it("keeps the declared schema when the transcript opens with an assistant turn", () => {
      // The first emitted user turn is not history[0]: the schema lands on the
      // middle user turn and currentMessage is the last one.
      const payload = openaiToKiroRequest(
        "claude-sonnet-4.6",
        {
          messages: [
            {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } },
              ],
            },
            { role: "user", content: "here is the file" },
            { role: "assistant", content: "read it" },
            { role: "user", content: "summarize it" },
          ],
          tools: OPENAI_TOOLS,
        },
        true,
        {},
      );

      const history = historyOf(payload);
      // The leading assistant turn is the first history element, not a user turn.
      expect(history[0].assistantResponseMessage).toBeDefined();
      expect(history[0].userInputMessage).toBeUndefined();
      // The history still references the tool use.
      expect(history[0].assistantResponseMessage.toolUses[0].name).toBe("read_file");

      // The declared schema reached currentMessage.
      const tools = toolsOf(payload);
      expect(tools).toHaveLength(1);
      expect(tools[0].toolSpecification.name).toBe("read_file");
      expect(tools[0].toolSpecification.description).toBe("Read a file");
      expect(tools[0].toolSpecification.inputSchema.json).toEqual({
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      });

      // The schema is carried, not duplicated onto the history turn.
      const serialized = JSON.stringify(payload);
      expect(serialized.match(/"toolSpecification"/g)).toHaveLength(1);
    });

    it("keeps the declared schema for a tool call with no prior user turn", () => {
      // The transcript has no user turn at all, so no turn ever received the
      // schema. It must come from the caller's own `tools` array.
      const payload = openaiToKiroRequest(
        "claude-sonnet-4.6",
        {
          messages: [
            {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } },
              ],
            },
          ],
          tools: OPENAI_TOOLS,
        },
        true,
        {},
      );

      const history = historyOf(payload);
      expect(history[0].assistantResponseMessage.toolUses[0].name).toBe("read_file");

      const tools = toolsOf(payload);
      expect(tools).toHaveLength(1);
      expect(tools[0].toolSpecification.name).toBe("read_file");
      expect(tools[0].toolSpecification.inputSchema.json).toEqual({
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      });
    });

    it("does not invent tool specifications when the client declared none", () => {
      // No declared tools: the tool interaction is flattened to text, so no
      // schema may appear and no structured tool reference may survive.
      const payload = openaiToKiroRequest(
        "claude-sonnet-4.6",
        {
          messages: [
            { role: "user", content: "read the file" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } },
              ],
            },
          ],
        },
        true,
        {},
      );

      expect(toolsOf(payload)).toBeUndefined();
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain("toolSpecification");
      expect(serialized).not.toContain("toolUses");
      expect(serialized).toContain("[Tool call: read_file(");
    });
  });

  describe("Claude → Kiro", () => {
    it("keeps the declared schema when the transcript opens with an assistant turn", () => {
      const payload = claudeToKiroRequest(
        "claude-sonnet-4.6",
        {
          messages: [
            { role: "assistant", content: [{ type: "text", text: "earlier answer" }] },
            { role: "user", content: [{ type: "text", text: "first question" }] },
            { role: "assistant", content: [{ type: "text", text: "first answer" }] },
            { role: "user", content: [{ type: "text", text: "second question" }] },
          ],
          tools: CLAUDE_TOOLS,
        },
        true,
        {},
      );

      const history = historyOf(payload);
      expect(history[0].assistantResponseMessage).toBeDefined();
      expect(history[0].userInputMessage).toBeUndefined();

      const tools = toolsOf(payload);
      expect(tools).toHaveLength(1);
      expect(tools[0].toolSpecification.name).toBe("read_file");
      expect(tools[0].toolSpecification.inputSchema.json).toEqual({
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      });
      expect(JSON.stringify(payload).match(/"toolSpecification"/g)).toHaveLength(1);
    });

    it("keeps the declared schema for a tool call with no prior user turn", () => {
      const payload = claudeToKiroRequest(
        "claude-sonnet-4.6",
        {
          messages: [
            {
              role: "assistant",
              content: [{ type: "tool_use", id: "tu_1", name: "read_file", input: { path: "a.txt" } }],
            },
          ],
          tools: CLAUDE_TOOLS,
        },
        true,
        {},
      );

      const history = historyOf(payload);
      expect(history[0].assistantResponseMessage.toolUses[0].name).toBe("read_file");

      const tools = toolsOf(payload);
      expect(tools).toHaveLength(1);
      expect(tools[0].toolSpecification.name).toBe("read_file");
    });

    it("does not invent tool specifications when the client declared none", () => {
      const payload = claudeToKiroRequest(
        "claude-sonnet-4.6",
        {
          messages: [
            { role: "user", content: [{ type: "text", text: "read the file" }] },
            {
              role: "assistant",
              content: [{ type: "tool_use", id: "tu_1", name: "read_file", input: { path: "a.txt" } }],
            },
          ],
        },
        true,
        {},
      );

      expect(toolsOf(payload)).toBeUndefined();
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain("toolSpecification");
      expect(serialized).not.toContain("toolUses");
      expect(serialized).toContain("[Tool call: read_file(");
    });
  });
});
