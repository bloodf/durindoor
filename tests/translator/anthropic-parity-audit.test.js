// Anthropic API surface parity audit (P-4):
//  - claude→openai request: metadata.user_id → OpenAI `user`
//  - non-stream OpenAI Chat Completion → Anthropic Messages structured blocks
//  - /v1/models envelope switch on anthropic-version header presence
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateOpenAIToClaudeIfNeeded } from "../../open-sse/translator/response/openai-to-claude-json.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { buildModelsResponse } from "../../src/app/api/v1/models/_shared.js";

const C2O = (body, model = "claude-opus-4") =>
  translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, model, body, true, { apiKey: "sk-x" }, "anthropic");

describe("Claude → OpenAI request metadata", () => {
  it("maps metadata.user_id to OpenAI user", () => {
    const out = C2O({
      max_tokens: 16,
      metadata: { user_id: "user_abc-123" },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.user).toBe("user_abc-123");
  });

  it("drops empty/non-string user_id", () => {
    expect(C2O({ max_tokens: 16, metadata: { user_id: "" }, messages: [{ role: "user", content: "hi" }] }).user).toBeUndefined();
    expect(C2O({ max_tokens: 16, metadata: { user_id: 42 }, messages: [{ role: "user", content: "hi" }] }).user).toBeUndefined();
    expect(C2O({ max_tokens: 16, messages: [{ role: "user", content: "hi" }] }).user).toBeUndefined();
  });
});

describe("Non-stream OpenAI → Anthropic projection", () => {
  it("projects text + tool_use blocks, stop_reason and usage", () => {
    const out = translateOpenAIToClaudeIfNeeded(
      {
        id: "chatcmpl-xyz",
        object: "chat.completion",
        model: "gpt-x",
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "Let me check.",
              tool_calls: [
                { id: "call_1", type: "function", function: { name: "Read", arguments: '{"file_path":"/tmp/a.txt"}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      },
      FORMATS.CLAUDE
    );

    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.id).toBe("msg_xyz");
    expect(out.stop_reason).toBe("tool_use");
    expect(out.content).toEqual([
      { type: "text", text: "Let me check." },
      { type: "tool_use", id: "call_1", name: "Read", input: { file_path: "/tmp/a.txt" } },
    ]);
    expect(out.usage).toEqual({ input_tokens: 12, output_tokens: 7 });
  });

  it("maps finish reasons and guarantees a content block", () => {
    const stop = translateOpenAIToClaudeIfNeeded(
      { id: "c1", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "done" } }] },
      FORMATS.CLAUDE
    );
    expect(stop.stop_reason).toBe("end_turn");

    const length = translateOpenAIToClaudeIfNeeded(
      { id: "c2", choices: [{ finish_reason: "length", message: { role: "assistant", content: "…" } }] },
      FORMATS.CLAUDE
    );
    expect(length.stop_reason).toBe("max_tokens");

    const empty = translateOpenAIToClaudeIfNeeded(
      { id: "c3", choices: [{ finish_reason: "stop", message: { role: "assistant" } }] },
      FORMATS.CLAUDE
    );
    expect(empty.content).toEqual([{ type: "text", text: "" }]);
  });

  it("wires through translateNonStreamingResponse (target OPENAI, source CLAUDE)", () => {
    // Regression guard for the branch/order in nonStreamingHandler.js: a Claude
    // client (source CLAUDE) whose upstream speaks OpenAI (target OPENAI) must
    // receive the Anthropic Messages projection, not leaked OpenAI JSON.
    const openaiBody = {
      id: "chatcmpl-wire",
      object: "chat.completion",
      model: "gpt-x",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "ok",
            tool_calls: [{ id: "call_9", type: "function", function: { name: "Bash", arguments: "{\"cmd\":\"ls\"}" } }],
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };
    const out = translateNonStreamingResponse(openaiBody, FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.stop_reason).toBe("tool_use");
    expect(out.content).toEqual([
      { type: "text", text: "ok" },
      { type: "tool_use", id: "call_9", name: "Bash", input: { cmd: "ls" } },
    ]);
    expect(out.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
  });
});

describe("/v1/models Anthropic envelope", () => {
  const data = [
    { id: "anthropic/claude-opus-4", object: "model", owned_by: "anthropic" },
    { id: "openai/gpt-5", object: "model", owned_by: "openai" },
  ];

  function req(headers) {
    return { headers: new Headers(headers) };
  }

  async function json(response) {
    return response.json();
  }

  it("returns OpenAI envelope without the header", async () => {
    const body = await json(buildModelsResponse(req({}), data));
    expect(body.object).toBe("list");
    expect(body.data).toEqual(data);
  });

  it("returns Anthropic envelope when anthropic-version header present (even empty)", async () => {
    for (const value of ["2023-06-01", ""]) {
      const body = await json(buildModelsResponse(req({ "anthropic-version": value }), data));
      expect(body.has_more).toBe(false);
      expect(body.first_id).toBe("claude-anthropic/claude-opus-4");
      expect(body.last_id).toBe("claude-openai/gpt-5");
      expect(body.data).toEqual([
        { type: "model", id: "claude-anthropic/claude-opus-4", display_name: "anthropic/claude-opus-4", created_at: "1970-01-01T00:00:00Z" },
        { type: "model", id: "claude-openai/gpt-5", display_name: "openai/gpt-5", created_at: "1970-01-01T00:00:00Z" },
      ]);
      // No OpenAI leakage; created_at always a string (epoch when unknown).
      for (const entry of body.data) {
        expect(entry).not.toHaveProperty("object");
        expect(entry).not.toHaveProperty("owned_by");
        expect(typeof entry.created_at).toBe("string");
      }
    }
  });

  it("null first/last id on empty list", async () => {
    const body = await json(buildModelsResponse(req({ "anthropic-version": "2023-06-01" }), []));
    expect(body).toEqual({ data: [], has_more: false, first_id: null, last_id: null });
  });

  it("falls back display_name to name then id", async () => {
    const body = await json(
      buildModelsResponse(req({ "anthropic-version": "2023-06-01" }), [
        { id: "p/with-name", name: "Pretty Name" },
        { id: "p/only-id" },
      ])
    );
    expect(body.data[0].display_name).toBe("Pretty Name");
    expect(body.data[1].display_name).toBe("p/only-id");
  });

  it("Anthropic header takes precedence over Codex UA", async () => {
    const body = await json(
      buildModelsResponse(req({ "anthropic-version": "2023-06-01", "user-agent": "codex_cli_rs" }), data)
    );
    expect(body.data[0]).toHaveProperty("type", "model");
    expect(body).not.toHaveProperty("models");
  });
});
