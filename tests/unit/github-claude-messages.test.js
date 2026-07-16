/**
 * Port test (upstream 9router #2608): Claude models on GitHub Copilot are routed
 * to Copilot's Anthropic-native /v1/messages shim — the only Copilot endpoint that
 * surfaces prompt-cache token counts. Non-Claude models must keep the existing
 * /chat/completions (or /responses) routes untouched.
 *
 * Also defends the port-specific stream contract (adapted to dev conventions):
 *  - upstream request is ALWAYS forced to stream:true (headers AND body), even
 *    when the client asked for stream:false;
 *  - translated OpenAI finish frames are held until the stream is validated at
 *    EOF (coherent message_stop), so a truncated/contradicted stream can never
 *    leak a partial success (finish chunk + [DONE]) ahead of the failure signal.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ANTHROPIC_API_VERSION } from "../../open-sse/providers/shared.js";
import { GithubExecutor } from "../../open-sse/executors/github.js";

const { proxyAwareFetch } = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

// Build a Claude-native SSE byte stream from [eventName, payload] pairs.
function claudeSSE(frames, { done = false } = {}) {
  let out = "";
  for (const [event, payload] of frames) {
    out += `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  }
  if (done) out += "data: [DONE]\n\n";
  return new Response(out, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const TEXT_START = ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }];
const TEXT_DELTA = (text) => ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }];
const TEXT_STOP = ["content_block_stop", { type: "content_block_stop", index: 0 }];
const MSG_START = ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4.6", content: [], usage: { input_tokens: 11, output_tokens: 1, cache_read_input_tokens: 7 } } }];
const MSG_DELTA = ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }];
const MSG_STOP = ["message_stop", { type: "message_stop" }];

async function readStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("GithubExecutor native Claude /v1/messages routing (upstream #2608)", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  const credentials = { accessToken: "tok" };

  it("routes claude models to /v1/messages with a translated Anthropic-native body and forced upstream streaming", async () => {
    proxyAwareFetch.mockResolvedValueOnce(claudeSSE([MSG_START, TEXT_START, TEXT_DELTA("hi"), TEXT_STOP, MSG_DELTA, MSG_STOP]));
    const exec = new GithubExecutor();

    const result = await exec.execute({
      model: "claude-sonnet-4.6",
      body: { model: "claude-sonnet-4.6", messages: [{ role: "system", content: "You are terse." }, { role: "user", content: "hi" }], max_tokens: 16, response_format: { type: "json_object" } },
      stream: false, // client asked non-streaming — upstream must still stream
      credentials,
      signal: null,
      log: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.githubcopilot.com/v1/messages");
    // Forced SSE upstream regardless of client stream:false (headers AND body).
    expect(options.headers["Accept"]).toBe("text/event-stream");
    expect(options.headers["anthropic-version"]).toBe(ANTHROPIC_API_VERSION);
    const sent = JSON.parse(options.body);
    expect(sent.stream).toBe(true);
    // Anthropic-native shape: system/messages, no OpenAI-only fields.
    expect(sent.messages[0].role).toBe("user");
    expect(sent._toolNameMap).toBeUndefined();
    // prepareClaudeRequest ran: last system block carries the 1h ephemeral cache
    // marker — the behavior the native route exists to exploit.
    const lastSystem = sent.system[sent.system.length - 1];
    expect(lastSystem.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    // Upstream #2608 removed the chat-completions sanitizer's response_format JSON
    // injection because the native openai→claude translation replaces it: the
    // JSON-mode instruction lands in system and response_format is NOT forwarded.
    expect(lastSystem.text).toContain("Respond ONLY with a JSON object");
    expect(sent.response_format).toBeUndefined();

    const out = await readStream(result.response);
    // OpenAI-shaped deltas stream live, finish frame + [DONE] close the stream.
    expect(out).toContain('"content":"hi"');
    expect(out).toContain('"finish_reason":"stop"');
    expect(out).toContain("[DONE]");
    expect(out).not.toContain("stream_error");
    // Cache usage surfaced from the native endpoint: cache_read (7) folded into
    // prompt_tokens (11 + 7 = 18) and reported as cached_tokens — the whole
    // point of the /v1/messages route.
    expect(out).toContain('"prompt_tokens":18');
    expect(out).toContain('"prompt_tokens_details":{"cached_tokens":7}');
    expect(result.terminalProvenance).toBe("validated");
  });

  it("recognizes claude variants by name pattern (case-insensitive, unknown-to-registry)", () => {
    const exec = new GithubExecutor();
    expect(exec.isClaudeModel("claude-opus-4.8")).toBe(true);
    expect(exec.isClaudeModel("CLAUDE-SONNET-4.6")).toBe(true);
    expect(exec.isClaudeModel("gpt-5.4")).toBe(false);
    expect(exec.isClaudeModel("gemini-2.5-pro")).toBe(false);
    expect(exec.isClaudeModel(undefined)).toBe(false);
  });

  it("keeps non-claude models on /chat/completions (no /v1/messages call)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response('data: {"id":"x","choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const exec = new GithubExecutor();

    const result = await exec.execute({
      model: "gpt-5.4",
      body: { model: "gpt-5.4", messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
      signal: null,
      log: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.githubcopilot.com/chat/completions");
    expect(url).not.toContain("/v1/messages");
    // Non-claude bodies are NOT translated to Anthropic shape.
    const sent = JSON.parse(options.body);
    expect(sent.messages[0].role).toBe("user");
    await readStream(result.response);
  });

  it("emits failure instead of [DONE] when the stream ends without message_stop", async () => {
    proxyAwareFetch.mockResolvedValueOnce(claudeSSE([MSG_START, TEXT_START, TEXT_DELTA("hi"), TEXT_STOP]));
    const exec = new GithubExecutor();

    const result = await exec.execute({
      model: "claude-sonnet-4.6",
      body: { model: "claude-sonnet-4.6", messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
      signal: null,
      log: null,
    });

    const out = await readStream(result.response);
    expect(out).toContain("stream_error");
    expect(out).not.toContain("[DONE]");
    // The finish frame must never leak on a truncated stream. Live content
    // chunks legitimately carry "finish_reason":null, so target the terminal
    // value, not the key.
    expect(out).not.toContain('"finish_reason":"');
  });

  it("emits failure, never a success terminal, when data arrives after message_stop", async () => {
    const frames = [MSG_START, TEXT_START, TEXT_DELTA("hi"), TEXT_STOP, MSG_DELTA, MSG_STOP,
      TEXT_DELTA("garbage-after-stop")];
    proxyAwareFetch.mockResolvedValueOnce(claudeSSE(frames));
    const exec = new GithubExecutor();

    const result = await exec.execute({
      model: "claude-sonnet-4.6",
      body: { model: "claude-sonnet-4.6", messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
      signal: null,
      log: null,
    });

    const out = await readStream(result.response);
    // Live content streamed, but the held finish frame + [DONE] must not leak.
    expect(out).toContain('"content":"hi"');
    expect(out).toContain("stream_error");
    expect(out).not.toContain("[DONE]");
    expect(out).not.toContain('"finish_reason":"');
    expect(out).not.toContain("garbage-after-stop");
  });

  it("emits failure on a malformed non-SSE frame line", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m","usage":{"input_tokens":1,"output_tokens":1}}}\n\nGARBAGE-LINE\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ));
    const exec = new GithubExecutor();

    const result = await exec.execute({
      model: "claude-sonnet-4.6",
      body: { model: "claude-sonnet-4.6", messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
      signal: null,
      log: null,
    });

    const out = await readStream(result.response);
    expect(out).toContain("stream_error");
    expect(out).not.toContain("[DONE]");
  });

  it("rejects an event-named [DONE] sentinel even after a valid message_stop", async () => {
    // A bare data: [DONE] after message_stop is accepted (upstream #2608), but a
    // [DONE] carrying an event: name is a framing mismatch and must fail.
    const frames = [MSG_START, TEXT_START, TEXT_DELTA("hi"), TEXT_STOP, MSG_DELTA, MSG_STOP];
    let sse = "";
    for (const [event, payload] of frames) sse += `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    sse += "event: bogus\ndata: [DONE]\n\n";
    proxyAwareFetch.mockResolvedValueOnce(new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const exec = new GithubExecutor();

    const result = await exec.execute({
      model: "claude-sonnet-4.6",
      body: { model: "claude-sonnet-4.6", messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
      signal: null,
      log: null,
    });

    const out = await readStream(result.response);
    expect(out).toContain("stream_error");
    expect(out).not.toContain("[DONE]");
    expect(out).not.toContain('"finish_reason":"');
  });

  it("accepts one bare [DONE] after message_stop and folds cache usage via the fallback path", async () => {
    // message_delta WITHOUT stop_reason → finish frame falls back to message_stop,
    // which must still surface message_start cache usage (prompt 11+7=18).
    const msgDeltaNoStop = ["message_delta", { type: "message_delta", delta: {}, usage: { output_tokens: 5 } }];
    const frames = [MSG_START, TEXT_START, TEXT_DELTA("hi"), TEXT_STOP, msgDeltaNoStop, MSG_STOP];
    let sse = "";
    for (const [event, payload] of frames) sse += `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    sse += "data: [DONE]\n\n";
    proxyAwareFetch.mockResolvedValueOnce(new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const exec = new GithubExecutor();

    const result = await exec.execute({
      model: "claude-sonnet-4.6",
      body: { model: "claude-sonnet-4.6", messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
      signal: null,
      log: null,
    });

    const out = await readStream(result.response);
    expect(out).not.toContain("stream_error");
    expect(out).toContain('"finish_reason":"stop"');
    expect(out).toContain('"prompt_tokens":18');
    expect(out).toContain('"prompt_tokens_details":{"cached_tokens":7}');
    expect(out).toContain("[DONE]");
  });

  it("strips unsupported params before /v1/messages on non-4.6 Claude (Codex P1)", async () => {
    // Non-4.6 model: temperature dropped for ALL Claude; thinking/reasoning_effort
    // dropped for github-Claude EXCEPT opus/sonnet 4.6 — use claude-sonnet-4.5 so
    // all three strip rules fire (a 4.6 model would legitimately keep thinking).
    proxyAwareFetch.mockResolvedValueOnce(claudeSSE([MSG_START, TEXT_START, TEXT_DELTA("hi"), TEXT_STOP, MSG_DELTA, MSG_STOP]));
    const exec = new GithubExecutor();

    await exec.execute({
      model: "claude-sonnet-4.5",
      body: {
        model: "claude-sonnet-4.5",
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.7,                  // Claude rejects temperature upstream (400)
        thinking: { budget_tokens: 2048 }, // non-4.6 GitHub Claude rejects thinking
        reasoning_effort: "high",          // non-4.6 GitHub Claude rejects reasoning_effort
      },
      stream: true,
      credentials,
      signal: null,
      log: null,
    });

    const sent = JSON.parse(proxyAwareFetch.mock.calls[0][1].body);
    expect(sent.temperature).toBeUndefined();
    expect(sent.thinking).toBeUndefined();
    expect(sent.reasoning_effort).toBeUndefined();
  });

  it("honors max_completion_tokens cap exactly when max_tokens absent (Codex P2)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(claudeSSE([MSG_START, TEXT_START, TEXT_DELTA("hi"), TEXT_STOP, MSG_DELTA, MSG_STOP]));
    const exec = new GithubExecutor();

    // No tools → no DEFAULT_MIN_TOKENS bump, so max_tokens must equal the exact cap.
    await exec.execute({
      model: "claude-sonnet-4.6",
      body: {
        model: "claude-sonnet-4.6",
        messages: [{ role: "user", content: "hi" }],
        max_completion_tokens: 32,
      },
      stream: true,
      credentials,
      signal: null,
      log: null,
    });

    const sent = JSON.parse(proxyAwareFetch.mock.calls[0][1].body);
    expect(sent.max_tokens).toBe(32);
    expect(sent.max_completion_tokens).toBeUndefined();
  });

  it("maps stop array and tool_choice \"none\" to Anthropic shapes (Codex P2)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(claudeSSE([MSG_START, TEXT_START, TEXT_DELTA("hi"), TEXT_STOP, MSG_DELTA, MSG_STOP]));
    const exec = new GithubExecutor();

    await exec.execute({
      model: "claude-sonnet-4.6",
      body: {
        model: "claude-sonnet-4.6",
        messages: [{ role: "user", content: "hi" }],
        stop: ["\n\n", "END"],
        tools: [{ type: "function", function: { name: "get_time", parameters: { type: "object", properties: {} } } }],
        tool_choice: "none",
      },
      stream: true,
      credentials,
      signal: null,
      log: null,
    });

    const sent = JSON.parse(proxyAwareFetch.mock.calls[0][1].body);
    expect(sent.stop_sequences).toEqual(["\n\n", "END"]);
    expect(sent.stop).toBeUndefined();
    // tool_choice "none" → Anthropic { type: "none" } (never "auto").
    expect(sent.tool_choice).toEqual({ type: "none" });
  });

  it("maps stop given as a bare string and ignores explicit stop:null", async () => {
    // Fresh Response per call — a single shared Response body is locked/consumed by
    // the first read, so the second execute must get its own.
    proxyAwareFetch
      .mockResolvedValueOnce(claudeSSE([MSG_START, TEXT_START, TEXT_DELTA("hi"), TEXT_STOP, MSG_DELTA, MSG_STOP]))
      .mockResolvedValueOnce(claudeSSE([MSG_START, TEXT_START, TEXT_DELTA("hi"), TEXT_STOP, MSG_DELTA, MSG_STOP]));
    const exec = new GithubExecutor();
    const base = { model: "claude-sonnet-4.6", messages: [{ role: "user", content: "hi" }] };

    // String stop → single-element stop_sequences.
    await exec.execute({ model: "claude-sonnet-4.6", body: { ...base, stop: "STOP" }, stream: true, credentials, signal: null, log: null });
    let sent = JSON.parse(proxyAwareFetch.mock.calls[0][1].body);
    expect(sent.stop_sequences).toEqual(["STOP"]);

    // Explicit stop:null (valid OpenAI, means "no stops") → NO stop_sequences, never [null].
    await exec.execute({ model: "claude-sonnet-4.6", body: { ...base, stop: null }, stream: true, credentials, signal: null, log: null });
    sent = JSON.parse(proxyAwareFetch.mock.calls[1][1].body);
    expect(sent.stop_sequences).toBeUndefined();
  });
});
