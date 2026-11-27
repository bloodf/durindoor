import "../translator/registerAll.js";
import { describe, expect, it } from "vitest";
import { convertResponsesApiFormat, normalizeResponsesInput, normalizeResponsesInputForChat } from "../../open-sse/translator/formats/responsesApi.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE, RESPONSES_ITEM, OPENAI_BLOCK, CLAUDE_BLOCK } from "../../open-sse/translator/schema/index.js";

const agent = RESPONSES_ITEM.AGENT_MESSAGE;
const userItem = (text) => ({ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text }] });
const history = { type: RESPONSES_ITEM.MESSAGE, role: ROLE.ASSISTANT, content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text: "Earlier answer" }] };

describe("OmniRoute #21417 inbound agent messages", () => {
  it.each([
    [{ type: agent, content: "Task", author: "parent", recipient: "worker" }, "[Agent message from parent to worker]\nTask"],
    [{ role: agent, text: "Reply", author: "worker" }, "[Agent message from worker to unknown]\nReply"],
    [{ type: agent, content: "Task", recipient: "worker" }, "[Agent message from unknown to worker]\nTask"],
    [{ type: agent, content: "Reply", author: 12, recipient: {} }, "Reply"],
    [{ type: agent, content: ["first", { type: RESPONSES_ITEM.INPUT_TEXT, text: "second" }, { type: RESPONSES_ITEM.OUTPUT_TEXT, text: "third" }, { type: OPENAI_BLOCK.TEXT, text: "fourth" }] }, "first\nsecond\nthird\nfourth"],
    [{ type: agent, content: "  preserved  ", text: "ignored" }, "  preserved  "],
    [{ type: agent, content: [], text: "fallback" }, "fallback"],
  ])("normalizes plaintext with provenance: %j", (item, expected) => {
    const original = structuredClone(item);
    expect(normalizeResponsesInputForChat([item])).toEqual([userItem(expected)]);
    expect(item).toEqual(original);
  });

  it.each([
    { type: agent, content: "" }, { type: agent, content: " \n" },
    { type: agent, content: [] }, { type: agent },
    { type: agent, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: 1 }] },
    { type: agent, content: [null] },
    { type: agent, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "secret prefix" }, { type: "encrypted_content", encrypted_content: "opaque" }] },
    { type: agent, content: [{ type: RESPONSES_ITEM.INPUT_IMAGE, image_url: "image" }] },
  ])("ignores empty or unsupported content without partial leakage: %j", (item) => {
    expect(normalizeResponsesInputForChat([item])).toEqual([{ type: RESPONSES_ITEM.REASONING }]);
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "test", { input: [history, item] }, false);
    expect(result.messages).toEqual([{ role: ROLE.ASSISTANT, content: "Earlier answer" }]);
  });

  it.each([FORMATS.OPENAI, FORMATS.CLAUDE])("delivers replies after ordinary assistant history to %s", (target) => {
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, target, "test", { input: [history, { type: agent, content: "Continue", author: "worker", recipient: "parent" }] }, false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((m) => m.role)).toEqual([ROLE.ASSISTANT, ROLE.USER]);
    expect(result.messages[1].content).toEqual(target === FORMATS.OPENAI ? "[Agent message from worker to parent]\nContinue" : [{ type: CLAUDE_BLOCK.TEXT, text: "[Agent message from worker to parent]\nContinue" }]);
  });

  it("skips rewriting in translator identity only; executors are covered separately", () => {
    const item = { type: agent, content: "Native task", author: "parent", recipient: "worker" };
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "test", { input: [item] }, false);
    expect(result.input).toEqual([item]);
  });

  it("lowers agent context in the worker Chat converter too", () => {
    expect(convertResponsesApiFormat({ input: [{ type: agent, content: "Task", author: "parent" }] }).messages)
      .toEqual([{ role: ROLE.USER, content: [{ type: OPENAI_BLOCK.TEXT, text: "[Agent message from parent to unknown]\nTask" }] }]);
  });

  it("preserves native agent input in shared normalization", () => {
    const input = [{ type: agent, content: "Native task" }, { role: agent, content: [{ type: "encrypted_content", encrypted_content: "opaque" }] }];
    expect(normalizeResponsesInput(input)).toBe(input);
  });

  it("preserves normal history and metadata by reference", () => {
    const metadata = { type: RESPONSES_ITEM.REASONING, id: "rs_1", summary: [] };
    const input = [history, metadata];
    const normalized = normalizeResponsesInput(input);
    expect(normalized).toEqual(input);
    expect(normalized[0]).toBe(history);
    expect(normalized[1]).toBe(metadata);
  });
});
