/**
 * Port test (OmniRoute #923): GitHub Copilot's /chat/completions endpoint
 * rejects assistant history that carries `reasoning_text` / `reasoning_content`.
 *
 * Copilot turns those fields into Anthropic thinking blocks it cannot sign, so
 * the upstream answers 400 ("Invalid signature in thinking block"). Both fields
 * are response-only artifacts — a client replays them on the assistant turn it
 * received them on — so the replayed history must not carry them upstream.
 *
 * The fix is scoped to the GitHub Copilot chat route. Every assertion below
 * reads the ACTUAL outbound executor request, captured from a mocked offline
 * transport, and the neighbouring routes are pinned as unchanged:
 *   - the Anthropic-native /v1/messages route keeps its signed thinking blocks;
 *   - the /responses route keeps its own (already reasoning-free) body;
 *   - another provider's executor still forwards assistant reasoning;
 *   - the caller's own body object is never mutated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { proxyAwareFetch } = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

const { GithubExecutor } = await import("../../open-sse/executors/github.js");
const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
const { translateRequest } = await import("../../open-sse/translator/index.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { CLAUDE_NATIVE_BLOCKS } = await import("../../open-sse/translator/schema/index.js");
await import("../translator/registerAll.js");

const CHAT_URL = "https://api.githubcopilot.com/chat/completions";
const MESSAGES_URL = "https://api.githubcopilot.com/v1/messages";
const RESPONSES_URL = "https://api.githubcopilot.com/responses";

/** A valid Claude signature: base64 of the 0x12 marker byte. */
const SIGNED_SIGNATURE = Buffer.from([0x12, 0x34, 0x56, 0x78]).toString("base64");

