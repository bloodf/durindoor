import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import {
  anchorClaudeCache,
  fixToolUseOrdering,
  hasValidContent,
  normalizeClaudePassthrough,
  prepareClaudeRequest,
} from "../../open-sse/translator/formats/claude.js";
import { salvageOrphanedToolResults } from "../../open-sse/translator/concerns/toolCall.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const preservePrefill = { rawHeaders: { "x-9router-assistant-prefill": "preserve" } };

function normalize(messages) {
  return normalizeClaudePassthrough({ messages: structuredClone(messages) }, "", "claude", null, preservePrefill);
}

describe("normalizeClaudePassthrough foreign server tools", () => {
  it("removes foreign server tools without touching Anthropic server tools or ordinary calls", () => {
    const validServer = { type: "server_tool_use", id: "srvtoolu_web_1", name: "web_search", input: {} };
    const ordinary = { type: "tool_use", id: "call_client_1", name: "read", input: {} };
    const out = normalize([{
      role: "assistant",
      content: [
        { type: "server_tool_use", id: "call_foreign_1", name: "analyze_image", input: {} },
        validServer,
        ordinary,
      ],
    }]);

    expect(out.messages[0].content).toEqual([validServer, ordinary]);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["numeric", 42],
    ["object", { provider: "foreign" }],
    ["malformed", "srvtoolu_bad-id"],
  ])("rejects a %s server tool id safely", (_label, id) => {
    const block = { type: "server_tool_use", name: "foreign", input: {} };
    if (id !== undefined) block.id = id;

    expect(() => normalize([{ role: "assistant", content: [block] }])).not.toThrow();
    expect(normalize([{ role: "assistant", content: [block] }]).messages).toEqual([]);
  });

  it("demotes a paired tool_result to ordinary text without losing string content", () => {
    const out = normalize([
      { role: "assistant", content: [{ type: "server_tool_use", id: "call_foreign_2", name: "web_search", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_foreign_2", content: "verbatim result" }] },
    ]);

    expect(out.messages).toEqual([{
      role: "user",
      content: [{ type: "text", text: "[Unpaired tool result call_foreign_2]\nverbatim result" }],
    }]);
    expect(JSON.stringify(out)).not.toContain("tool_use_id");
  });

  it("demotes web_search_tool_result content in source order", () => {
    const content = [
      { type: "web_search_result", title: "First", url: "https://first.test" },
      { type: "text", text: "middle" },
      { type: "web_search_result", title: "Last", metadata: { rank: 3 } },
    ];
    const out = normalize([
      { role: "assistant", content: [{ type: "server_tool_use", id: "call_foreign_3", name: "web_search", input: {} }] },
      { role: "user", content: [{ type: "web_search_tool_result", tool_use_id: "call_foreign_3", content }] },
    ]);
    const text = out.messages[0].content[0].text;

    expect(out.messages[0].content[0].type).toBe("text");
    expect(text).toContain(JSON.stringify(content));
    expect(text.indexOf("First")).toBeLessThan(text.indexOf("middle"));
    expect(text.indexOf("middle")).toBeLessThan(text.indexOf("Last"));
    expect(JSON.stringify(out)).not.toContain("web_search_tool_result");
  });

  it("preserves structured image-analysis content without object coercion or child loss", () => {
    const content = [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAEC" } },
      { type: "text", text: "a cat on a mat" },
      { type: "metadata", value: { confidence: 0.97 } },
    ];
    const out = normalize([
      { role: "assistant", content: [{ type: "server_tool_use", id: "call_image_1", name: "analyze_image", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_image_1", content }] },
    ]);
    const text = out.messages[0].content[0].text;

    expect(text).toContain(JSON.stringify(content));
    expect(text).not.toContain("[object Object]");
    expect(text).toContain("AAEC");
    expect(text).toContain("a cat on a mat");
    expect(text).toContain("confidence");
  });

  it("retains a complete valid pair while demoting only the foreign result", () => {
    const out = normalize([
      {
        role: "assistant",
        content: [
          { type: "server_tool_use", id: "srvtoolu_valid_2", name: "web_search", input: {} },
          { type: "server_tool_use", id: "call_foreign_4", name: "web_search", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "web_search_tool_result", tool_use_id: "srvtoolu_valid_2", content: [{ type: "text", text: "native" }] },
          { type: "tool_result", tool_use_id: "call_foreign_4", content: "foreign", cache_control: { type: "ephemeral" } },
        ],
      },
    ]);

    expect(out.messages[0].content).toEqual([
      { type: "server_tool_use", id: "srvtoolu_valid_2", name: "web_search", input: {} },
    ]);
    expect(out.messages[1].content[0]).toEqual({
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_valid_2",
      content: [{ type: "text", text: "native" }],
    });
    expect(out.messages[1].content[1]).toEqual({
      type: "text",
      text: "[Unpaired tool result call_foreign_4]\nforeign",
      cache_control: { type: "ephemeral" },
    });
  });

  it("drops only messages emptied by foreign filtering and does not add placeholders", () => {
    const out = normalize([
      { role: "user", content: [{ type: "text", text: "" }] },
      { role: "assistant", content: [{ type: "server_tool_use", id: "call_only", name: "foreign", input: {} }] },
      { role: "user", content: "keep" },
    ]);

    expect(out.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "" }] },
      { role: "user", content: "keep" },
    ]);
  });

  it("keeps valid server-tool-only pairs through content filtering and request preparation", () => {
    const messages = [
      { role: "assistant", content: [{ type: "server_tool_use", id: "srvtoolu_valid_3", name: "web_search", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "srvtoolu_valid_3", content: "answer" }] },
      { role: "assistant", content: [{ type: "server_tool_use", id: "srvtoolu_valid_4", name: "web_search", input: {} }] },
      { role: "user", content: [{ type: "web_search_tool_result", tool_use_id: "srvtoolu_valid_4", content: [{ type: "text", text: "search answer" }] }] },
    ];

    expect(messages.every(hasValidContent)).toBe(true);
    const out = prepareClaudeRequest({ model: "claude-sonnet-4-6", messages: structuredClone(messages) }, "claude");
    expect(out.messages[0].content[0]).toMatchObject({ type: "server_tool_use", id: "srvtoolu_valid_3" });
    expect(out.messages[1].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "srvtoolu_valid_3" });
    expect(out.messages[2].content[0]).toMatchObject({ type: "server_tool_use", id: "srvtoolu_valid_4" });
    expect(out.messages[3].content[0]).toMatchObject({ type: "web_search_tool_result", tool_use_id: "srvtoolu_valid_4" });
  });
});

describe("foreign server-tool regression boundaries", () => {
  it("demotes an orphan tool_result after a non-tool assistant turn", () => {
    const out = fixToolUseOrdering([
      { role: "user", content: [{ type: "text", text: "question" }] },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "orphan", content: "stale but load-bearing" }] },
    ]);

    expect(out.at(-1).content).toEqual([{
      type: "text",
      text: "[Unpaired tool result orphan]\nstale but load-bearing",
    }]);
  });

  it("does not synthesize a result when a user turn has no tool_result", () => {
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "read", input: {} }] },
      { role: "user", content: [{ type: "text", text: "actually never mind" }] },
    ];
    const snapshot = structuredClone(messages);

    expect(fixToolUseOrdering(messages)).toEqual(snapshot);
  });

  it("leaves orphaned structured web-search results untouched by generic salvage", () => {
    const body = {
      messages: [{
        role: "assistant",
        content: [{
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_gone",
          content: [{
            type: "web_search_result",
            title: "Result",
            url: "https://result.test",
            encrypted_content: "opaque",
          }],
        }],
      }],
    };
    const snapshot = structuredClone(body);

    expect(salvageOrphanedToolResults(body)).toEqual(snapshot);
  });

  it("admits only anchored server-tool IDs during request preparation", () => {
    const prepare = (id) => prepareClaudeRequest({
      messages: [
        { role: "assistant", content: [{ type: "server_tool_use", id, name: "web_search", input: {} }] },
        { role: "user", content: [{ type: "text", text: "next" }] },
      ],
    }, "claude");

    expect(prepare("call_foreign").messages).toEqual([
      { role: "user", content: [{ type: "text", text: "next" }] },
    ]);
    expect(prepare("srvtoolu_valid_5").messages[0].content[0]).toMatchObject({
      type: "server_tool_use",
      id: "srvtoolu_valid_5",
    });
  });

  it("keeps adjacent-role folding unchanged for regular history", () => {
    expect(fixToolUseOrdering([
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
    ])).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
    ]);
  });

  it("keeps prefill policy and cache anchoring unchanged for regular history", () => {
    const body = prepareClaudeRequest({
      messages: [
        { role: "user", content: [{ type: "text", text: "Start" }] },
        { role: "assistant", content: [{ type: "text", text: "Partial answer" }] },
      ],
    }, "claude");

    expect(body.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(body.messages[1].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[2].content[0]).toEqual({
      type: "text",
      text: "Continue from the assistant response above without repeating it.",
    });

    anchorClaudeCache(body);
    expect(body.messages[1].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[2].content[0].cache_control).toBeUndefined();
  });

  it("keeps regular client tool history unchanged across translated Claude/OpenAI routes", () => {
    const claude = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_regular", name: "read", input: { path: "a" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_regular", content: "contents" }] },
      ],
    };
    const openAI = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "model", structuredClone(claude));

    expect(openAI.messages[0].tool_calls[0]).toMatchObject({
      id: "call_regular",
      function: { name: "read", arguments: JSON.stringify({ path: "a" }) },
    });
    expect(openAI.messages[1]).toMatchObject({ role: "tool", tool_call_id: "call_regular", content: "contents" });

    const roundTrip = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "model", structuredClone(openAI));
    expect(roundTrip.messages[0].content[0]).toMatchObject({ type: "tool_use", id: "call_regular", name: "read", input: { path: "a" } });
    expect(roundTrip.messages[1].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "call_regular", content: "contents" });
  });
});
