/**
 * #1331 / #1089: Chat → Responses stream terminals.
 * length → response.incomplete; error → response.failed;
 * stop / tool_calls → response.completed. Exactly one terminal per stream.
 *
 * Mirrors the skipped #1322 matrix rows (not flipped here until that PR merges).
 */
import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, OPENAI_FINISH } from "../../open-sse/translator/schema/index.js";

const CHAT = FORMATS.OPENAI;
const RESPONSES = FORMATS.OPENAI_RESPONSES;

const TERMINALS = new Set([
  "response.completed",
  "response.incomplete",
  "response.failed",
]);

const streamTo = (chunks) => {
  const state = initState(RESPONSES);
  return chunks.flatMap((chunk) => translateResponse(CHAT, RESPONSES, chunk, state) || []);
};

const terminalEvents = (events) =>
  events.filter((event) => TERMINALS.has(event.event) || TERMINALS.has(event.data?.type));

const textChunk = (content, finish_reason, extra = {}) => ({
  id: "chat-1331",
  model: "m",
  choices: [{ index: 0, delta: { content }, finish_reason }],
  ...extra,
});

describe("#1331 Chat→Responses stream termination", () => {
  it("emits Responses stream incomplete for Chat length finish", () => {
    const events = streamTo([
      textChunk("partial", OPENAI_FINISH.LENGTH),
      null,
    ]);
    const terminals = terminalEvents(events);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].event).toBe("response.incomplete");
    expect(terminals[0].data).toMatchObject({
      type: "response.incomplete",
      response: {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      },
    });
    expect(events.some((event) => event.event === "response.completed")).toBe(false);
    expect(events.some((event) => event.event === "response.failed")).toBe(false);
  });

  it("emits Responses stream failed for Chat error finish", () => {
    const events = streamTo([
      textChunk("boom", OPENAI_FINISH.ERROR),
      null,
    ]);
    const terminals = terminalEvents(events);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].event).toBe("response.failed");
    expect(terminals[0].data).toMatchObject({
      type: "response.failed",
      response: {
        status: "failed",
        error: { type: "server_error", message: expect.any(String) },
      },
    });
    expect(events.some((event) => event.event === "response.completed")).toBe(false);
    expect(events.some((event) => event.event === "response.incomplete")).toBe(false);
  });

  it("emits Responses stream completed for Chat stop finish", () => {
    const events = streamTo([
      textChunk("ok", OPENAI_FINISH.STOP, {
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      null,
    ]);
    const terminals = terminalEvents(events);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].event).toBe("response.completed");
    expect(terminals[0].data).toMatchObject({
      type: "response.completed",
      response: {
        status: "completed",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    });
    expect(events.some((event) => event.event === "response.incomplete")).toBe(false);
    expect(events.some((event) => event.event === "response.failed")).toBe(false);
  });

  it("emits Responses stream completed for Chat tool_calls finish", () => {
    const events = streamTo([
      {
        id: "chat-1331",
        model: "m",
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: "c",
              type: OPENAI_BLOCK.FUNCTION,
              function: { name: "search", arguments: "{}" },
            }],
          },
          finish_reason: OPENAI_FINISH.TOOL_CALLS,
        }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      },
      null,
    ]);
    const terminals = terminalEvents(events);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].event).toBe("response.completed");
    expect(terminals[0].data.response.status).toBe("completed");
    expect(terminals[0].data.response.usage).toMatchObject({
      input_tokens: 2,
      output_tokens: 3,
      total_tokens: 5,
    });
    expect(events.some((event) => event.event === "response.incomplete")).toBe(false);
    expect(events.some((event) => event.event === "response.failed")).toBe(false);
  });

  it("keeps usage on incomplete when finish and usage share a chunk", () => {
    const events = streamTo([
      textChunk("partial", OPENAI_FINISH.LENGTH, {
        usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
      }),
      null,
    ]);
    const [terminal] = terminalEvents(events);
    expect(terminal.event).toBe("response.incomplete");
    expect(terminal.data.response.usage).toMatchObject({
      input_tokens: 4,
      output_tokens: 5,
      total_tokens: 9,
    });
  });
});
