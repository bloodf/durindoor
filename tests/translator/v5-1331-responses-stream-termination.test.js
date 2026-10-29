/**
 * #1331 / #1089: Chat → Responses terminals (stream + non-stream JSON).
 * length / content_filter → incomplete; error → failed;
 * stop / tool_calls → completed. Stream: exactly one terminal event.
 *
 * Mirrors the skipped #1322 matrix stream rows (not flipped here until that PR merges).
 */
import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, OPENAI_FINISH, ROLE } from "../../open-sse/translator/schema/index.js";

const CHAT = FORMATS.OPENAI;
const RESPONSES = FORMATS.OPENAI_RESPONSES;

/** Credential-like upstream text — must be redacted via sanitizeErrorMessage. (#1331) */
const CREDENTIAL_SENTINEL = "sk-test-SENTINEL-1331";

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

const completion = (finish_reason, message = { role: ROLE.ASSISTANT, content: "partial" }, extra = {}) => ({
  id: "chat-1331",
  model: "m",
  object: "chat.completion",
  choices: [{ index: 0, message, finish_reason }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  ...extra,
});

const project = (finish_reason, message, extra) =>
  translateNonStreamingResponse(completion(finish_reason, message, extra), CHAT, RESPONSES);

const assertFailedErrorShape = (error, serialized) => {
  expect(typeof error?.code).toBe("string");
  expect(error.code.length).toBeGreaterThan(0);
  expect(typeof error?.message).toBe("string");
  expect(error.message.length).toBeGreaterThan(0);
  expect(serialized).not.toContain(CREDENTIAL_SENTINEL);
};

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

  it("emits Responses stream incomplete for Chat content_filter finish", () => {
    const events = streamTo([
      textChunk("blocked", OPENAI_FINISH.CONTENT_FILTER),
      null,
    ]);
    const terminals = terminalEvents(events);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].event).toBe("response.incomplete");
    expect(terminals[0].data).toMatchObject({
      type: "response.incomplete",
      response: {
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
      },
    });
    expect(events.some((event) => event.event === "response.completed")).toBe(false);
    expect(events.some((event) => event.event === "response.failed")).toBe(false);
  });

  it("emits Responses stream failed for Chat error finish", () => {
    const events = streamTo([
      textChunk("boom", OPENAI_FINISH.ERROR, {
        error: { message: `upstream aborted with ${CREDENTIAL_SENTINEL}` },
      }),
      null,
    ]);
    const terminals = terminalEvents(events);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].event).toBe("response.failed");
    expect(terminals[0].data).toMatchObject({
      type: "response.failed",
      response: { status: "failed" },
    });
    assertFailedErrorShape(
      terminals[0].data.response.error,
      JSON.stringify(terminals[0].data.response),
    );
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

describe("#1331 Chat→Responses non-stream JSON termination", () => {
  it("maps non-stream length to incomplete with max_output_tokens", () => {
    const out = project(OPENAI_FINISH.LENGTH);
    expect(out.status).toBe("incomplete");
    expect(out.incomplete_details).toEqual({ reason: "max_output_tokens" });
    expect(out).not.toHaveProperty("error");
    expect(out.status).not.toBe(OPENAI_FINISH.LENGTH);
    expect(out.output[0].content[0].text).toBe("partial");
  });

  it("maps non-stream content_filter to incomplete with content_filter reason", () => {
    const out = project(OPENAI_FINISH.CONTENT_FILTER);
    expect(out.status).toBe("incomplete");
    expect(out.incomplete_details).toEqual({ reason: "content_filter" });
    expect(out).not.toHaveProperty("error");
    expect(out.status).not.toBe(OPENAI_FINISH.CONTENT_FILTER);
  });

  it("maps non-stream error to failed with a secret-free error object", () => {
    const out = project(
      OPENAI_FINISH.ERROR,
      { role: ROLE.ASSISTANT, content: "partial" },
      { error: { message: `upstream aborted with ${CREDENTIAL_SENTINEL}` } },
    );
    expect(out.status).toBe("failed");
    expect(out).not.toHaveProperty("incomplete_details");
    expect(out.status).not.toBe(OPENAI_FINISH.ERROR);
    assertFailedErrorShape(out.error, JSON.stringify(out));
  });

  it("maps non-stream stop and tool_calls to completed", () => {
    const stop = project(OPENAI_FINISH.STOP, { role: ROLE.ASSISTANT, content: "ok" });
    expect(stop.status).toBe("completed");
    expect(stop.status).not.toBe("incomplete");
    expect(stop.status).not.toBe("failed");
    expect(stop).not.toHaveProperty("incomplete_details");
    expect(stop).not.toHaveProperty("error");

    const tools = project(OPENAI_FINISH.TOOL_CALLS, {
      role: ROLE.ASSISTANT,
      content: null,
      tool_calls: [{
        id: "c",
        type: OPENAI_BLOCK.FUNCTION,
        function: { name: "search", arguments: "{}" },
      }],
    });
    expect(tools.status).toBe("completed");
    expect(tools).not.toHaveProperty("incomplete_details");
    expect(tools).not.toHaveProperty("error");
  });
});

describe("#1331 Chat→Responses robustness (main-compatible edges)", () => {
  const mainCompletedKeys = ["id", "object", "created_at", "model", "status", "output", "usage"];

  it("does not throw and adds no new fields for null/undefined finish_reason", () => {
    for (const finish_reason of [null, undefined]) {
      let out;
      expect(() => {
        out = project(finish_reason, { role: ROLE.ASSISTANT, content: "ok" });
      }).not.toThrow();
      expect(out.status).toBe("completed");
      expect(Object.keys(out).sort()).toEqual([...mainCompletedKeys].sort());
      expect(out).not.toHaveProperty("error");
      expect(out).not.toHaveProperty("incomplete_details");
    }

    let events;
    expect(() => {
      events = streamTo([textChunk("ok", null), textChunk("!", undefined), null]);
    }).not.toThrow();
    expect(events.some((event) => event.event === "response.failed")).toBe(false);
    expect(events.some((event) => event.event === "response.incomplete")).toBe(false);
  });

  it("tolerates null, string, and incomplete upstream error objects without throwing", () => {
    const cases = [
      null,
      "plain-string-error",
      {},
      { code: "x" },
      { message: null },
      { message: 12 },
    ];
    for (const error of cases) {
      let out;
      expect(() => {
        out = project(
          OPENAI_FINISH.ERROR,
          { role: ROLE.ASSISTANT, content: "partial" },
          { error },
        );
      }).not.toThrow();
      expect(out.status).toBe("failed");
      assertFailedErrorShape(out.error, JSON.stringify(out));

      let events;
      expect(() => {
        events = streamTo([textChunk("boom", OPENAI_FINISH.ERROR, { error }), null]);
      }).not.toThrow();
      const failed = terminalEvents(events).find((event) => event.event === "response.failed");
      expect(failed).toBeTruthy();
      assertFailedErrorShape(failed.data.response.error, JSON.stringify(failed.data.response));
    }
  });

  it("returns no events and does not throw when there are no choices", () => {
    let events;
    expect(() => {
      const state = initState(RESPONSES);
      events = [
        ...(translateResponse(CHAT, RESPONSES, { id: "x", model: "m", choices: [] }, state) || []),
        ...(translateResponse(CHAT, RESPONSES, { id: "x", model: "m" }, state) || []),
        ...(translateResponse(CHAT, RESPONSES, { id: "x", model: "m", choices: null }, state) || []),
      ];
    }).not.toThrow();
    expect(events).toEqual([]);
  });
});
