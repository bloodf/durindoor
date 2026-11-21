import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import {
  fixMissingToolResponses,
  repairDisplacedToolResults,
} from "../../open-sse/translator/concerns/toolCall.js";

// Offline: source pinned at cheaper-inference/OmniRoute#18709 (d9a984797f55).
const asst = (ids) => ({
  role: "assistant",
  content: null,
  tool_calls: ids.map((id) => ({ id, type: "function", function: { name: "shell", arguments: "{}" } })),
});
const tool = (id, content = `result ${id}`) => ({ role: "tool", tool_call_id: id, content });
const user = (text) => ({ role: "user", content: text });
const shape = (messages) =>
  messages.map((m) => (m.role === "tool" ? `tool:${m.tool_call_id}` : m.role === "assistant" ? "assistant" : `user:${typeof m.content === "string" ? m.content : "blocks"}`));
const repair = (messages) => fixMissingToolResponses(repairDisplacedToolResults({ messages: structuredClone(messages) })).messages;

const claudeAsst = (ids) => ({ role: "assistant", content: ids.map((id) => ({ type: "tool_use", id, name: "shell", input: {} })) });
const carrier = (id, content = `r${id}`, extra = {}) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content, ...extra }] });

describe("displaced tool results", () => {
  it("hoists a displaced real result into its turn without a placeholder", () => {
    const out = repair([user("go"), asst(["c1", "c2"]), tool("c1"), user("notif"), tool("c2"), user("next")]);
    expect(shape(out)).toEqual(["user:go", "assistant", "tool:c1", "tool:c2", "user:notif", "user:next"]);
    expect(out[3].content).toBe("result c2");
  });

  it("keeps stable order for several displaced results and exact ids", () => {
    const out = repair([user("go"), asst(["c1", "c2", "c3"]), tool("c1"), user("a"), tool("c3"), user("b"), tool("c2")]);
    expect(shape(out)).toEqual(["user:go", "assistant", "tool:c1", "tool:c3", "tool:c2", "user:a", "user:b"]);
  });

  it("never crosses the next assistant and invents nothing itself", () => {
    const messages = [user("go"), asst(["c1"]), user("steer"), { role: "assistant", content: "hi" }, tool("c1")];
    const repaired = repairDisplacedToolResults({ messages: structuredClone(messages) }).messages;
    expect(repaired).toEqual(messages);
  });

  it("leaves duplicate results and paired histories untouched", () => {
    const paired = [user("go"), asst(["c1"]), tool("c1"), user("next")];
    expect(repairDisplacedToolResults({ messages: structuredClone(paired) }).messages).toEqual(paired);
    const dup = [user("go"), asst(["c1"]), tool("c1", "first"), user("n"), tool("c1", "second")];
    expect(repairDisplacedToolResults({ messages: structuredClone(dup) }).messages).toEqual(dup);
  });

  it("does not hoist a result belonging to another turn or an unknown id", () => {
    const messages = [user("go"), asst(["c1"]), tool("c1"), user("n"), tool("unknown")];
    expect(repairDisplacedToolResults({ messages: structuredClone(messages) }).messages).toEqual(messages);
  });

  it("still closes genuinely unanswered calls with the existing placeholder", () => {
    const out = repair([user("go"), asst(["c1", "c2"]), tool("c1"), user("next")]);
    expect(shape(out)).toEqual(["user:go", "assistant", "tool:c1", "tool:c2", "user:next"]);
    expect(out[3].content).toBe("[No response received]");
  });

  it("does not mutate the caller's messages", () => {
    const messages = [user("go"), asst(["c1", "c2"]), tool("c1"), user("n"), tool("c2")];
    const snapshot = structuredClone(messages);
    repairDisplacedToolResults({ messages });
    expect(messages).toEqual(snapshot);
  });

  it("splits a mixed Claude carrier, preserving blocks, flags and non-text parts", () => {
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } };
    const mixed = {
      role: "user",
      content: [
        { type: "text", text: "late note" },
        { type: "tool_result", tool_use_id: "c2", content: [{ type: "text", text: "r" }, image], is_error: true, cache_control: { type: "ephemeral" } },
      ],
    };
    const out = repair([user("go"), claudeAsst(["c1", "c2"]), carrier("c1"), user("notif"), mixed]);
    expect(out).toHaveLength(6);
    expect(out[3]).toEqual({ role: "user", content: [mixed.content[1]] });
    expect(out[4]).toEqual(user("notif"));
    expect(out[5]).toEqual({ role: "user", content: [mixed.content[0]] });
  });

  it("repairs Claude-format carriers", () => {
    const out = repair([user("go"), claudeAsst(["c1", "c2"]), carrier("c1"), user("notif"), carrier("c2"), user("next")]);
    expect(out.slice(2, 4).map((m) => m.content[0].tool_use_id)).toEqual(["c1", "c2"]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user", "user", "user", "user"]);
  });
});

describe("displaced tool results through translateRequest", () => {
  it("claude to openai keeps the real result and adds no duplicate placeholder", () => {
    const out = translateRequest("claude", "openai", "gpt-x", {
      model: "gpt-x", max_tokens: 10,
      messages: [user("go"), claudeAsst(["c1", "c2"]), carrier("c1"), user("notif"), carrier("c2"), user("next")],
    }, true, null, "openai");
    const tools = out.messages.filter((m) => m.role === "tool");
    expect(tools.map((m) => [m.tool_call_id, m.content])).toEqual([["c1", "rc1"], ["c2", "rc2"]]);
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool", "user", "user"]);
  });

  it("responses to chat places the displaced output inside the result run", () => {
    const text = (t) => ({ type: "message", role: "user", content: [{ type: "input_text", text: t }] });
    const call = (id) => ({ type: "function_call", call_id: id, name: "shell", arguments: "{}" });
    const out = translateRequest("openai-responses", "openai", "gpt-x", {
      model: "gpt-x",
      input: [text("go"), call("c1"), call("c2"), { type: "function_call_output", call_id: "c1", output: "r1" }, text("notif"), { type: "function_call_output", call_id: "c2", output: "r2" }],
    }, true, null, "openai");
    expect(out.messages.map((m) => (m.role === "tool" ? `tool:${m.tool_call_id}:${m.content}` : m.role))).toEqual(["user", "assistant", "tool:c1:r1", "tool:c2:r2", "user"]);
  });

  it("openai to openai hoists without inventing results and keeps ids", () => {
    const out = translateRequest("openai", "openai", "gpt-x", {
      model: "gpt-x", messages: [user("go"), asst(["c1", "c2"]), tool("c1"), user("notif"), tool("c2"), user("next")],
    }, true, null, "openai");
    expect(shape(out.messages)).toEqual(["user:go", "assistant", "tool:c1", "tool:c2", "user:notif", "user:next"]);
    expect(out.messages.filter((m) => m.role === "tool").map((m) => m.content)).toEqual(["result c1", "result c2"]);
  });

  it("openai to claude keeps both results in the single user turn", () => {
    const out = translateRequest("openai", "claude", "claude-sonnet-4-6", {
      model: "claude-sonnet-4-6", max_tokens: 10,
      messages: [user("go"), asst(["c1", "c2"]), tool("c1"), user("notif"), tool("c2"), user("next")],
    }, true, null, "anthropic");
    const blocks = out.messages.at(-1).content;
    expect(blocks.filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, b.content])).toEqual([["c1", "result c1"], ["c2", "result c2"]]);
    expect(blocks[0].type).toBe("tool_result");
    expect(blocks[1].type).toBe("tool_result");
  });
});
