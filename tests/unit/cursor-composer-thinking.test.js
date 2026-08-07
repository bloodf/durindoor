import { describe, it, expect } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;

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

  it.each([
    ["<｜final｜>OK<｜/final｜>", "OK"],
    ["<|final|>HELLO<|/final|>", "HELLO"],
  ])("strips Composer final sentinels from %s", async (visible, expected) => {
    const executor = new CursorExecutor();
    const response = executor.transformProtobufToJSON(
      cursorResponseFrame({ thinking: `private</think>${visible}` }),
      "cu/composer-2.5",
      { messages: [{ role: "user", content: "reply" }] },
    );
    expect((await response.json()).choices[0].message.content).toBe(expected);
  });

  it("preserves Composer output that starts with an HTML tag", async () => {
    const executor = new CursorExecutor();
    const response = executor.transformProtobufToJSON(
      cursorResponseFrame({ thinking: "private</think><div>OK</div>" }),
      "cu/composer-2.5",
      { messages: [{ role: "user", content: "reply" }] },
    );
    expect((await response.json()).choices[0].message.content).toBe("<div>OK</div>");
  });

  it("does not leak a partial streamed Composer final sentinel", async () => {
    const executor = new CursorExecutor();
    const buffer = Buffer.concat([
      cursorResponseFrame({ thinking: "private</think><｜fina" }),
      cursorResponseFrame({ thinking: "l｜>OK" }),
    ]);
    const events = parseSSE(await executor.transformProtobufToSSE(
      buffer,
      "cu/composer-2.5",
      { messages: [{ role: "user", content: "reply" }] },
    ).text());
    const content = events.map((event) => event.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("OK");
    expect(content).not.toContain("｜");
  });

  it("does not leak a streamed Composer closing sentinel split across frames", async () => {
    const executor = new CursorExecutor();
    const buffer = Buffer.concat([
      cursorResponseFrame({ thinking: "private</think><｜final｜>OK<｜/fina" }),
      cursorResponseFrame({ thinking: "l｜>" }),
    ]);
    const events = parseSSE(await executor.transformProtobufToSSE(
      buffer,
      "cu/composer-2.5",
      { messages: [{ role: "user", content: "reply" }] },
    ).text());
    const content = events.map((event) => event.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("OK");
    expect(content).not.toContain("final");
    expect(content).not.toContain("｜");
  });
});
