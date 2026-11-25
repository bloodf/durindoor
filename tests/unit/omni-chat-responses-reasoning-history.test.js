/**
 * OmniRoute #231 — Chat history translated to Responses must stay valid.
 *
 * Upstream merged OmniRoute #231 (head 51a2354197816c859a4f3c67ee043f0f16380403,
 * merge 3f5096c41fdc62a0d57f6741854958edaf38fa86) removed the client-side
 * synthesis of `reasoning` input items in the Chat → Responses request
 * translation: the Responses API only accepts a reasoning item the server
 * issued, and a client-built id made Responses-compatible upstreams answer
 * 400 Invalid Request.
 *
 * The local assembler emitted the same kind of item without any id at all
 * (`{type:"reasoning", summary:[{type:"summary_text", text}]}`). The official
 * Responses schema requires `id` on a reasoning input item
 * (`ResponseReasoningItem.id`), so the local shape is not a valid protocol item
 * either, and it carries no continuity: replayed reasoning keeps its state
 * through the server-issued item's `encrypted_content`, never through a
 * summary string. This fork never fabricates a server-generated id.
 *
 * Offline fixtures only: no provider request, no live account, no browser.
 */

import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// A server-issued reasoning item: OpenAI ids are `rs_<hex>`, the summary is a
// display projection of the reasoning, and `encrypted_content` is the
// continuity token for store=false replay.
const SERVER_REASONING_ITEM = {
  type: "reasoning",
  id: "rs_68c0f1e2a3b4c5d6e7f8091a2b3c4d5e",
  summary: [{ type: "summary_text", text: "plan the change" }],
  encrypted_content: "gAAAAABo-opaque-server-blob",
};

function chatToResponses(body) {
  return translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-6.1-sol", body, true);
}

describe("Chat → Responses reasoning history (OmniRoute #231)", () => {
  it("does not synthesize a reasoning item from Chat reasoning_content", () => {
    const out = chatToResponses({
      messages: [
        { role: "user", content: "u" },
        { role: "assistant", content: "a", reasoning_content: "responses reasoning" },
        { role: "user", content: "u2" },
      ],
    });

    expect(out.input.some((item) => item.type === "reasoning")).toBe(false);
    // The assistant answer itself still reaches the target.
    expect(out.input.find((item) => item.role === "assistant")?.content?.[0]?.text).toBe("a");
    expect(out.input.filter((item) => item.role === "user")).toHaveLength(2);
  });

  it("never invents a reasoning id", () => {
    const out = chatToResponses({
      messages: [
        { role: "user", content: "u" },
        { role: "assistant", content: "a", reasoning_content: "responses reasoning" },
      ],
    });

    const serialized = JSON.stringify(out.input);
    expect(serialized).not.toContain("rs_");
    expect(serialized).not.toContain("reasoning_");
    expect(serialized).not.toContain("summary_text");
  });

  it("keeps the assistant turn, its tool calls and the paired tool output", () => {
    const out = chatToResponses({
      messages: [
        { role: "user", content: "u" },
        {
          role: "assistant",
          content: null,
          reasoning_content: "planning",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: "{\"path\":\"x\"}" } }],
        },
        { role: "tool", tool_call_id: "call_1", content: "file body" },
        { role: "user", content: "u2" },
      ],
    });

    const call = out.input.find((item) => item.type === "function_call");
    const output = out.input.find((item) => item.type === "function_call_output");
    expect(call).toMatchObject({ call_id: "call_1", name: "Read" });
    expect(output).toMatchObject({ call_id: "call_1", output: "file body" });
    expect(out.input.some((item) => item.type === "reasoning")).toBe(false);
  });

  it("keeps native Responses reasoning history untouched", () => {
    const out = chatToResponses({
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "u" }] },
        SERVER_REASONING_ITEM,
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "a" }] },
      ],
    });

    const reasoning = out.input.filter((item) => item.type === "reasoning");
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]).toEqual(SERVER_REASONING_ITEM);
    expect(reasoning[0].id).toBe(SERVER_REASONING_ITEM.id);
    expect(reasoning[0].encrypted_content).toBe(SERVER_REASONING_ITEM.encrypted_content);
  });

  it("still fills an empty Responses input for continuity", () => {
    const out = chatToResponses({ messages: [] });

    expect(out.input).toHaveLength(1);
    expect(out.input[0]).toMatchObject({ type: "message", role: "user" });
  });

  it("leaves reasoning on the routes that carry it", () => {
    const body = {
      messages: [{ role: "user", content: "u" }, { role: "assistant", content: "a", reasoning_content: "r" }],
    };

    // Chat → Claude: reasoning_content becomes a thinking block.
    const claude = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", body, true, {}, "anthropic");
    expect(claude.messages.find((m) => m.role === "assistant").content[0]).toEqual({ type: "thinking", thinking: "r" });

    // Chat → Ollama: reasoning_content becomes message.thinking.
    const ollama = translateRequest(FORMATS.OPENAI, FORMATS.OLLAMA, "m", body, true);
    expect(ollama.messages.find((m) => m.role === "assistant").thinking).toBe("r");

    // Native Responses → Chat: a server reasoning item still reaches the chat
    // history as reasoning_content on the assistant turn it belongs to.
    const chat = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI,
      "m",
      {
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "u" }] },
          SERVER_REASONING_ITEM,
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "a" }] },
        ],
      },
      true,
    );
    expect(chat.messages.find((m) => m.role === "assistant")?.reasoning_content).toBe("plan the change");
  });
});
