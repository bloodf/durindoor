// Ported from OmniRoute #20224 (upstream commits 799279a67a3d356c0c188a4abe5bc640d884dfb1
// and 6bb7f88d982879197e360bbd272c52bba60b5eb2): a repeated finish chunk must not repeat
// tool calls on the Gemini/Antigravity wire, and must not add events after Claude
// `message_stop`. Valid single-finish streams stay unchanged.
//
// Synthetic fixtures only: no provider call, no credentials, no network.

import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";
import { geminiToClaudeResponse } from "../../open-sse/translator/response/gemini-to-claude.js";
import { OPENAI_FINISH, GEMINI_FINISH } from "../../open-sse/translator/schema/index.js";

const openaiChunk = (delta, finishReason = null) => ({
  id: "chatcmpl-rf",
  object: "chat.completion.chunk",
  model: "gpt-4.1",
  choices: [{ index: 0, delta, finish_reason: finishReason }]
});

const toolCallChunk = (index, id, name) =>
  openaiChunk({ tool_calls: [{ index, id, function: { name, arguments: "{\"q\":1}" } }] });
const finishChunk = () => openaiChunk({}, OPENAI_FINISH.TOOL_CALLS);

const partsOf = (frame) => frame?.response?.candidates?.[0]?.content?.parts ?? [];
const functionCalls = (frames) => frames.flatMap(partsOf).filter((part) => part.functionCall);

describe("OpenAI → Antigravity/Gemini: repeated finish chunk", () => {
  it("emits the accumulated tool call once (direct translator)", () => {
    const state = {};
    const frames = [toolCallChunk(0, "call_1", "lookup"), finishChunk(), finishChunk(), finishChunk()]
      .map((chunk) => openaiToAntigravityResponse(chunk, state))
      .filter(Boolean);
    const calls = functionCalls(frames);
    expect(calls).toHaveLength(1);
    expect(calls[0].functionCall).toMatchObject({ id: "call_1", name: "lookup", args: { q: 1 } });
  });

  it.each([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY])(
    "emits the tool call once through the registry for %s",
    (clientFormat) => {
      const state = initState(clientFormat);
      const frames = [toolCallChunk(0, "call_1", "lookup"), finishChunk(), finishChunk()].flatMap(
        (chunk) => translateResponse(FORMATS.OPENAI, clientFormat, chunk, state) ?? []
      );
      expect(functionCalls(frames)).toHaveLength(1);
    }
  );

  it("emits no functionCall on the repeated finish frame", () => {
    const state = {};
    openaiToAntigravityResponse(toolCallChunk(0, "call_1", "lookup"), state);
    const first = openaiToAntigravityResponse(finishChunk(), state);
    const repeat = openaiToAntigravityResponse(finishChunk(), state);
    expect(functionCalls([first])).toHaveLength(1);
    expect(functionCalls([repeat])).toHaveLength(0);
    expect(partsOf(first)[0].functionCall.name).toBe("lookup");
  });

  it("still emits a tool call that streams after an earlier finish", () => {
    const state = {};
    const frames = [
      toolCallChunk(0, "call_1", "lookup"),
      finishChunk(),
      toolCallChunk(0, "call_2", "other"),
      finishChunk(),
      finishChunk()
    ]
      .map((chunk) => openaiToAntigravityResponse(chunk, state))
      .filter(Boolean);
    expect(functionCalls(frames).map((part) => part.functionCall.id)).toEqual(["call_1", "call_2"]);
  });

  it("keeps a valid single-finish stream with two parallel calls unchanged", () => {
    const state = {};
    const frames = [
      toolCallChunk(0, "call_a", "alpha"),
      toolCallChunk(1, "call_b", "beta"),
      finishChunk()
    ]
      .map((chunk) => openaiToAntigravityResponse(chunk, state))
      .filter(Boolean);
    expect(functionCalls(frames).map((part) => part.functionCall.name)).toEqual(["alpha", "beta"]);
    expect(frames).toHaveLength(1);
    expect(frames[0].response.candidates[0].finishReason).toBe(GEMINI_FINISH.STOP);
  });
});

const geminiChunk = (text, finishReason) => ({
  responseId: "r1",
  modelVersion: "gemini-test",
  candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : null) }]
});

const typesOf = (events) => events.map((event) => event.type);

describe("Gemini → Claude: no events after message_stop", () => {
  it("ignores a later chunk that repeats finishReason (direct translator)", () => {
    const state = {};
    const events = [
      geminiChunk("Hi", GEMINI_FINISH.STOP),
      {
        ...geminiChunk(" late", GEMINI_FINISH.STOP),
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 }
      }
    ].flatMap((chunk) => geminiToClaudeResponse(chunk, state) ?? []);
    const types = typesOf(events);
    expect(types.filter((type) => type === "message_stop")).toHaveLength(1);
    expect(types.filter((type) => type === "message_delta")).toHaveLength(1);
    expect(types.at(-1)).toBe("message_stop");
    expect(events.some((event) => event.delta?.text === " late")).toBe(false);
  });

  it("emits nothing for any chunk after the terminal event (through the registry)", () => {
    const state = initState(FORMATS.CLAUDE);
    const first = translateResponse(FORMATS.GEMINI, FORMATS.CLAUDE, geminiChunk("Hi", GEMINI_FINISH.STOP), state);
    expect(typesOf(first).at(-1)).toBe("message_stop");
    for (const chunk of [
      geminiChunk("again", GEMINI_FINISH.STOP),
      geminiChunk("plain"),
      { candidates: [{ content: { parts: [{ functionCall: { id: "late", name: "t", args: {} } }] } }] }
    ]) {
      expect(translateResponse(FORMATS.GEMINI, FORMATS.CLAUDE, chunk, state) ?? []).toEqual([]);
    }
  });

  it("keeps a normal stream at one message_delta and one message_stop", () => {
    const state = {};
    const events = [geminiChunk("Hel"), geminiChunk("lo", GEMINI_FINISH.STOP)].flatMap(
      (chunk) => geminiToClaudeResponse(chunk, state) ?? []
    );
    const types = typesOf(events);
    expect(types.filter((type) => type === "message_start")).toHaveLength(1);
    expect(types.filter((type) => type === "message_delta")).toHaveLength(1);
    expect(types.filter((type) => type === "message_stop")).toHaveLength(1);
    expect(types.at(-1)).toBe("message_stop");
    expect(events.filter((event) => event.delta?.type === "text_delta").map((event) => event.delta.text)).toEqual(["Hel", "lo"]);
  });
});
