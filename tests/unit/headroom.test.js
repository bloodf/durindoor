import { describe, it, expect, vi, afterEach } from "vitest";
import { compressWithHeadroom, formatHeadroomLog } from "../../open-sse/rtk/headroom.js";
import { MAX_COMPRESS_BODY_BYTES } from "../../open-sse/config/runtimeConfig.js";

afterEach(() => {
  vi.restoreAllMocks();
});
const VERBOSE = "verbose original context ".repeat(40);

describe("compressWithHeadroom", () => {
  it("no-ops when disabled", async () => {
    global.fetch = vi.fn();
    const body = { messages: [{ role: "user", content: "hello" }] };

    const stats = await compressWithHeadroom(body, { enabled: false, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(body.messages[0].content).toBe("hello");
  });

  it("compresses messages in-place", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_before: 100,
      tokens_after: 20,
      tokens_saved: 80,
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: VERBOSE }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://headroom:8787/", model: "gpt-4o" });

    expect(body.messages[0].content).toBe("short");
    expect(stats.tokens_saved).toBe(80);
    expect(global.fetch).toHaveBeenCalledWith("http://headroom:8787/v1/compress", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
      model: "gpt-4o",
      messages: [{ role: "user", content: VERBOSE }],
    });
  });

  it("skips oversize bodies while normal bodies still compress", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_saved: 80,
    }), { status: 200 }));
    const oversizeContent = "x".repeat(MAX_COMPRESS_BODY_BYTES);
    const oversizeBody = { messages: [{ role: "user", content: oversizeContent }] };
    const normalBody = { messages: [{ role: "user", content: VERBOSE }] };
    const diagnostics = {};

    const skipped = await compressWithHeadroom(oversizeBody, {
      enabled: true,
      url: "http://headroom:8787",
      diagnostics,
    });
    const compressed = await compressWithHeadroom(normalBody, {
      enabled: true,
      url: "http://headroom:8787",
    });

    expect(skipped).toBeNull();
    expect(oversizeBody.messages[0].content).toBe(oversizeContent);
    expect(diagnostics.reason).toMatch(/^skipped: payload too large/);
    expect(compressed.tokens_saved).toBe(80);
    expect(normalBody.messages[0].content).toBe("short");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("compresses responses input in-place", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
    }), { status: 200 }));
    const body = { input: [{ role: "user", content: VERBOSE }] };

    await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(body.input[0].content).toBe("short");
  });

  it("compresses Kiro conversationState history/currentMessage in-place", async () => {
    let requestPayload;
    global.fetch = vi.fn(async (_url, init) => {
      requestPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({
        messages: [
          { role: "user", content: "compressed earlier user" },
          { role: "assistant", content: "compressed assistant", tool_calls: [{ id: "tool_1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.js\"}" } }] },
          { role: "system", content: "compressed system instruction" },
          { role: "user", content: "compressed current user" },
          { role: "tool", content: [{ type: "text", text: "compressed tool output" }], tool_call_id: "tool_1" },
        ],
        tokens_before: 100,
        tokens_after: 40,
        tokens_saved: 60,
      }), { status: 200 });
    });
    const body = {
      profileArn: "arn:test",
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: "conv-1",
        history: [
          {
            userInputMessage: {
              content: "earlier user",
              modelId: "claude-sonnet-4.5",
            },
          },
          {
            assistantResponseMessage: {
              content: "assistant response",
              toolUses: [
                {
                  toolUseId: "tool_1",
                  name: "read_file",
                  input: { path: "a.js" },
                },
              ],
            },
          },
        ],
        currentMessage: {
          userInputMessage: {
            content: VERBOSE,
            modelId: "claude-sonnet-4.5",
            systemInstruction: "native system instruction",
            userInputMessageContext: {
              tools: [{ toolSpecification: { name: "read_file" } }],
              toolResults: [
                {
                  toolUseId: "tool_1",
                  status: "success",
                  content: [{ text: "long tool output" }],
                },
              ],
            },
          },
        },
      },
    };

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "claude-sonnet-4.5",
      format: "kiro",
      compressUserMessages: true,
    });

    expect(stats.tokens_saved).toBe(60);
    expect(requestPayload).toEqual({
      model: "claude-sonnet-4.5",
      config: { compress_user_messages: true },
      messages: [
        { role: "user", content: "earlier user" },
        {
          role: "assistant",
          content: "assistant response",
          tool_calls: [
            {
              id: "tool_1",
              type: "function",
              function: { name: "read_file", arguments: "{\"path\":\"a.js\"}" },
            },
          ],
        },
        { role: "system", content: "native system instruction" },
        { role: "user", content: VERBOSE },
        { role: "tool", content: "long tool output", tool_call_id: "tool_1" },
      ],
    });
    expect(body.conversationState.history[0].userInputMessage.content).toBe("compressed earlier user");
    expect(body.conversationState.history[1].assistantResponseMessage.content).toBe("compressed assistant");
    expect(body.conversationState.currentMessage.userInputMessage.systemInstruction).toBe("compressed system instruction");
    expect(body.conversationState.currentMessage.userInputMessage.content).toBe("compressed current user");
    expect(body.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].content[0].text)
      .toBe("compressed tool output");
    expect(body.profileArn).toBe("arn:test");
    expect(body.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools)
      .toEqual([{ toolSpecification: { name: "read_file" } }]);
  });

  it("fails open when Kiro Headroom output does not preserve message order", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "assistant", content: "wrong role" }],
      tokens_saved: 10,
    }), { status: 200 }));
    const body = {
      conversationState: {
        currentMessage: {
          userInputMessage: {
            content: VERBOSE,
            modelId: "claude-sonnet-4.5",
          },
        },
        history: [],
      },
    };
    const original = structuredClone(body);
    const diagnostics = {};

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "claude-sonnet-4.5",
      format: "kiro",
      diagnostics,
    });

    expect(stats).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe("proxy response did not preserve Kiro message order");
  });

  it("fails open when proxy reorders adjacent same-role Kiro tool results", async () => {
    // Two tool results (both role "tool") returned in swapped tool_call_id order.
    // Role-only validation would pass and write compressed text into the wrong
    // original fields; identity validation must catch it and leave the body intact.
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [
        { role: "tool", content: "compressed for result B", tool_call_id: "tool_b" },
        { role: "tool", content: "compressed for result A", tool_call_id: "tool_a" },
      ],
      tokens_saved: 10,
    }), { status: 200 }));
    const body = {
      conversationState: {
        history: [],
        currentMessage: {
          userInputMessage: {
            modelId: "claude-sonnet-4.5",
            userInputMessageContext: {
              toolResults: [
                { toolUseId: "tool_a", status: "success", content: [{ text: VERBOSE }] },
                { toolUseId: "tool_b", status: "success", content: [{ text: VERBOSE }] },
              ],
            },
          },
        },
      },
    };
    const original = structuredClone(body);
    const diagnostics = {};

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "claude-sonnet-4.5",
      format: "kiro",
      diagnostics,
    });

    expect(stats).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe("proxy response did not preserve Kiro message identity");
  });

  it("fails open when one Kiro tool result carries multiple text parts", async () => {
    // Two text parts in a single toolResult project to two role "tool" messages
    // sharing tool_call_id. Their identities collide, so they cannot be safely
    // mapped back positionally — fail open and leave the body untouched.
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [
        { role: "tool", content: "compressed part 1", tool_call_id: "tool_a" },
        { role: "tool", content: "compressed part 2", tool_call_id: "tool_a" },
      ],
      tokens_saved: 10,
    }), { status: 200 }));
    const body = {
      conversationState: {
        history: [],
        currentMessage: {
          userInputMessage: {
            modelId: "claude-sonnet-4.5",
            userInputMessageContext: {
              toolResults: [
                {
                  toolUseId: "tool_a",
                  status: "success",
                  content: [{ text: VERBOSE }, { text: VERBOSE }],
                },
              ],
            },
          },
        },
      },
    };
    const original = structuredClone(body);
    const diagnostics = {};

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "claude-sonnet-4.5",
      format: "kiro",
      diagnostics,
    });

    expect(stats).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe("proxy response has ambiguous Kiro message identity");
  });

  it("fails open and leaves Kiro body unchanged when fetch throws", async () => {
    global.fetch = vi.fn(async () => { throw new Error("socket hang up"); });
    const body = {
      profileArn: "arn:test",
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: "conv-1",
        history: [
          { userInputMessage: { content: "earlier user", modelId: "claude-sonnet-4.5" } },
          {
            assistantResponseMessage: {
              content: "assistant response",
              toolUses: [{ toolUseId: "tool_1", name: "read_file", input: { path: "a.js" } }],
            },
          },
        ],
        currentMessage: {
          userInputMessage: {
            content: "current user",
            modelId: "claude-sonnet-4.5",
            systemInstruction: "native system instruction",
            userInputMessageContext: {
              tools: [{ toolSpecification: { name: "read_file" } }],
              toolResults: [{ toolUseId: "tool_1", status: "success", content: [{ text: "long tool output" }] }],
            },
          },
        },
      },
    };
    const original = structuredClone(body);
    const diagnostics = {};

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "claude-sonnet-4.5",
      format: "kiro",
      diagnostics,
    });

    expect(stats).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toMatch(/^request failed:/);
  });

  it("fails open on bad response", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 500 }));
    const body = { messages: [{ role: "user", content: "long" }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(body.messages[0].content).toBe("long");
  });

  it("skips unknown shapes", async () => {
    global.fetch = vi.fn();
    const body = { contents: [{ parts: [{ text: "long" }] }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // Regression for upstream 9router#2542: ensure the default 15s timeout is
  // passed to AbortSignal.timeout() so large prompt compression can finish.
  it("uses a 15s default timeout so large prompt compression can finish", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_before: 100,
      tokens_after: 20,
      tokens_saved: 80,
    }), { status: 200 }));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
    const body = { messages: [{ role: "user", content: VERBOSE }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(stats.tokens_saved).toBe(80);
    expect(timeoutSpy).toHaveBeenCalledWith(15000);
  });
  describe("timeout normalization", () => {
    it("passes a valid timeout to AbortSignal.timeout", async () => {
      global.fetch = vi.fn(async () => new Response(JSON.stringify({
        messages: [{ role: "user", content: "short" }],
        tokens_saved: 1,
      }), { status: 200 }));
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);

      await compressWithHeadroom(
        { messages: [{ role: "user", content: VERBOSE }] },
        { enabled: true, url: "http://localhost:8787", timeoutMs: 5000 },
      );

      expect(timeoutSpy).toHaveBeenCalledWith(5000);
    });

    it.each([null, 0, -1, NaN, Infinity, "5000"])(
      "falls back to 15s for invalid timeout %s",
      async (timeoutMs) => {
        global.fetch = vi.fn(async () => new Response(JSON.stringify({
          messages: [{ role: "user", content: "short" }],
          tokens_saved: 1,
        }), { status: 200 }));
        const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);

        await compressWithHeadroom(
          { messages: [{ role: "user", content: VERBOSE }] },
          { enabled: true, url: "http://localhost:8787", timeoutMs },
        );

        expect(timeoutSpy).toHaveBeenCalledWith(15000);
      },
    );
  });


  it("uses one proxy call and leaves body untouched on HTTP failure", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 503 }));
    const body = { messages: [{ role: "user", content: VERBOSE }] };
    const original = structuredClone(body);

    expect(await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" })).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(body).toEqual(original);
  });

  it.each([
    ["compression skip", { compression_skipped: true, skip_reason: "  remote   reason  " }, "remote reason"],
    ["CCR hashes", { ccr_hashes: ["abc"], messages: [{ role: "user", content: "short" }] }, "CCR"],
    ["CCR marker", { messages: [{ role: "user", content: "<<ccr:abc>>" }] }, "CCR"],
    ["zero gain", { messages: [{ role: "user", content: "short" }], tokens_saved: "0" }, "no token saving"],
    ["phantom tokens", { messages: [{ role: "user", content: "short" }], tokens_before: "100", tokens_after: "95", tokens_saved: "5" }, "phantom"],
    ["conflicting tokens", { messages: [{ role: "user", content: "short" }], tokens_before: 100, tokens_after: 101, tokens_saved: 1 }, "conflicting"],
  ])("rejects %s before mutation", async (_name, response, reason) => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    const body = { messages: [{ role: "user", content: VERBOSE }] };
    const original = structuredClone(body);
    const diagnostics = {};

    expect(await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      diagnostics,
    })).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toContain(reason);
  });

  it("bounds proxy-controlled diagnostics", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      compression_skipped: true,
      skip_reason: `  ${"x".repeat(3000)}  `,
    }), { status: 200 }));
    const diagnostics = {};

    await compressWithHeadroom({ messages: [{ role: "user", content: VERBOSE }] }, {
      enabled: true,
      url: "http://localhost:8787",
      diagnostics,
    });

    expect(diagnostics.reason.length).toBeLessThanOrEqual(200);
  });

  it("rejects reordered messages and changed tool identities", async () => {
    const toolCall = { id: "call_1", type: "function", function: { name: "read", arguments: "{}" } };
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [
        { role: "assistant", content: null, tool_calls: [{ ...toolCall, id: "changed" }] },
        { role: "user", content: "short" },
      ],
      tokens_before: 100,
      tokens_after: 10,
      tokens_saved: 90,
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: VERBOSE }, { role: "assistant", content: null, tool_calls: [toolCall] }] };
    const original = structuredClone(body);

    expect(await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" })).toBeNull();
    expect(body).toEqual(original);
  });

  it.each([
    ["openai", { messages: [{ role: "tool", tool_call_id: "call_1", content: "failed", is_error: true }] }],
    ["claude", { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "failed", is_error: true }] }] }],
    ["openai-responses", { input: [{ type: "function_call_output", call_id: "call_1", output: "failed", status: "error" }] }],
    ["kiro", { conversationState: { history: [], currentMessage: { userInputMessage: { content: "failed", userInputMessageContext: { toolResults: [{ toolUseId: "call_1", status: "error", content: [{ text: "failed" }] }] } } } } }],
  ])("skips explicit %s error tool results before fetch", async (format, body) => {
    global.fetch = vi.fn();
    const diagnostics = {};

    expect(await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      format,
      diagnostics,
    })).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(diagnostics.reason).toContain("error tool result");
  });

  it("does not infer tool errors from plain text", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "tool", tool_call_id: "call_1", content: "short" }],
      tokens_before: 100,
      tokens_after: 10,
      tokens_saved: 90,
    }), { status: 200 }));
    const body = { messages: [{ role: "tool", tool_call_id: "call_1", content: `${VERBOSE} error` }] };

    expect(await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" })).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects byte-shrink phantom savings before mutation", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: `${VERBOSE.slice(0, -1)}` }],
      tokens_before: 1000,
      tokens_after: 10,
      tokens_saved: 990,
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: VERBOSE }] };
    const original = structuredClone(body);
    const diagnostics = {};

    expect(await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", diagnostics })).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toContain("phantom savings");
  });

  it("commits valid string-encoded token gains", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_before: "100",
      tokens_after: "10",
      tokens_saved: "90",
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: VERBOSE }] };

    expect(await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" })).not.toBeNull();
    expect(body.messages[0].content).toBe("short");
  });

  it("rejects Claude byte-shrink phantom savings before mutation", async () => {
    global.fetch = vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body);
      return new Response(JSON.stringify({
        messages: request.messages.map((message) => ({ ...message, content: `${message.content}x` })),
        tokens_before: 1000,
        tokens_after: 10,
        tokens_saved: 990,
      }), { status: 200 });
    });
    const body = { messages: [{ role: "user", content: VERBOSE }] };
    const original = structuredClone(body);

    expect(await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "claude-sonnet-4.5",
      format: "claude",
    })).toBeNull();
    expect(body).toEqual(original);
  });

  it("rejects Responses byte-shrink phantom savings before mutation", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: `${VERBOSE.slice(0, -1)}` }],
      tokens_before: 1000,
      tokens_after: 10,
      tokens_saved: 990,
    }), { status: 200 }));
    const body = { input: [{ role: "user", content: VERBOSE }] };
    const original = structuredClone(body);

    expect(await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      format: "openai-responses",
    })).toBeNull();
    expect(body).toEqual(original);
  });

  it("rejects Kiro byte-shrink phantom savings before mutation", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: `${VERBOSE.slice(0, -1)}` }],
      tokens_before: 1000,
      tokens_after: 10,
      tokens_saved: 990,
    }), { status: 200 }));
    const body = {
      conversationState: {
        history: [],
        currentMessage: { userInputMessage: { content: VERBOSE, modelId: "claude-sonnet-4.5" } },
      },
    };
    const original = structuredClone(body);

    expect(await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      format: "kiro",
    })).toBeNull();
    expect(body).toEqual(original);
  });
});

describe("formatHeadroomLog", () => {
  it("formats reported token deltas without implying provider billing savings", () => {
    expect(formatHeadroomLog({ tokens_before: 100, tokens_after: 25, tokens_saved: 75 }))
      .toBe("reported token delta=75 before=100 after=25 (75.0%)");
  });
});
