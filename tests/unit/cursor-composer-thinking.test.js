import { describe, it, expect } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;
const VARINT = 0;

function cursorResponseFrame({ text = "", thinking = "" }) {
  const responseFields = [];

  if (text) {
    responseFields.push(encodeField(1, LEN, text));
  }

  if (thinking) {
    const thinkingMessage = encodeField(1, LEN, thinking);
    responseFields.push(encodeField(25, LEN, thinkingMessage));
  }

  const response = Buffer.concat(responseFields.map((field) => Buffer.from(field)));
  const envelope = encodeField(2, LEN, response);
  return Buffer.from(wrapConnectRPCFrame(envelope));
}

function cursorToolCallFrame({ id = "call_1", name = "get_weather", rawArgs = '{"city":"Oslo"}', isLast = true }) {
  const toolCall = Buffer.concat([
    Buffer.from(encodeField(3, LEN, id)),
    Buffer.from(encodeField(9, LEN, name)),
    Buffer.from(encodeField(10, LEN, rawArgs)),
    Buffer.from(encodeField(11, VARINT, isLast ? 1 : 0)),
  ]);
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, toolCall)));
}

function parseSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

describe("CursorExecutor Composer thinking-field responses", () => {
  it("uses visible content after </think> for non-streaming Composer responses", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "private reasoning that must not leak</think>OK",
    });

    const response = executor.transformProtobufToJSON(buffer, "cu/composer-2.5", {
      messages: [{ role: "user", content: "reply OK" }],
    });
    const payload = await response.json();

    expect(payload.choices[0].message.content).toBe("OK");
    expect(JSON.stringify(payload)).not.toContain("private reasoning");
    expect(payload.usage.completion_tokens).toBeGreaterThan(0);
  });

  it("streams only visible content after </think> for Composer responses", async () => {
    const executor = new CursorExecutor();
    const buffer = Buffer.concat([
      cursorResponseFrame({ thinking: "private reasoning" }),
      cursorResponseFrame({ thinking: " that must not leak</think>O" }),
      cursorResponseFrame({ thinking: "K" }),
    ]);

    const response = executor.transformProtobufToSSE(buffer, "composer-2.5-fast", {
      messages: [{ role: "user", content: "reply OK" }],
    });
    const events = parseSSE(await response.text());
    const content = events
      .map((event) => event.choices?.[0]?.delta?.content || "")
      .join("");

    expect(content).toBe("OK");
    expect(JSON.stringify(events)).not.toContain("private reasoning");
    expect(events.at(-1).usage.completion_tokens).toBeGreaterThan(0);
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
    // #1073: real closing marker followed only by trailing whitespace at end of stream
    [["<|final|>Answer<|/final|>"], "Answer"],
    [["<|final|>Answer\n"], "Answer\n"],
    [["<|final|>Answer<|/final|>\n"], "Answer\n"],
    [["<|final|>Answer<|/final|> \n\n"], "Answer \n\n"],
    [["<|final|>Answer<|/final|>", "\n"], "Answer\n"],
    [["<|final|>Answer<|/final|>", " \n", "\n"], "Answer \n\n"],
    [["<|final|>Answer<|/fi", "nal|>\n"], "Answer\n"],
    [["<｜final｜>Answer<｜/final｜>", "\n"], "Answer\n"],
    [["<|final|>A<|/final|>\n", "B<|/final|>"], "A<|/final|>\nB"],
    [["<|final|>A<|/final|>", "\n", "B"], "A<|/final|>\nB"],
  ])("preserves visible answers and boundary framing across buffered and fragmented frames %#", async (fragments, expected) => {
    const executor = new CursorExecutor();
    const buffer = Buffer.concat(fragments.map((part, index) => cursorResponseFrame({
      thinking: (index === 0 ? "private reasoning</think>" : "") + part,
    })));
    const body = { messages: [{ role: "user", content: "hi" }] };
    const json = await executor.transformProtobufToJSON(buffer, "composer-2.5", body).json();
    const events = parseSSE(await executor.transformProtobufToSSE(buffer, "composer-2.5", body).text());
    expect(json.choices[0].message.content).toBe(expected);
    expect(events.map((event) => event.choices?.[0]?.delta?.content || "").join("")).toBe(expected);
    expect(JSON.stringify(json)).not.toContain("private reasoning");
    expect(JSON.stringify(events)).not.toContain("private reasoning");
  });

  it("handles 1-character fragmentation across </think>, boundary framing, and interior quoted markers without replay", async () => {
    const executor = new CursorExecutor();
    const rawThinking = "private reasoning</think><|final|>Use <|final|> and <|/final|> literally.<|/final|>";
    const expected = "Use <|final|> and <|/final|> literally.";
    const buffer = Buffer.concat([...rawThinking].map((ch) => cursorResponseFrame({ thinking: ch })));
    const body = { messages: [{ role: "user", content: "hi" }] };

    const json = await executor.transformProtobufToJSON(buffer, "composer-2.5", body).json();
    const events = parseSSE(await executor.transformProtobufToSSE(buffer, "composer-2.5", body).text());
    const contentChunks = events
      .map((event) => event.choices?.[0]?.delta?.content || "")
      .filter(Boolean);

    expect(json.choices[0].message.content).toBe(expected);
    expect(contentChunks.join("")).toBe(expected);
    expect(contentChunks.length).toBeGreaterThan(5);
    expect(JSON.stringify(events)).not.toContain("private reasoning");
  });

  it("streams framed content incrementally rather than buffering until completion", async () => {
    const executor = new CursorExecutor();
    const parts = [
      "private</think><|final|>",
      ...Array.from({ length: 30 }, (_, i) => `seg-${i} `),
      "<|/final|>",
    ];
    const expected = Array.from({ length: 30 }, (_, i) => `seg-${i} `).join("");
    const buffer = Buffer.concat(parts.map((thinking) => cursorResponseFrame({ thinking })));

    const events = parseSSE(
      await executor.transformProtobufToSSE(buffer, "composer-2.5", { messages: [{ role: "user", content: "hi" }] }).text()
    );
    const contentChunks = events
      .map((event) => event.choices?.[0]?.delta?.content || "")
      .filter(Boolean);

    expect(contentChunks.length).toBeGreaterThanOrEqual(20);
    expect(contentChunks.join("")).toBe(expected);
  });

  it("keeps hidden reasoning private when Composer emits no </think>", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "private reasoning with <|final|> inside",
    });
    const body = { messages: [{ role: "user", content: "hi" }] };

    const json = await executor.transformProtobufToJSON(buffer, "composer-2.5", body).json();
    const events = parseSSE(await executor.transformProtobufToSSE(buffer, "composer-2.5", body).text());

    expect(json.choices[0].message.content).toBeNull();
    expect(events.map((event) => event.choices?.[0]?.delta?.content || "").join("")).toBe("");
    expect(JSON.stringify(json)).not.toContain("private reasoning");
    expect(JSON.stringify(events)).not.toContain("private reasoning");
  });

  it("leaves actual native text frames untouched for Composer", async () => {
    const executor = new CursorExecutor();
    const native = "<|final|>native</think><|/final|>";
    const buffer = Buffer.concat([
      cursorResponseFrame({ thinking: "private reasoning" }),
      cursorResponseFrame({ text: native }),
    ]);
    const body = { messages: [{ role: "user", content: "hi" }] };

    const json = await executor.transformProtobufToJSON(buffer, "composer-2.5", body).json();
    const events = parseSSE(await executor.transformProtobufToSSE(buffer, "composer-2.5", body).text());

    expect(json.choices[0].message.content).toBe(native);
    expect(events.map((event) => event.choices?.[0]?.delta?.content || "").join("")).toBe(native);
    expect(JSON.stringify(json)).not.toContain("private reasoning");
    expect(JSON.stringify(events)).not.toContain("private reasoning");
  });

  it("preserves structured tool calls alongside framed Composer thinking and hidden reasoning", async () => {
    const executor = new CursorExecutor();
    const body = { messages: [{ role: "user", content: "weather" }] };

    const framedBuffer = Buffer.concat([
      cursorResponseFrame({ thinking: "private</think><|final|>Checking.<|/final|>" }),
      cursorToolCallFrame({ id: "call_framed", name: "get_weather", rawArgs: '{"city":"Oslo"}' }),
    ]);
    const framedJson = await executor.transformProtobufToJSON(framedBuffer, "composer-2.5", body).json();
    const framedEvents = parseSSE(await executor.transformProtobufToSSE(framedBuffer, "composer-2.5", body).text());

    expect(framedJson.choices[0].message.content).toBe("Checking.");
    expect(framedJson.choices[0].finish_reason).toBe("tool_calls");
    expect(framedJson.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
    expect(framedEvents.map((event) => event.choices?.[0]?.delta?.content || "").join("")).toBe("Checking.");
    expect(framedEvents.some((event) => event.choices?.[0]?.finish_reason === "tool_calls")).toBe(true);
    expect(JSON.stringify(framedEvents)).not.toContain("private");

    const hiddenBuffer = Buffer.concat([
      cursorResponseFrame({ thinking: "private reasoning only" }),
      cursorToolCallFrame({ id: "call_hidden", name: "get_weather", rawArgs: '{"city":"Bergen"}' }),
    ]);
    const hiddenJson = await executor.transformProtobufToJSON(hiddenBuffer, "composer-2.5", body).json();
    const hiddenEvents = parseSSE(await executor.transformProtobufToSSE(hiddenBuffer, "composer-2.5", body).text());

    expect(hiddenJson.choices[0].message.content).toBeNull();
    expect(hiddenJson.choices[0].finish_reason).toBe("tool_calls");
    expect(hiddenJson.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
    expect(hiddenEvents.map((event) => event.choices?.[0]?.delta?.content || "").join("")).toBe("");
    expect(hiddenEvents.some((event) => event.choices?.[0]?.finish_reason === "tool_calls")).toBe(true);
    expect(JSON.stringify(hiddenEvents)).not.toContain("private reasoning");
  });

  it("does not treat thinking as visible output for non-Composer models", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "private reasoning</think>SHOULD_NOT_APPEAR",
    });

    const response = executor.transformProtobufToJSON(buffer, "gpt-5.3-codex", {
      messages: [{ role: "user", content: "hi" }],
    });
    const payload = await response.json();

    expect(payload.choices[0].message.content).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("SHOULD_NOT_APPEAR");
  });
});
