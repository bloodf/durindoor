// #1998 — Headroom compression treated a Codex (openai-responses) body.input
// array as OpenAI messages: it sent Responses items to /v1/compress and then
// assigned the returned OpenAI messages back to body.input, violating the
// Responses format contract. body.input must stay Responses-shaped.
import { describe, it, expect, vi, afterEach } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";

describe("compressWithHeadroom openai-responses format (#1998)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps body.input in Responses format after compressing an openai-responses request", async () => {
    // Headroom always returns compressed OpenAI-style messages.
    global.fetch = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          messages: request.messages.map((message) => ({ ...message, content: "compressed text" })),
          tokens_before: 100,
          tokens_after: 90,
          tokens_saved: 10,
        }),
      };
    });

    const body = {
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "a long original message ".repeat(20) }],
        },
      ],
    };

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: "gpt-5",
      format: "openai-responses",
    });

    expect(data).not.toBeNull();
    // body.input must remain Responses items (type:"message" + content array),
    // NOT the raw OpenAI messages ({ role, content: "<string>" }) the bug produced.
    expect(Array.isArray(body.input)).toBe(true);
    expect(body.input[0]).toMatchObject({ type: "message", role: "user" });
    expect(Array.isArray(body.input[0].content)).toBe(true);
    expect(typeof body.input[0].content).not.toBe("string");
  });

  it.each([
    [
      "reorders messages",
      [
        { role: "assistant", content: "compressed assistant" },
        { role: "user", content: "compressed user" },
      ],
      "proxy response did not preserve message count or order",
    ],
    [
      "alters tool identity",
      [
        {
          role: "user",
          content: "compressed user",
          tool_calls: [{ id: "injected", type: "function", function: { name: "read", arguments: "{}" } }],
        },
        { role: "assistant", content: "compressed assistant" },
      ],
      "proxy response did not preserve tool pairing identity",
    ],
  ])("fails open when Headroom %s", async (_case, messages, reason) => {
    global.fetch = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body);
      const orderKey = Object.keys(request.messages[0]).find(
        (key) => !["role", "content", "tool_calls", "tool_call_id"].includes(key),
      );
      return {
        ok: true,
        json: async () => ({
          messages: messages.map((message, index) => ({
            ...message,
            ...(orderKey ? { [orderKey]: request.messages[index][orderKey] } : {}),
          })),
          tokens_before: 100,
          tokens_after: 20,
          tokens_saved: 80,
        }),
      };
    });
    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "first ".repeat(80) }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "second ".repeat(80) }] },
      ],
    };
    const original = structuredClone(body);
    const diagnostics = {};

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: "gpt-5",
      format: "openai-responses",
      diagnostics,
    });

    expect(data).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe(reason);
    expect(diagnostics.reason.length).toBeLessThanOrEqual(200);
  });

  it("fails open when adjacent same-role Responses messages are swapped", async () => {
    let orderKey;
    global.fetch = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body);
      orderKey = Object.keys(request.messages[0]).find((key) => !["role", "content"].includes(key));
      return {
        ok: true,
        json: async () => ({
          messages: [...request.messages].reverse().map((message, index) => ({
            ...message,
            content: `compressed ${index}`,
          })),
          tokens_before: 100,
          tokens_after: 20,
          tokens_saved: 80,
        }),
      };
    });
    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "first ".repeat(80) }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "second ".repeat(80) }] },
      ],
    };
    const original = structuredClone(body);
    const diagnostics = {};

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: "gpt-5",
      format: "openai-responses",
      diagnostics,
    });

    expect(orderKey).toBeDefined();
    expect(data).toBeNull();
    expect(body).toEqual(original);
    expect(JSON.stringify(body)).not.toContain(orderKey);
    expect(diagnostics.reason).toBe("proxy response did not preserve message count or order");
    expect(diagnostics.reason.length).toBeLessThanOrEqual(200);
  });

  it("retains adjacent same-role order without leaking synthetic metadata", async () => {
    let orderKey;
    global.fetch = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body);
      orderKey = Object.keys(request.messages[0]).find((key) => !["role", "content"].includes(key));
      expect(request.messages.map((message) => message[orderKey])).toEqual([0, 1]);
      return {
        ok: true,
        json: async () => ({
          messages: request.messages.map((message, index) => ({
            ...message,
            content: `compressed ${index}`,
          })),
          tokens_before: 100,
          tokens_after: 20,
          tokens_saved: 80,
        }),
      };
    });
    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "first ".repeat(80) }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "second ".repeat(80) }] },
      ],
    };

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: "gpt-5",
      format: "openai-responses",
    });

    expect(orderKey).toBeDefined();
    expect(body.input.map((message) => message.content[0].text)).toEqual(["compressed 0", "compressed 1"]);
    expect(JSON.stringify(body)).not.toContain(orderKey);
    expect(JSON.stringify(data)).not.toContain(orderKey);
  });

  it("diagnoses a Responses request that cannot translate to messages", async () => {
    global.fetch = vi.fn();
    const body = { input: { unexpected: true } };
    const diagnostics = {};

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: "gpt-5",
      format: "openai-responses",
      diagnostics,
    });

    expect(data).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(body).toEqual({ input: { unexpected: true } });
    expect(diagnostics.reason).toBe("openai-responses request did not translate to messages[]");
  });

  it("skips Responses tool/reasoning history instead of collapsing it into a message (#2132)", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [{ role: "user", content: "compressed tool history" }],
        tokens_saved: 10,
      }),
    }));

    const input = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "investigate bug" }],
      },
      {
        type: "function_call",
        call_id: "call_apply_patch_123",
        name: "apply_patch",
        arguments: "*** Begin Patch\n*** End Patch",
      },
      {
        type: "function_call_output",
        call_id: "call_apply_patch_123",
        output: "ok",
      },
      {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "Need a plan" }],
      },
    ];
    const body = {
      input: structuredClone(input),
      tools: [
        {
          type: "custom",
          name: "apply_patch",
          format: { type: "grammar", syntax: "lark", definition: "start: /.+/" },
        },
      ],
    };
    const diagnostics = {};

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: "gpt-5",
      format: "openai-responses",
      diagnostics,
    });

    expect(data).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(body.input).toEqual(input);
    expect(diagnostics.reason).toBe("skipped: openai-responses tool/reasoning input is not safe to compress");
  });
});
