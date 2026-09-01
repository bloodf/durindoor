import { describe, expect, it, vi } from "vitest";
import {
  decodeClaudeCodeModelId,
  projectClaudeCodeModel,
} from "../../src/app/api/v1/models/_claudeCompat.js";
import {
  applyClaudeResponseModelEcho,
  createClaudeModelEchoStream,
  resolveClaudeEchoModel,
} from "../../open-sse/services/responseModelEcho.js";

describe("Claude Code model compatibility", () => {
  it("projects gateway routes and advertises only proven 1M windows", () => {
    expect(projectClaudeCodeModel({ id: "openai/gpt-5", owned_by: "openai" }, () => ({ known: true, contextWindow: 400_000 }))).toBe("claude-openai/gpt-5");
    expect(projectClaudeCodeModel({ id: "openai/gpt-5.5", owned_by: "openai" }, () => ({ known: true, contextWindow: 1_050_000 }))).toBe("claude-openai/gpt-5.5[1m]");
    expect(projectClaudeCodeModel({ id: "custom/future", owned_by: "custom" }, () => ({ known: false, contextWindow: 2_000_000 }))).toBe("claude-custom/future");
  });

  it("preserves official bare Claude IDs and avoids duplicate markers", () => {
    expect(projectClaudeCodeModel({ id: "claude-sonnet-future" }, () => ({ known: true, contextWindow: 2_000_000 }))).toBe("claude-sonnet-future");
    expect(projectClaudeCodeModel({ id: "kimi/k3[1m]" }, () => ({ known: true, contextWindow: 1_048_576 }))).toBe("claude-kimi/k3[1m]");
  });

  it("decodes only projected routes and recognized trailing markers", async () => {
    const routable = vi.fn(async (id, { exact = false } = {}) => {
      if (exact) return id === "literal/model[1m]";
      return ["openai/gpt-5.5", "coding-default", "claude-opus-5"].includes(id);
    });

    await expect(decodeClaudeCodeModelId("claude-openai/gpt-5.5[1m]", routable)).resolves.toBe("openai/gpt-5.5");
    await expect(decodeClaudeCodeModelId("claude-coding-default", routable)).resolves.toBe("coding-default");
    await expect(decodeClaudeCodeModelId("claude-opus-5[1m]", routable)).resolves.toBe("claude-opus-5");
    await expect(decodeClaudeCodeModelId("literal/model[1m]", routable)).resolves.toBe("literal/model[1m]");
    await expect(decodeClaudeCodeModelId("claude-sonnet-unknown-xyz", routable)).resolves.toBe("claude-sonnet-unknown-xyz");
    await expect(decodeClaudeCodeModelId("openai/gpt[1m]extra", routable)).resolves.toBe("openai/gpt[1m]extra");

    const exactClaudeAlias = vi.fn(async (id) => ["claude-fast", "fast"].includes(id));
    await expect(decodeClaudeCodeModelId("claude-fast", exactClaudeAlias)).resolves.toBe("claude-fast");
  });
});

describe("Claude response model identity", () => {
  const original = "claude-coding-default[1m]";
  const messageStart = (eol = "\n") =>
    `event: message_start${eol}data: {"type":"message_start","message":{"id":"msg_1","model":"physical/provider"}}${eol}${eol}`;

  it("uses the immutable original model rather than a normalized request body", () => {
    expect(resolveClaudeEchoModel({ originalModel: original, body: { model: "coding-default" } })).toBe(original);
    expect(resolveClaudeEchoModel({ body: { model: "coding-default" } })).toBe(null);
  });

  it("rewrites only Anthropic message_start model across split multibyte frames", async () => {
    const text = `event: ping\ndata: {"type":"ping"}\n\n${messageStart("\r\n")}event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hé"}}\n\n`;
    const bytes = new TextEncoder().encode(text);
    const split = bytes.indexOf(0xc3) + 1;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const out = await new Response(stream.pipeThrough(createClaudeModelEchoStream(original))).text();
    expect(out).toContain(`"model":"${original}"`);
    expect(out).toContain('data: {"type":"ping"}');
    expect(out).toContain('"text":"hé"');
  });

  it("preserves malformed and non-message-start frames and skips missing identity", async () => {
    const malformed = "event: message_start\ndata: {not-json}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"model\":\"physical\"}\n\n";
    const result = { success: true, response: new Response(malformed, { headers: { "content-type": "text/event-stream", "x-test": "kept" } }) };
    const untouched = await applyClaudeResponseModelEcho(result, null);
    expect(untouched).toBe(result);
    const out = await applyClaudeResponseModelEcho(result, original);
    expect(await out.response.text()).toBe(malformed);
    expect(out.response.headers.get("x-test")).toBe("kept");
  });

  it("leaves non-Claude response content types untouched", () => {
    const result = {
      success: true,
      response: new Response('{"model":"physical"}', { headers: { "content-type": "application/json" } }),
    };
    expect(applyClaudeResponseModelEcho(result, original)).toBe(result);
  });

  it("rewrites message_start produced from a Gemini-family route", async () => {
    const result = {
      success: true,
      response: new Response(messageStart(), { headers: { "content-type": "text/event-stream" } }),
    };
    const out = applyClaudeResponseModelEcho(result, "claude-antigravity/gemini-3.1-pro");
    expect(await out.response.text()).toContain('"model":"claude-antigravity/gemini-3.1-pro"');
  });
});
