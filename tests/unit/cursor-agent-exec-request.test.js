import { describe, it, expect, vi } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { openaiToCursorRequest } from "../../open-sse/translator/request/openai-to-cursor.js";
import { decodeMessage, encodeAgentValue, encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;

// agent.v1.AgentServerMessage.exec_request (field 2) carrying one ExecServerMessage variant.
function execRequestFrame(execField) {
  const execServerMessage = Buffer.from(encodeField(execField, LEN, new Uint8Array()));
  return Buffer.from(wrapConnectRPCFrame(encodeField(2, LEN, execServerMessage)));
}

// agent.v1.AgentServerMessage.interaction_update (field 1) → text delta.
function textFrame(text) {
  const textPart = Buffer.from(encodeField(1, LEN, text));
  const update = Buffer.from(encodeField(1, LEN, textPart));
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
}

// InteractionUpdate.thinking_delta (field 4) + turn_ended (field 14).
function thinkingFrame(text) {
  const thinkingPart = Buffer.from(encodeField(1, LEN, text));
  const update = Buffer.from(encodeField(4, LEN, thinkingPart));
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
}

function turnEndedFrame() {
  const update = Buffer.from(encodeField(14, LEN, new Uint8Array()));
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
}

function mcpExecRequestFrame({ name, toolCallId = "call_mcp_1", args = {} }) {
  const argEntries = Object.entries(args).map(([key, value]) =>
    Buffer.from(encodeField(2, LEN, Buffer.concat([
      Buffer.from(encodeField(1, LEN, key)),
      Buffer.from(encodeField(2, LEN, encodeAgentValue(value))),
    ])))
  );
  const mcpArgs = Buffer.concat([
    Buffer.from(encodeField(1, LEN, name)),
    ...argEntries,
    Buffer.from(encodeField(3, LEN, toolCallId)),
    Buffer.from(encodeField(5, LEN, name)),
  ]);
  const execServerMessage = Buffer.from(encodeField(11, LEN, mcpArgs));
  return Buffer.from(wrapConnectRPCFrame(encodeField(2, LEN, execServerMessage)));
}

function stubAgentSession(executor, frames) {
  const written = [];
  const queue = [...frames];
  executor.openAgentHttp2Stream = () => ({
    responseHeaders: Promise.resolve({ ":status": 200 }),
    write: (frame) => written.push(Buffer.from(frame)),
    end() {},
    close() {},
    async read() {
      if (!queue.length) return { value: undefined, done: true };
      return { value: queue.shift(), done: false };
    },
  });
  return written;
}

const credentials = {
  accessToken: "test-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

function parseSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

async function runAgent({ frames, stream, model = "gpt-5.2", tools, signal }) {
  const executor = new CursorExecutor();
  const written = stubAgentSession(executor, frames);
  const result = await executor.executeAgent({
    model,
    body: { messages: [{ role: "user", content: "hi" }], ...(tools ? { tools } : {}) },
    stream,
    credentials,
    signal,
  });
  return { result, written };
}

describe("CursorExecutor AgentService exec_request handling", () => {
  for (const intent of [{ reasoning_effort: "high" }, { reasoning: { effort: "high" } }]) {
    it(`passes ${Object.keys(intent)[0]} through the AgentService executor`, async () => {
      const executor = new CursorExecutor();
      const written = stubAgentSession(executor, [textFrame("hello"), turnEndedFrame()]);
      const result = await executor.executeAgent({
        model: "gpt-5.2", body: { messages: [{ role: "user", content: "hi" }], ...intent },
        stream: false, credentials,
      });
      expect(result.response.status).toBe(200);
      const run = decodeMessage(decodeMessage(written[0].subarray(5)).get(1)[0].value);
      const requested = decodeMessage(run.get(9)[0].value);
      const parameter = decodeMessage(requested.get(3)[0].value);
      expect(Buffer.from(parameter.get(1)[0].value).toString()).toBe("reasoning");
      expect(Buffer.from(parameter.get(2)[0].value).toString()).toBe("high");
    });
  }

  for (const frames of [[], [turnEndedFrame()]]) {
    it(`rejects an empty ${frames.length ? "explicit turn" : "EOF"} without a successful SSE stop`, async () => {
      const { result } = await runAgent({ frames, stream: true });
      const text = await result.response.text();
      const events = parseSSE(text);
      expect(events.filter((event) => event.error)).toHaveLength(1);
      expect(events.some((event) => event.choices?.[0]?.finish_reason === "stop")).toBe(false);
      expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
    });

    it(`rejects an empty ${frames.length ? "explicit turn" : "EOF"} for non-stream clients`, async () => {
      const { result } = await runAgent({ frames, stream: false });
      expect(result.response.status).toBe(400);
      expect((await result.response.json()).error.message).toContain("empty turn");
    });
  }

  it("does not emit successful completion when reading the stream fails", async () => {
    const executor = new CursorExecutor();
    const written = stubAgentSession(executor, []);
    const open = executor.openAgentHttp2Stream;
    executor.openAgentHttp2Stream = (...args) => ({
      ...open(...args),
      async read() { throw new Error("transport interrupted"); },
    });
    const { response } = await executor.executeAgent({
      model: "gpt-5.2", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials,
    });
    await expect(response.text()).rejects.toThrow("transport interrupted");
    expect(written).toHaveLength(1);
  });
  it("acknowledges a request-context exec request without ending the turn", async () => {
    const { result, written } = await runAgent({
      frames: [execRequestFrame(10), textFrame("hello")],
      stream: true,
    });

    expect(written.length).toBe(2); // run frame + request-context reply
    const events = parseSSE(await result.response.text());
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("hello");
  });

  it("does not echo client tools on the request_context ack", async () => {
    const { written, result } = await runAgent({
      tools: [{ function: { name: "read_file", parameters: { type: "object" } } }],
      frames: [execRequestFrame(10), textFrame("hello")],
      stream: true,
    });

    expect(written.length).toBe(2);
    expect(written[1].toString("utf8")).not.toContain("read_file");
    const content = parseSSE(await result.response.text())
      .map((e) => e.choices?.[0]?.delta?.content || "")
      .join("");
    expect(content).toBe("hello");
  });

  it("does not render an unsupported exec request as assistant content", async () => {
    const { result, written } = await runAgent({
      frames: [textFrame("partial answer"), execRequestFrame(2), textFrame(" more")],
      stream: true,
    });

    const body = await result.response.text();
    expect(body).not.toContain("unsupported IDE tool");
    const events = parseSSE(body);
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("partial answer more");
    expect(events.some((e) => e.error)).toBe(false);
    expect(written.length).toBe(2); // run frame + IDE rejection
  });

  it("still emits later text after rejecting an IDE exec in the same read", async () => {
    const { result } = await runAgent({
      frames: [Buffer.concat([execRequestFrame(2), textFrame("late")])],
      stream: true,
    });

    const body = await result.response.text();
    expect(body).not.toContain("unsupported IDE tool");
    expect(body).toContain("late");
  });

  it("returns a non-200 error body for an unsupported exec request when not streaming", async () => {
    const { result } = await runAgent({
      frames: [execRequestFrame(11)],
      stream: false,
    });

    expect(result.response.status).not.toBe(200);
    const payload = await result.response.json();
    expect(payload.error.message).toContain("unsupported IDE tool");
  });

  it("streams Composer visible content from thinking_delta after </think>", async () => {
    const { result } = await runAgent({
      model: "composer-2.5",
      frames: [
        thinkingFrame("private reasoning that must not leak</think>OK"),
        turnEndedFrame(),
      ],
      stream: true,
    });

    const events = parseSSE(await result.response.text());
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("OK");
    expect(JSON.stringify(events)).not.toContain("private reasoning");
  });

  it.each([
    [
      ["<|final|>Use <|final|> and <|/final|> literally.<|/final|>"],
      "Use <|final|> and <|/final|> literally.",
    ],
    [
      ["<｜final｜>Quote <｜final｜> and <｜/final｜> here.<｜/final｜>"],
      "Quote <｜final｜> and <｜/final｜> here.",
    ],
    [
      ["<|fi", "nal|>part1 ", "<|/fi", "nal|>", " part2<|/fi", "nal|>"],
      "part1 <|/final|> part2",
    ],
    [
      ["<｜fi", "nal｜>part1 ", "<｜/fi", "nal｜>", " part2<｜/fi", "nal｜>"],
      "part1 <｜/final｜> part2",
    ],
    [
      ["<|final|><|final|>edge<|/final|><|/final|>"],
      "<|final|>edge<|/final|>",
    ],
    [
      ["<|fi", "nal|>", "<|final|>edge<|/final|>", "<|/fi", "nal|>"],
      "<|final|>edge<|/final|>",
    ],
    [["<|fi", "nal|> answer ", "<|/fi", "nal|>"], " answer "],
    [["<｜final｜>A", "<｜/final", "｜>"], "A"],
    [["<｜fina", "l｜>OK_S", "TREAM"], "OK_STREAM"],
    [["<b>keep</b> <|fin", "ish>"], "<b>keep</b> <|finish>"],
    [["<", "div>ok</div>"], "<div>ok</div>"],
    [["<", " 5"], "< 5"],
    [["text <|/fin"], "text <|/fin"],
    [["<|final|>text <|/fin"], "text <|/fin"],
    [["The closing tag is <|/final|>"], "The closing tag is <|/final|>"],
    [["<|final|>Plain body <｜/final｜>"], "Plain body <｜/final｜>"],
    [["  \n", "<|fi", "nal|>OK<|/fi", "nal|>"], "OK"],
  ])("handles Composer framing and interior markers in AgentService %#", async (fragments, expected) => {
    for (const stream of [true, false]) {
      const { result } = await runAgent({
        model: "composer-2.5",
        stream,
        frames: [
          ...fragments.map((part, index) => thinkingFrame((index ? "" : "private reasoning</think>") + part)),
          turnEndedFrame(),
        ],
      });
      const payload = stream ? parseSSE(await result.response.text()) : await result.response.json();
      const content = stream
        ? payload.map((event) => event.choices?.[0]?.delta?.content || "").join("")
        : payload.choices[0].message.content;
      expect(content).toBe(expected);
      expect(JSON.stringify(payload)).not.toContain("private reasoning");
    }
  });

  it("streams Composer AgentService content incrementally across chunks without replay", async () => {
    const fragments = [
      "private</think><|final|>",
      ...Array.from({ length: 25 }, (_, i) => `tok-${i} `),
      "<|/final|>",
    ];
    const expected = Array.from({ length: 25 }, (_, i) => `tok-${i} `).join("");
    const { result } = await runAgent({
      model: "composer-2.5",
      stream: true,
      frames: [...fragments.map((part) => thinkingFrame(part)), turnEndedFrame()],
    });

    const events = parseSSE(await result.response.text());
    const contentChunks = events
      .map((event) => event.choices?.[0]?.delta?.content || "")
      .filter(Boolean);

    expect(contentChunks.length).toBeGreaterThanOrEqual(20);
    expect(contentChunks.join("")).toBe(expected);
  });

  it("leaves native text deltas untouched for Composer in streaming and buffered AgentService", async () => {
    for (const stream of [true, false]) {
      const { result } = await runAgent({
        model: "composer-2.5",
        stream,
        frames: [
          thinkingFrame("private reasoning"),
          textFrame("<|final|>native</think><|/final|>"),
          turnEndedFrame(),
        ],
      });
      const payload = stream ? parseSSE(await result.response.text()) : await result.response.json();
      const content = stream
        ? payload.map((event) => event.choices?.[0]?.delta?.content || "").join("")
        : payload.choices[0].message.content;
      expect(content).toBe("<|final|>native</think><|/final|>");
      expect(JSON.stringify(payload)).not.toContain("private reasoning");
    }
  });

  it("keeps hidden reasoning private when Composer AgentService has no </think>", async () => {
    const streamRun = await runAgent({
      model: "composer-2.5",
      stream: true,
      frames: [thinkingFrame("private reasoning <|final|>never visible"), turnEndedFrame()],
    });
    const sseText = await streamRun.result.response.text();
    const events = parseSSE(sseText);
    expect(events.filter((event) => event.error)).toHaveLength(1);
    expect(events.some((event) => event.choices?.[0]?.finish_reason === "stop")).toBe(false);
    expect(sseText).not.toContain("private reasoning");

    const bufferedRun = await runAgent({
      model: "composer-2.5",
      stream: false,
      frames: [thinkingFrame("private reasoning <|final|>never visible"), turnEndedFrame()],
    });
    expect(bufferedRun.result.response.status).toBe(400);
    expect(await bufferedRun.result.response.text()).not.toContain("private reasoning");
  });

  it("preserves MCP tool calls with both framed and unclosed Composer thinking", async () => {
    for (const stream of [true, false]) {
      const framed = await runAgent({
        model: "composer-2.5",
        stream,
        frames: [
          thinkingFrame("private</think><|final|>Checking <|/final|>"),
          mcpExecRequestFrame({ name: "get_weather", toolCallId: "call_1", args: { city: "Oslo" } }),
        ],
      });
      const framedPayload = stream ? parseSSE(await framed.result.response.text()) : await framed.result.response.json();
      if (stream) {
        expect(framedPayload.map((e) => e.choices?.[0]?.delta?.content || "").join("")).toBe("Checking ");
        expect(framedPayload.some((e) => e.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name === "get_weather")).toBe(true);
        expect(framedPayload.some((e) => e.choices?.[0]?.finish_reason === "tool_calls")).toBe(true);
      } else {
        expect(framedPayload.choices[0].message.content).toBe("Checking ");
        expect(framedPayload.choices[0].finish_reason).toBe("tool_calls");
        expect(framedPayload.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
      }
      expect(JSON.stringify(framedPayload)).not.toContain("private");

      const hidden = await runAgent({
        model: "composer-2.5",
        stream,
        frames: [
          thinkingFrame("private reasoning before tool"),
          mcpExecRequestFrame({ name: "get_weather", toolCallId: "call_2", args: { city: "Bergen" } }),
        ],
      });
      const hiddenPayload = stream ? parseSSE(await hidden.result.response.text()) : await hidden.result.response.json();
      if (stream) {
        expect(hiddenPayload.map((e) => e.choices?.[0]?.delta?.content || "").join("")).toBe("");
        expect(hiddenPayload.some((e) => e.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name === "get_weather")).toBe(true);
        expect(hiddenPayload.some((e) => e.choices?.[0]?.finish_reason === "tool_calls")).toBe(true);
      } else {
        expect(hiddenPayload.choices[0].message.content).toBeNull();
        expect(hiddenPayload.choices[0].finish_reason).toBe("tool_calls");
        expect(hiddenPayload.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
      }
      expect(JSON.stringify(hiddenPayload)).not.toContain("private reasoning");
    }
  });

  it("does not flush held partial markers or emit stop when aborted mid-stream", async () => {
    const decoder = new TextDecoder();

    const makeAbortableSession = (executor, firstFrame) => {
      let closed = 0;
      let reads = 0;
      executor.openAgentHttp2Stream = (_url, _headers, signal) => ({
        responseHeaders: Promise.resolve({ ":status": 200 }),
        write() {},
        end() {},
        close() { closed++; },
        read() {
          if (reads === 0) {
            reads++;
            return Promise.resolve({ value: firstFrame, done: false });
          }
          if (signal?.aborted) {
            return Promise.reject(new DOMException("Cursor request aborted", "AbortError"));
          }
          return new Promise((_, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("Cursor request aborted", "AbortError"));
            }, { once: true });
          });
        },
      });
      return { getClosed: () => closed };
    };

    const streamExecutor = new CursorExecutor();
    const streamTracker = makeAbortableSession(
      streamExecutor,
      thinkingFrame("private</think><|final|>hello <|/fi")
    );
    const streamAbort = new AbortController();
    const streamResult = await streamExecutor.executeAgent({
      model: "composer-2.5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
      signal: streamAbort.signal,
    });
    const reader = streamResult.response.body.getReader();
    const firstRead = await reader.read();
    expect(firstRead.done).toBe(false);
    const firstText = decoder.decode(firstRead.value);
    expect(firstText).toContain("hello ");
    expect(firstText).not.toContain("<|/fi");

    streamAbort.abort();
    await expect(reader.read()).rejects.toThrow();
    expect(streamTracker.getClosed()).toBeGreaterThan(0);

    const bufferedExecutor = new CursorExecutor();
    const bufferedTracker = makeAbortableSession(
      bufferedExecutor,
      thinkingFrame("private</think><|final|>hello <|/fi")
    );
    const bufferedAbort = new AbortController();
    const bufferedPromise = bufferedExecutor.executeAgent({
      model: "composer-2.5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
      signal: bufferedAbort.signal,
    });
    setTimeout(() => bufferedAbort.abort(), 10);
    await expect(bufferedPromise).rejects.toThrow();
    expect(bufferedTracker.getClosed()).toBeGreaterThan(0);
  });

  it("flushes Grok thinking as visible content when the turn has no text_delta", async () => {
    const { result } = await runAgent({
      model: "grok-4.5",
      frames: [thinkingFrame("hello from grok"), turnEndedFrame()],
      stream: true,
    });

    const events = parseSSE(await result.response.text());
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("hello from grok");
  });
});

describe("port(upstream) #4867: translated history through execute()", () => {
  it.each([false, true])("sends it in UserMessage.text with stream %s", async (stream) => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline test"); }));
    try {
      const executor = new CursorExecutor();
      const written = stubAgentSession(executor, [textFrame("pineapple"), turnEndedFrame()]);
      const body = openaiToCursorRequest("gpt-5.2", { messages: [
        { role: "system", content: "Answer briefly" },
        { role: "developer", content: "Remember the conversation" },
        { role: "user", content: "The secret word is pineapple" },
        { role: "assistant", content: "Remembered" },
        { role: "user", content: "What is the secret word?" },
      ] });
      const { response } = await executor.execute({ model: "gpt-5.2", body, stream, credentials });
      expect(response.status).toBe(200);
      await response.text();
      expect(written).toHaveLength(1);
      const run = decodeMessage(decodeMessage(written[0].subarray(5)).get(1)[0].value);
      const userAction = decodeMessage(decodeMessage(run.get(2)[0].value).get(1)[0].value);
      const userMessage = decodeMessage(userAction.get(1)[0].value);
      const text = Buffer.from(userMessage.get(1)[0].value).toString("utf8");
      expect(text.startsWith("Answer briefly\n\nRemember the conversation\n\n")).toBe(true);
      expect(text).toContain("The secret word is pineapple");
      expect(text).toContain("Remembered");
      expect(text.endsWith("What is the secret word?")).toBe(true);
      expect(userAction.has(7)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Cursor long-session empty-turn recovery", () => {
  // UserMessage.text: a full replay inlines the history, a tail-only retry omits it.
  function runFrameText(frame) {
    const run = decodeMessage(decodeMessage(frame.subarray(5)).get(1)[0].value);
    const userAction = decodeMessage(decodeMessage(run.get(2)[0].value).get(1)[0].value);
    const userMessage = decodeMessage(userAction.get(1)[0].value);
    return Buffer.from(userMessage.get(1)[0].value).toString("utf8");
  }

  // 79 filler turns + the live user turn → threshold met by default (80).
  const longBody = {
    messages: [
      ...Array.from({ length: 79 }, (_, i) => ({ role: "user", content: `m${i}` })),
      { role: "user", content: "answer me" },
    ],
  };

  function stubSequentialAgentSessions(executor, attempts) {
    const writtenPerAttempt = [];
    let call = 0;
    executor.openAgentHttp2Stream = () => {
      const frames = attempts[Math.min(call, attempts.length - 1)];
      const written = [];
      writtenPerAttempt.push(written);
      const queue = [...frames];
      call++;
      return {
        responseHeaders: Promise.resolve({ ":status": 200 }),
        write: (frame) => written.push(Buffer.from(frame)),
        end() {},
        close() {},
        async read() {
          if (!queue.length) return { value: undefined, done: true };
          return { value: queue.shift(), done: false };
        },
      };
    };
    return writtenPerAttempt;
  }

  it("retries a wedged long session once with a tail-only frame (streaming)", async () => {
    const executor = new CursorExecutor();
    const writtenPerAttempt = stubSequentialAgentSessions(executor, [
      [],
      [textFrame("recovered"), turnEndedFrame()],
    ]);
    const result = await executor.executeAgent({
      model: "gpt-5.2", body: longBody, stream: true, credentials,
    });

    // Consumption (and therefore the retry) is lazy: drain the stream first.
    const text = await result.response.text();
    expect(writtenPerAttempt).toHaveLength(2);
    // First attempt replays full history; the retry ships a tail-only frame.
    expect(runFrameText(writtenPerAttempt[0][0])).toContain("[user]\nm0");
    expect(runFrameText(writtenPerAttempt[0][0])).toContain("[user]\nm78");
    expect(runFrameText(writtenPerAttempt[1][0])).toMatch(/\n\nanswer me$/);
    expect(runFrameText(writtenPerAttempt[1][0])).not.toContain("<conversation_history>");

    const events = parseSSE(text);
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("recovered");
    expect(events.filter((e) => e.error)).toHaveLength(0);
    expect(events.filter((e) => e.choices?.[0]?.finish_reason === "stop")).toHaveLength(1);
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("recovers a wedged long session for non-stream clients", async () => {
    const executor = new CursorExecutor();
    stubSequentialAgentSessions(executor, [
      [],
      [textFrame("ok"), turnEndedFrame()],
    ]);
    const result = await executor.executeAgent({
      model: "gpt-5.2", body: longBody, stream: false, credentials,
    });
    expect(result.response.status).toBe(200);
    const payload = await result.response.json();
    expect(payload.choices[0].message.content).toBe("ok");
  });

  it("does not retry a short session — first-message empty stays an error", async () => {
    const executor = new CursorExecutor();
    const writtenPerAttempt = stubSequentialAgentSessions(executor, [[]]);
    const result = await executor.executeAgent({
      model: "gpt-5.2", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials,
    });

    expect(writtenPerAttempt).toHaveLength(1);
    const text = await result.response.text();
    const events = parseSSE(text);
    expect(events.filter((e) => e.error)).toHaveLength(1);
    expect(events.some((e) => e.choices?.[0]?.finish_reason === "stop")).toBe(false);
  });

  it("does not retry once real content has streamed", async () => {
    const executor = new CursorExecutor();
    // Content followed by EOF: the turn completes with what was emitted.
    const writtenPerAttempt = stubSequentialAgentSessions(executor, [
      [textFrame("partial")],
    ]);
    const result = await executor.executeAgent({
      model: "gpt-5.2", body: longBody, stream: true, credentials,
    });

    expect(writtenPerAttempt).toHaveLength(1);
    const events = parseSSE(await result.response.text());
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("partial");
    expect(events.filter((e) => e.error)).toHaveLength(0);
  });

  it("reports a stream reset after partial output without a successful finish", async () => {
    const executor = new CursorExecutor();
    let reads = 0;
    executor.openAgentHttp2Stream = () => ({
      responseHeaders: Promise.resolve({ ":status": 200 }),
      write() {}, end() {}, close() {},
      async read() {
        if (reads++ === 0) return { value: textFrame("partial"), done: false };
        throw new Error("stream reset");
      },
    });
    const result = await executor.executeAgent({
      model: "gpt-5.2", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, proxyOptions: { disableEnvProxy: true },
    });
    const events = parseSSE(await result.response.text());
    expect(events.some((event) => event.choices?.[0]?.delta?.content === "partial")).toBe(true);
    expect(events.some((event) => event.error?.message === "stream reset")).toBe(true);
    expect(events.some((event) => event.choices?.[0]?.finish_reason === "stop")).toBe(false);
  });

  it("tailOnlyCursorMessages keeps system, drops bulk history, keeps the live turn", async () => {
    const { tailOnlyCursorMessages } = await import("../../open-sse/executors/cursor.js");
    const messages = [
      { role: "system", content: "be helpful" },
      ...Array.from({ length: 90 }, (_, i) => ({ role: "user", content: `m${i}` })),
      { role: "assistant", content: "working on it" },
      { role: "tool", content: "result" },
      { role: "user", content: "final ask" },
    ];
    const trimmed = tailOnlyCursorMessages(messages);
    expect(trimmed[0]).toEqual({ role: "system", content: "be helpful" });
    expect(trimmed).toHaveLength(3);
    expect(trimmed[1].content).toContain("94 messages trimmed");
    expect(trimmed[2].content).toBe("final ask");

    // Idempotent: prior [durindoor] notes are stripped on re-trim.
    const again = tailOnlyCursorMessages(trimmed);
    expect(again.filter((m) => String(m.content).includes("[durindoor]"))).toHaveLength(1);

    // Legacy [9router] notes are stripped too.
    const legacy = [{ role: "system", content: "[9router] Long session: 9 messages trimmed" }, ...trimmed.slice(1)];
    const stripped = tailOnlyCursorMessages(legacy);
    expect(stripped.filter((m) => String(m.content).includes("[9router]"))).toHaveLength(0);
  });
});
