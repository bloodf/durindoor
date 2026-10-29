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
import { responsesIncompleteDetailsOrOmit } from "../../open-sse/translator/concerns/finishReason.js";
import { responsesApiToOpenAICompletion } from "../../open-sse/translator/response/completionProjector.js";
import { OPENAI_BLOCK, OPENAI_FINISH, ROLE } from "../../open-sse/translator/schema/index.js";

const CHAT = FORMATS.OPENAI;
const RESPONSES = FORMATS.OPENAI_RESPONSES;

/** Credential-like upstream text — must be redacted via sanitizeErrorMessage. (#1331) */
const CREDENTIAL_SENTINEL = "sk-test-SENTINEL-1331";
const CREDENTIAL_UPSTREAM = `upstream aborted with ${CREDENTIAL_SENTINEL}`;
const CREDENTIAL_REDACTED = "upstream aborted with [redacted]";
/** Matches `RESPONSES_FAILED_FALLBACK_MESSAGE` in finishReason.js */
const FAILED_FALLBACK_MESSAGE = "Upstream aborted the response (finish_reason error)";
const FAILED_ERROR = {
  type: "server_error",
  code: "server_error",
  message: FAILED_FALLBACK_MESSAGE,
};

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

const terminalSequence = (events) => terminalEvents(events).map((event) => event.event);

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

/** Main completed Responses field set (no synthetic `error` / `incomplete_details`). */
const MAIN_COMPLETED_KEYS = ["id", "object", "created_at", "model", "status", "output", "usage"];

/** Exact failed.error shape; optional message override for sanitized upstream text. */
const assertFailedErrorExact = (error, serialized, message = FAILED_FALLBACK_MESSAGE) => {
  expect(error).toEqual({
    type: "server_error",
    code: "server_error",
    message,
  });
  expect(serialized).not.toContain(CREDENTIAL_SENTINEL);
};