function chatSSE() {
  return new Response(
    [
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "ok" } }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

function claudeSSE() {
  const frames = [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4.6", content: [], usage: { input_tokens: 11, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  const raw = frames.map(([event, payload]) => `event: ${event}\ndata: ${JSON.stringify(payload)}`).join("\n\n");
  return new Response(`${raw}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function responsesSSE() {
  const raw = [
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  return new Response(raw, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A chat-shaped body whose assistant turn replays both reasoning fields. */
function chatBody() {
  return {
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: "You are terse." },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "hello",
        reasoning_content: "internal chain of thought",
        reasoning_text: "internal summary",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "42" },
      { role: "user", content: "more", reasoning_content: "user-authored field" },
    ],
    tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }],
  };
}

/**
 * An ordinary assistant turn the caller made immutable: its reasoning fields
 * are own, non-configurable descriptors, so they cannot be deleted once the
 * copy has been constructed. It also carries the non-enumerable Claude native
 * blocks a pivot attaches, which have to survive the rewrite.
 */
function immutableAssistantMessage() {
  const message = {
    role: "assistant",
    content: "hello from a frozen turn",
    reasoning_content: "internal chain of thought",
    reasoning_text: "internal summary",
  };
  Object.defineProperty(message, CLAUDE_NATIVE_BLOCKS, {
    value: [{ type: "thinking", thinking: "internal chain of thought", signature: SIGNED_SIGNATURE }],
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(message);
}

/** A read-only ordinary assistant turn: the same shape, still writable content. */
function readOnlyAssistantMessage() {
  return Object.seal({
    role: "assistant",
    content: "hello from a read-only turn",
    reasoning_content: "internal chain of thought",
  });
}

function sentBody(callIndex = 0) {
  return JSON.parse(proxyAwareFetch.mock.calls[callIndex][1].body);
}

describe("GitHub Copilot chat route: assistant reasoning fields (OmniRoute #923)", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  it("omits reasoning_text and reasoning_content from the assistant turn it sends upstream", async () => {
    proxyAwareFetch.mockResolvedValueOnce(chatSSE());
    const exec = new GithubExecutor();

    await exec.execute({
      model: "gpt-5-mini",
      body: chatBody(),
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(CHAT_URL);

    const sent = sentBody();
    const assistant = sent.messages.find((msg) => msg.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant.reasoning_text).toBeUndefined();
    expect(assistant.reasoning_content).toBeUndefined();
    expect(Object.keys(assistant)).not.toContain("reasoning_text");
    expect(Object.keys(assistant)).not.toContain("reasoning_content");
  });

  it("keeps the assistant content, the tool calls, the other roles and the tool definitions", async () => {
    proxyAwareFetch.mockResolvedValueOnce(chatSSE());
    const exec = new GithubExecutor();

    await exec.execute({
      model: "gpt-5-mini",
      body: chatBody(),
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: null,
    });

    const sent = sentBody();
    const roles = sent.messages.map((msg) => msg.role);
    expect(roles).toEqual(["system", "user", "assistant", "tool", "user"]);

    const assistant = sent.messages[2];
    expect(assistant.content).toBe("hello");
    expect(assistant.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } },
    ]);

    // Non-assistant turns keep every field they carried.
    expect(sent.messages[0].content).toBe("You are terse.");
    expect(sent.messages[1].content).toBe("hi");
    expect(sent.messages[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "42" });
    expect(sent.messages[4].reasoning_content).toBe("user-authored field");

    // The request-level tool definitions survive untouched.
    expect(sent.tools).toEqual([
      { type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } },
    ]);
    // The selected model is not rewritten by the strip.
    expect(sent.model).toBe("gpt-5-mini");
  });

  it("behaves identically for a non-streaming request and for an access-token-only connection", async () => {
    proxyAwareFetch.mockResolvedValueOnce(chatSSE());
    const exec = new GithubExecutor();

    await exec.execute({
      model: "gpt-5-mini",
      body: chatBody(),
      stream: false,
      credentials: { accessToken: "gho_test" },
      log: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe(CHAT_URL);
    const sent = sentBody();
    const assistant = sent.messages.find((msg) => msg.role === "assistant");
    expect(assistant.reasoning_text).toBeUndefined();
    expect(assistant.reasoning_content).toBeUndefined();
    expect(assistant.content).toBe("hello");
  });

  it("does not mutate the caller's body, so another provider in the same request is unaffected", async () => {
    proxyAwareFetch.mockResolvedValueOnce(chatSSE());
    const exec = new GithubExecutor();
    const body = chatBody();

    await exec.execute({
      model: "gpt-5-mini",
      body,
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: null,
    });

    expect(body.messages[2].reasoning_content).toBe("internal chain of thought");
    expect(body.messages[2].reasoning_text).toBe("internal summary");
  });

  it("leaves an assistant turn without reasoning fields untouched", async () => {
    proxyAwareFetch.mockResolvedValueOnce(chatSSE());
    const exec = new GithubExecutor();

    await exec.execute({
      model: "gpt-5-mini",
      body: {
        model: "gpt-5-mini",
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
          { role: "user", content: "more" },
        ],
      },
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: null,
    });

    const sent = sentBody();
    expect(sent.messages[1]).toEqual({ role: "assistant", content: "hello" });
  });

  it("omits the reasoning the Claude -> OpenAI pivot puts on the assistant turn", async () => {
    proxyAwareFetch.mockResolvedValueOnce(chatSSE());
    const exec = new GithubExecutor();

    // A Claude-format client (Claude Desktop, Claude Code) routed to Copilot:
    // chatCore pivots the request to the provider's `openai` target format,
    // and the pivot attaches the assistant turn's thinking text as
    // `reasoning_content` (open-sse/translator/request/claude-to-openai.js).
    const translated = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      "gpt-5-mini",
      {
        model: "gpt-5-mini",
        max_tokens: 128,
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "internal chain of thought" },
              { type: "text", text: "hello" },
            ],
          },
          { role: "user", content: "more" },
        ],
      },
      true,
      { copilotToken: "ghu_test" },
      "github"
    );

    // The pivot really does put the field on the assistant turn ...
    const pivotAssistant = translated.messages.find((msg) => msg.role === "assistant");
    expect(pivotAssistant.reasoning_content).toBe("internal chain of thought");

    // ... and the chat route does not forward it.
    await exec.execute({
      model: "gpt-5-mini",
      body: translated,
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: null,
    });

    const sent = sentBody();
    const assistant = sent.messages.find((msg) => msg.role === "assistant");
    expect(assistant.reasoning_content).toBeUndefined();
    expect(assistant.content).toBe("hello");
  });

  it("strips the reasoning fields of an immutable assistant turn instead of failing", async () => {
    proxyAwareFetch.mockResolvedValueOnce(chatSSE());
    const exec = new GithubExecutor();
    const frozen = immutableAssistantMessage();
    const readOnly = readOnlyAssistantMessage();

    await exec.execute({
      model: "gpt-5-mini",
      body: {
        model: "gpt-5-mini",
        messages: [
          { role: "user", content: "hi" },
          frozen,
          readOnly,
          { role: "user", content: "more" },
        ],
      },
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe(CHAT_URL);

    const sent = sentBody();
    const assistants = sent.messages.filter((msg) => msg.role === "assistant");
    expect(assistants).toHaveLength(2);
    for (const assistant of assistants) {
      expect(assistant.reasoning_text).toBeUndefined();
      expect(assistant.reasoning_content).toBeUndefined();
      expect(Object.keys(assistant)).not.toContain("reasoning_text");
      expect(Object.keys(assistant)).not.toContain("reasoning_content");
    }
    expect(assistants[0].content).toBe("hello from a frozen turn");
    expect(assistants[1].content).toBe("hello from a read-only turn");
  });

  it("keeps the source, the prototype, the native blocks and the other settings of an immutable turn", () => {
    const exec = new GithubExecutor();
    const frozen = immutableAssistantMessage();
    const readOnly = readOnlyAssistantMessage();
    const body = {
      model: "gpt-5-mini",
      messages: [
        { role: "user", content: "hi" },
        frozen,
        readOnly,
        { role: "user", content: "more" },
      ],
    };

    const sanitized = exec.sanitizeMessagesForChatCompletions(body);
    const frozenClone = sanitized.messages[1];
    const readOnlyClone = sanitized.messages[2];

    // The source objects are left exactly as they were.
    expect(frozen.reasoning_content).toBe("internal chain of thought");
    expect(frozen.reasoning_text).toBe("internal summary");
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(readOnly.reasoning_content).toBe("internal chain of thought");

    // The copies drop exactly the two reasoning fields.
    for (const clone of [frozenClone, readOnlyClone]) {
      expect(clone.reasoning_content).toBeUndefined();
      expect(clone.reasoning_text).toBeUndefined();
      expect(Object.getOwnPropertyNames(clone)).not.toContain("reasoning_content");
      expect(Object.getOwnPropertyNames(clone)).not.toContain("reasoning_text");
    }

    // Same prototype, same role, same content.
    expect(Object.getPrototypeOf(frozenClone)).toBe(Object.getPrototypeOf(frozen));
    expect(Object.getPrototypeOf(readOnlyClone)).toBe(Object.getPrototypeOf(readOnly));
    expect(frozenClone.role).toBe("assistant");
    expect(frozenClone.content).toBe("hello from a frozen turn");
    expect(readOnlyClone.content).toBe("hello from a read-only turn");

    // The non-enumerable native blocks survive the rewrite.
    const nativeDescriptor = Object.getOwnPropertyDescriptor(frozenClone, CLAUDE_NATIVE_BLOCKS);
    expect(nativeDescriptor).toBeDefined();
    expect(nativeDescriptor.enumerable).toBe(false);
    expect(nativeDescriptor.writable).toBe(false);
    expect(nativeDescriptor.configurable).toBe(false);
    expect(frozenClone[CLAUDE_NATIVE_BLOCKS]).toEqual(frozen[CLAUDE_NATIVE_BLOCKS]);

    // The other descriptors keep their own settings.
    const contentDescriptor = Object.getOwnPropertyDescriptor(frozenClone, "content");
    expect(contentDescriptor.enumerable).toBe(true);
    expect(contentDescriptor.writable).toBe(false);
    expect(contentDescriptor.configurable).toBe(false);
  });
});

describe("GitHub Copilot routes that must stay unchanged (OmniRoute #923)", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  it("keeps Anthropic-native signed thinking on the /v1/messages route", async () => {
    proxyAwareFetch.mockResolvedValueOnce(claudeSSE());
    const exec = new GithubExecutor();

    await exec.execute({
      model: "claude-sonnet-4.6",
      body: {
        model: "claude-sonnet-4.6",
        max_tokens: 64,
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "signed thoughts", signature: SIGNED_SIGNATURE },
              { type: "text", text: "hello" },
            ],
            reasoning_content: "unsigned replay",
          },
          { role: "user", content: "more" },
        ],
      },
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe(MESSAGES_URL);

    const sent = sentBody();
    const assistant = sent.messages.find((msg) => msg.role === "assistant");
    const thinking = assistant.content.find((block) => block.type === "thinking");
    expect(thinking).toBeDefined();
    expect(thinking.thinking).toBe("signed thoughts");
    expect(thinking.signature).toBe(SIGNED_SIGNATURE);
  });

  it("keeps the /responses route free of the chat reasoning fields", async () => {
    proxyAwareFetch.mockResolvedValueOnce(responsesSSE());
    const exec = new GithubExecutor();

    await exec.execute({
      model: "gpt-5.5-codex",
      body: {
        model: "gpt-5.5-codex",
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "hello",
            reasoning_content: "internal chain of thought",
            reasoning_text: "internal summary",
          },
          { role: "user", content: "more" },
        ],
      },
      stream: true,
      credentials: {
        copilotToken: "ghu_test",
        providerSpecificData: {
          copilotEndpointContract: {
            version: 1,
            models: [{
              id: "gpt-5.5-codex",
              supportedEndpoints: ["responses"],
              targetFormat: "openai-responses",
            }],
          },
        },
      },
      log: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe(RESPONSES_URL);

    const sent = sentBody();
    expect(sent.messages).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain("reasoning_content");
    expect(JSON.stringify(sent)).not.toContain("reasoning_text");
    // The assistant turn still reaches the Responses input.
    expect(JSON.stringify(sent)).toContain("hello");
  });

  it("leaves another provider's executor forwarding assistant reasoning", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));

    await new DefaultExecutor("openai").execute({
      model: "gpt-5-mini",
      body: {
        model: "gpt-5-mini",
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello", reasoning_content: "internal chain of thought" },
          { role: "user", content: "more" },
        ],
      },
      stream: true,
      credentials: {
        apiKey: "sk-test",
        runtimeTransport: {
          format: "openai",
          baseUrl: "https://api.openai.com/v1/chat/completions",
        },
      },
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const sent = sentBody();
    const assistant = sent.messages.find((msg) => msg.role === "assistant");
    expect(assistant.reasoning_content).toBe("internal chain of thought");
  });
});
