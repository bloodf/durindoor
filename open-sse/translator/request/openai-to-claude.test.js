import assert from "node:assert/strict";
import { test } from "node:test";
import { openaiToClaudeRequest } from "./openai-to-claude.js";
import { claudeToOpenAIRequest } from "./claude-to-openai.js";
import { prepareClaudeRequest } from "../formats/claude.js";

test("maps OpenAI json_schema to Claude output_config without losing effort", () => {
  const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
  const out = openaiToClaudeRequest("claude-sonnet-5", {
    messages: [{ role: "user", content: "answer" }],
    output_config: { effort: "high" },
    response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema } }
  }, false);

  assert.deepEqual(out.output_config, {
    effort: "high",
    format: { type: "json_schema", schema }
  });
  assert.equal(out.system.some((block) => block.text?.includes("strictly follows")), false);
});

test("keeps json_object as instruction instead of claiming native schema enforcement", () => {
  const out = openaiToClaudeRequest("claude-sonnet-5", {
    messages: [{ role: "user", content: "answer" }],
    response_format: { type: "json_object" }
  }, false);

  assert.equal(out.output_config, undefined);
  assert.match(out.system.at(-1).text, /valid JSON/);
});

test("bridges PDF data URLs and URLs but never OpenAI file IDs", () => {
  const out = openaiToClaudeRequest("claude-sonnet-5", {
    messages: [{ role: "user", content: [
      { type: "file", file: { file_data: "data:application/pdf;base64,cGRm" } },
      { type: "file", file: { file_url: "https://example.test/file.pdf" } },
      { type: "file", file: { file_id: "file-openai-local" } },
      { type: "document", source: { type: "file", file_id: "file_native_anthropic" } }
    ] }]
  }, false);

  assert.deepEqual(out.messages[0].content, [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "cGRm" } },
    { type: "document", source: { type: "url", url: "https://example.test/file.pdf" } },
    { type: "document", source: { type: "file", file_id: "file_native_anthropic" } }
  ]);
});

test("preserves native server and client tool metadata on Anthropic routes", () => {
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 3 },
    { type: "computer_20250124", name: "computer", display_width_px: 1280, display_height_px: 720, display_number: 1 }
  ];
  const body = { model: "claude-sonnet-5", max_tokens: 128, messages: [{ role: "user", content: "hi" }], tools };
  prepareClaudeRequest(body, "anthropic-compatible-example");

  assert.deepEqual(body.tools.map(({ cache_control, ...tool }) => tool), tools);
});

test("restores Claude-native blocks, metadata, and server tools across an in-process pivot", () => {
  const nativeTool = { type: "web_search_20250305", name: "web_search", max_uses: 2 };
  const nativeContent = [
    { type: "document", source: { type: "url", url: "https://example.test/spec.pdf" }, citations: { enabled: true } },
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "Claude" } },
    { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://example.test" }] }
  ];
  const source = {
    max_tokens: 128,
    messages: [{ role: "user", content: nativeContent }],
    tools: [nativeTool],
    output_config: { effort: "high" },
    context_management: { edits: [{ type: "clear_tool_uses_20250919" }] },
  };
  const pivot = claudeToOpenAIRequest("claude-sonnet-5", source, false);
  const out = openaiToClaudeRequest("claude-sonnet-5", pivot, false);

  assert.deepEqual(out.messages, [{ role: "user", content: nativeContent }]);
  assert.deepEqual(out.tools.map(({ cache_control, ...tool }) => tool), [nativeTool]);
  assert.deepEqual(out.output_config, { effort: "high" });
  assert.deepEqual(out.context_management, source.context_management);
});
