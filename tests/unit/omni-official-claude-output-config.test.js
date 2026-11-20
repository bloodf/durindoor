import "../translator/registerAll.js";
import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import anthropic from "../../open-sse/providers/registry/anthropic.js";

const model = "claude-sonnet-4-6";
const format = { type: "json_schema", schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } };
const body = () => ({ model, max_tokens: 64, stream: false, messages: [{ role: "user", content: "Name this session" }], output_config: { effort: "high", format: structuredClone(format) } });
const credentials = { apiKey: "fixture-key" };

describe("official Anthropic structured output", () => {
  it("retains native format through Claude Code passthrough normalization and executor", () => {
    expect(anthropic.category).toBe("apikey");
    expect(anthropic.transport.baseUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(anthropic.transport.format).toBe(FORMATS.CLAUDE);
    const request = body();
    applyThinking(FORMATS.CLAUDE, model, request, "anthropic");
    normalizeClaudePassthrough(request, model, "anthropic", null, { foldSystemTurns: true });
    const wire = new DefaultExecutor("anthropic").transformRequest(model, request, false, credentials);
    expect(wire.output_config).toEqual({ effort: "high", format });
    expect(wire.stream).toBe(false);
  });

  it("retains native and translated schema on the regular request path", () => {
    const native = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, model, body(), false, credentials, "anthropic");
    expect(native.output_config).toEqual({ effort: "high", format });
    const openai = { model, max_tokens: 64, messages: [{ role: "user", content: "Name this session" }], response_format: { type: "json_schema", json_schema: { name: "title", schema: format.schema } } };
    const translated = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, model, openai, false, credentials, "anthropic");
    expect(translated.output_config.format).toEqual(format);
  });

  it("preserves existing compatible-provider behavior", () => {
    const compat = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, model, body(), false, credentials, "anthropic-compatible-fixture");
    expect(compat.output_config).toEqual({ effort: "high", format });
    const older = { ...body(), model: "MiniMax-M2.7" };
    const minimax = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, older.model, older, false, credentials, "minimax");
    expect(minimax.output_config).toBeUndefined();
  });
});