describe("#1331 Chat→Responses stream termination", () => {
  it("emits Responses stream incomplete for Chat length finish", () => {
    const events = streamTo([
      textChunk("partial", OPENAI_FINISH.LENGTH),
      null,
    ]);
    expect(terminalSequence(events)).toEqual(["response.incomplete"]);
    const response = terminalEvents(events)[0].data.response;
    expect(terminalEvents(events)[0].data.type).toBe("response.incomplete");
    expect(response.status).toBe("incomplete");
    expect(response.error).toBeNull();
    expect(response.incomplete_details).toEqual({ reason: "max_output_tokens" });
  });

  it("emits Responses stream incomplete for Chat content_filter finish", () => {
    const events = streamTo([
      textChunk("blocked", OPENAI_FINISH.CONTENT_FILTER),
      null,
    ]);
    expect(terminalSequence(events)).toEqual(["response.incomplete"]);
    const response = terminalEvents(events)[0].data.response;
    expect(terminalEvents(events)[0].data.type).toBe("response.incomplete");
    expect(response.status).toBe("incomplete");
    expect(response.error).toBeNull();
    expect(response.incomplete_details).toEqual({ reason: "content_filter" });
  });

  it("emits Responses stream failed for Chat error finish", () => {
    const events = streamTo([
      textChunk("boom", OPENAI_FINISH.ERROR, {
        error: { message: CREDENTIAL_UPSTREAM },
      }),
      null,
    ]);
    expect(terminalSequence(events)).toEqual(["response.failed"]);
    const [terminal] = terminalEvents(events);
    expect(terminal.data.type).toBe("response.failed");
    expect(terminal.data.response.status).toBe("failed");
    expect(terminal.data.response).not.toHaveProperty("incomplete_details");
    assertFailedErrorExact(
      terminal.data.response.error,
      JSON.stringify(terminal.data.response),
      CREDENTIAL_REDACTED,
    );
  });

  it("emits Responses stream completed for Chat stop finish", () => {
    const events = streamTo([
      textChunk("ok", OPENAI_FINISH.STOP, {
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      null,
    ]);
    expect(terminalSequence(events)).toEqual(["response.completed"]);
    const response = terminalEvents(events)[0].data.response;
    expect(terminalEvents(events)[0].data.type).toBe("response.completed");
    expect(response.status).toBe("completed");
    expect(response.error).toBeNull();
    expect(response).not.toHaveProperty("incomplete_details");
    expect(response.usage).toEqual(expect.objectContaining({
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
    }));
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
    expect(terminalSequence(events)).toEqual(["response.completed"]);
    const response = terminalEvents(events)[0].data.response;
    expect(response.status).toBe("completed");
    expect(response.error).toBeNull();
    expect(response).not.toHaveProperty("incomplete_details");
    expect(response.usage).toEqual(expect.objectContaining({
      input_tokens: 2,
      output_tokens: 3,
      total_tokens: 5,
    }));
  });

  it("keeps usage on incomplete when finish and usage share a chunk", () => {
    const events = streamTo([
      textChunk("partial", OPENAI_FINISH.LENGTH, {
        usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
      }),
      null,
    ]);
    expect(terminalSequence(events)).toEqual(["response.incomplete"]);
    const response = terminalEvents(events)[0].data.response;
    expect(response.status).toBe("incomplete");
    expect(response.error).toBeNull();
    expect(response.incomplete_details).toEqual({ reason: "max_output_tokens" });
    expect(response.usage).toEqual(expect.objectContaining({
      input_tokens: 4,
      output_tokens: 5,
      total_tokens: 9,
    }));
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
      { error: { message: CREDENTIAL_UPSTREAM } },
    );
    expect(out.status).toBe("failed");
    expect(out).not.toHaveProperty("incomplete_details");
    expect(out.status).not.toBe(OPENAI_FINISH.ERROR);
    assertFailedErrorExact(out.error, JSON.stringify(out), CREDENTIAL_REDACTED);
  });

  it("maps non-stream stop and tool_calls to completed", () => {
    const stop = project(OPENAI_FINISH.STOP, { role: ROLE.ASSISTANT, content: "ok" });
    expect(stop.status).toBe("completed");
    expect(Object.keys(stop).sort()).toEqual([...MAIN_COMPLETED_KEYS].sort());
    expect(stop).not.toHaveProperty("incomplete_details");
    expect(stop).not.toHaveProperty("error");
    expect(stop.output[0].content[0].text).toBe("ok");

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
    expect(tools.output.map((item) => item.type)).toEqual(["function_call"]);
    expect(tools.output[0]).toEqual(expect.objectContaining({
      type: "function_call",
      call_id: "c",
      name: "search",
      arguments: "{}",
    }));
  });
});

describe("#1331 Chat→Responses robustness (main-compatible edges)", () => {
  it("does not throw and adds no new fields for null/undefined finish_reason", () => {
    for (const finish_reason of [null, undefined]) {
      let out;
      expect(() => {
        out = project(finish_reason, { role: ROLE.ASSISTANT, content: "ok" });
      }).not.toThrow();
      expect(out.status).toBe("completed");
      expect(Object.keys(out).sort()).toEqual([...MAIN_COMPLETED_KEYS].sort());
      expect(out).not.toHaveProperty("error");
      expect(out).not.toHaveProperty("incomplete_details");
      expect(out.output[0].content[0].text).toBe("ok");
    }

    let events;
    expect(() => {
      events = streamTo([textChunk("ok", null), textChunk("!", undefined), null]);
    }).not.toThrow();
    expect(terminalSequence(events)).toEqual(["response.completed"]);
    expect(terminalEvents(events)[0].data.response.status).toBe("completed");
    expect(terminalEvents(events)[0].data.response.error).toBeNull();
    expect(terminalEvents(events)[0].data.response).not.toHaveProperty("incomplete_details");
  });

  it("tolerates null, string, and incomplete upstream error objects without throwing", () => {
    const cases = [
      { error: null, message: FAILED_FALLBACK_MESSAGE },
      { error: "plain-string-error", message: "plain-string-error" },
      { error: {}, message: FAILED_FALLBACK_MESSAGE },
      { error: { code: "x" }, message: FAILED_FALLBACK_MESSAGE },
      { error: { message: null }, message: FAILED_FALLBACK_MESSAGE },
      { error: { message: 12 }, message: FAILED_FALLBACK_MESSAGE },
    ];
    for (const { error, message } of cases) {
      let out;
      expect(() => {
        out = project(
          OPENAI_FINISH.ERROR,
          { role: ROLE.ASSISTANT, content: "partial" },
          { error },
        );
      }).not.toThrow();
      expect(out.status).toBe("failed");
      assertFailedErrorExact(out.error, JSON.stringify(out), message);

      let events;
      expect(() => {
        events = streamTo([textChunk("boom", OPENAI_FINISH.ERROR, { error }), null]);
      }).not.toThrow();
      expect(terminalSequence(events)).toEqual(["response.failed"]);
      const failed = terminalEvents(events)[0];
      expect(failed.data.response.status).toBe("failed");
      assertFailedErrorExact(failed.data.response.error, JSON.stringify(failed.data.response), message);
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
    expect(terminalSequence(events)).toEqual([]);
  });

  it("tolerates primitive status (5) without inventing fields", () => {
    // Responses→Chat: main passed the numeric status through as finish_reason.
    let chat;
    expect(() => {
      chat = responsesApiToOpenAICompletion({
        id: "r-1331",
        model: "m",
        status: 5,
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hi" }],
        }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }, "m");
    }).not.toThrow();
    expect(chat.choices[0].finish_reason).toBe(5);
    expect(chat.choices[0].message.content).toBe("hi");
    expect(chat).not.toHaveProperty("incomplete_details");

    // Chat→Responses non-stream: main used `status: finishReason` for unknown truthy values.
    let resp;
    expect(() => {
      resp = project(5, { role: ROLE.ASSISTANT, content: "ok" });
    }).not.toThrow();
    expect(resp.status).toBe(5);
    expect(Object.keys(resp).sort()).toEqual([...MAIN_COMPLETED_KEYS].sort());
    expect(resp).not.toHaveProperty("error");
    expect(resp).not.toHaveProperty("incomplete_details");
    expect(resp.output[0].content[0].text).toBe("ok");

    // Stream always uses canonical completed status (main's sendCompleted).
    let events;
    expect(() => {
      events = streamTo([textChunk("ok", 5), null]);
    }).not.toThrow();
    expect(terminalSequence(events)).toEqual(["response.completed"]);
    expect(terminalEvents(events)[0].data.response.status).toBe("completed");
    expect(terminalEvents(events)[0].data.response.error).toBeNull();
    expect(terminalEvents(events)[0].data.response).not.toHaveProperty("incomplete_details");
  });

  it("surfaces primitive error (5) without throwing or forwarding it as an object", () => {
    // Responses→Chat stream: main used `error.message || JSON.stringify(error)` → "[Error] 5".
    const state = initState(CHAT);
    let chunks;
    expect(() => {
      chunks = translateResponse(
        RESPONSES,
        CHAT,
        {
          event: "response.failed",
          data: { type: "response.failed", response: { status: "failed", error: 5 } },
        },
        state,
      );
    }).not.toThrow();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta.content).toBe("[Error] 5");
    expect(chunks[0].choices[0].finish_reason).toBe(OPENAI_FINISH.STOP);

    // Chat→Responses failed path: primitive upstream error is not forwarded as-is.
    let failed;
    expect(() => {
      failed = project(
        OPENAI_FINISH.ERROR,
        { role: ROLE.ASSISTANT, content: "partial" },
        { error: 5 },
      );
    }).not.toThrow();
    expect(failed.status).toBe("failed");
    expect(failed.error).toEqual(FAILED_ERROR);
    assertFailedErrorExact(failed.error, JSON.stringify(failed));
  });

  it("drops primitive incomplete_details (true) instead of forwarding it", () => {
    expect(responsesIncompleteDetailsOrOmit(true)).toBeNull();
    expect(responsesIncompleteDetailsOrOmit(5)).toBeNull();
    expect(responsesIncompleteDetailsOrOmit("max_output_tokens")).toBeNull();

    // Responses→Chat ignores the field entirely — no throw, nothing new emitted.
    let chat;
    expect(() => {
      chat = responsesApiToOpenAICompletion({
        id: "r-1331",
        model: "m",
        status: "completed",
        incomplete_details: true,
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "ok" }],
        }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }, "m");
    }).not.toThrow();
    expect(chat.choices[0].finish_reason).toBe("stop");
    expect(chat.choices[0].message.content).toBe("ok");
    expect(chat).not.toHaveProperty("incomplete_details");

    // Chat→Responses completed path never grows an incomplete_details key.
    const completed = project(OPENAI_FINISH.STOP, { role: ROLE.ASSISTANT, content: "ok" });
    expect(completed.status).toBe("completed");
    expect(Object.keys(completed).sort()).toEqual([...MAIN_COMPLETED_KEYS].sort());
    expect(completed).not.toHaveProperty("incomplete_details");
  });

  it("skips null entries in Responses output arrays without throwing", () => {
    let empty;
    expect(() => {
      empty = responsesApiToOpenAICompletion({
        id: "r-1331",
        model: "m",
        status: "completed",
        output: [null],
        usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
      }, "m");
    }).not.toThrow();
    expect(empty.choices[0].message.content).toBe("");
    expect(empty.choices[0].finish_reason).toBe("stop");

    let mixed;
    expect(() => {
      mixed = responsesApiToOpenAICompletion({
        id: "r-1331",
        model: "m",
        status: "completed",
        output: [
          null,
          {
            type: "message",
            role: "assistant",
            content: [null, { type: "output_text", text: "hi" }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }, "m");
    }).not.toThrow();
    expect(mixed.choices[0].message.content).toBe("hi");
    expect(mixed.choices[0].finish_reason).toBe("stop");
    expect(mixed).not.toHaveProperty("incomplete_details");
  });

  it("treats empty and unknown status like main (only known statuses change behavior)", () => {
    // Responses→Chat: empty status falls through to "stop"; unknown passthrough.
    expect(
      responsesApiToOpenAICompletion({
        id: "r-1331",
        model: "m",
        status: "",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hi" }],
        }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }, "m").choices[0].finish_reason,
    ).toBe("stop");
    expect(
      responsesApiToOpenAICompletion({
        id: "r-1331",
        model: "m",
        status: "foo",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hi" }],
        }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }, "m").choices[0].finish_reason,
    ).toBe("foo");

    // Chat→Responses non-stream: falsy → completed; unknown truthy → passthrough status.
    const empty = project("", { role: ROLE.ASSISTANT, content: "ok" });
    expect(empty.status).toBe("completed");
    expect(Object.keys(empty).sort()).toEqual([...MAIN_COMPLETED_KEYS].sort());
    expect(empty).not.toHaveProperty("error");
    expect(empty).not.toHaveProperty("incomplete_details");

    const unknown = project("foo", { role: ROLE.ASSISTANT, content: "ok" });
    expect(unknown.status).toBe("foo");
    expect(Object.keys(unknown).sort()).toEqual([...MAIN_COMPLETED_KEYS].sort());
    expect(unknown).not.toHaveProperty("error");
    expect(unknown).not.toHaveProperty("incomplete_details");

    // Stream: empty/unknown never invent incomplete/failed — canonical completed only.
    for (const finish_reason of ["", "foo"]) {
      const events = streamTo([textChunk("ok", finish_reason), null]);
      expect(terminalSequence(events)).toEqual(["response.completed"]);
      expect(terminalEvents(events)[0].data.response.status).toBe("completed");
      expect(terminalEvents(events)[0].data.response.error).toBeNull();
      expect(terminalEvents(events)[0].data.response).not.toHaveProperty("incomplete_details");
    }
  });

  it("uses fallback failed.error for empty upstream error message/code shapes", () => {
    const cases = [
      { error: {}, content: "[Error] {}" },
      { error: { message: "" }, content: '[Error] {"message":""}' },
      { error: { code: "" }, content: '[Error] {"code":""}' },
    ];
    for (const { error, content } of cases) {
      // Responses→Chat stream matches main: message || JSON.stringify(error).
      const state = initState(CHAT);
      const chunks = translateResponse(
        RESPONSES,
        CHAT,
        {
          event: "response.failed",
          data: { type: "response.failed", response: { status: "failed", error } },
        },
        state,
      );
      expect(chunks).toHaveLength(1);
      expect(chunks[0].choices[0].delta.content).toBe(content);
      expect(chunks[0].choices[0].finish_reason).toBe(OPENAI_FINISH.STOP);

      // Chat→Responses failed path never forwards empty shapes; exact fallback object.
      const failed = project(
        OPENAI_FINISH.ERROR,
        { role: ROLE.ASSISTANT, content: "partial" },
        { error },
      );
      expect(failed.status).toBe("failed");
      expect(failed).not.toHaveProperty("incomplete_details");
      expect(failed.error).toEqual(FAILED_ERROR);
    }
  });

  it("drops empty incomplete_details objects instead of forwarding them", () => {
    expect(responsesIncompleteDetailsOrOmit({})).toBeNull();
    expect(responsesIncompleteDetailsOrOmit({ reason: "" })).toBeNull();
    expect(responsesIncompleteDetailsOrOmit({ reason: "  " })).toBeNull();
    expect(responsesIncompleteDetailsOrOmit({ reason: "max_output_tokens" })).toEqual({
      reason: "max_output_tokens",
    });

    // Empty details on a completed Responses body are ignored (no throw / no new fields).
    const chat = responsesApiToOpenAICompletion({
      id: "r-1331",
      model: "m",
      status: "completed",
      incomplete_details: {},
      output: [{
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "ok" }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }, "m");
    expect(chat.choices[0].finish_reason).toBe("stop");
    expect(chat.choices[0].message.content).toBe("ok");
    expect(chat).not.toHaveProperty("incomplete_details");

    // Known incomplete still emits the exact reason object — empty shapes never do.
    const incomplete = project(OPENAI_FINISH.LENGTH);
    expect(incomplete.status).toBe("incomplete");
    expect(incomplete.incomplete_details).toEqual({ reason: "max_output_tokens" });
    expect(incomplete).not.toHaveProperty("error");
  });
});
