import { describe, it, expect, vi, beforeEach } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_SYSTEM_PROMPT } from "../../open-sse/config/appConstants.js";
import { GithubExecutor } from "../../open-sse/executors/github.js";

const { proxyAwareFetch } = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const model = "claude-sonnet-4.6";
const personas = [
  ["absent", undefined, []],
  ["string", "You are a translator. Reply only in French.", ["You are a translator. Reply only in French."]],
  ["blocks", [
    { type: "text", text: CLAUDE_SYSTEM_PROMPT },
    { type: "text", text: "Translate this fictional persona verbatim." },
  ], [CLAUDE_SYSTEM_PROMPT, "Translate this fictional persona verbatim."]],
];

function nativeRequest(system, stream) {
  return {
    model,
    max_tokens: 32,
    stream,
    ...(system !== undefined && { system: structuredClone(system) }),
    messages: [{ role: "user", content: [{ type: "text", text: "Bonjour" }] }],
  };
}

function upstreamResponse() {
  const frames = [
    { type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Bonjour" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  return new Response(frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

// GitHub's executor expects OpenAI input even for a native Messages client.
// Check the registered native control and the real executor's second translation.
describe.each([false, true])("GitHub native client persona (stream=%s)", (stream) => {
  beforeEach(() => proxyAwareFetch.mockReset());

  it.each(personas)("same-format control preserves %s system instructions without branding", (_shape, system, texts) => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, model, nativeRequest(system, stream), stream, null, "github");
    expect(Array.isArray(out.system) ? out.system.map((block) => block.text) : out.system).toEqual(
      Array.isArray(system) ? texts : system,
    );
    expect(out.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Bonjour" }] }]);
    expect(out.stream).toBe(stream);
  });

  it.each(personas)("native client bridge dispatches %s persona without adding or deleting caller text", async (_shape, system, texts) => {
    proxyAwareFetch.mockResolvedValueOnce(upstreamResponse());
    const body = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, model, nativeRequest(system, stream), stream, null, "github");
    const result = await new GithubExecutor().execute({
      model, body, stream, credentials: { accessToken: "fixture-token" }, signal: null, log: null,
      requestContext: { clientHeaders: { "user-agent": "claude-cli/fixture" } },
    });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.githubcopilot.com/v1/messages");
    expect(options.headers.Accept).toBe("text/event-stream");
    const sent = JSON.parse(options.body);
    expect((sent.system ?? []).map((block) => block.text)).toEqual(texts.length ? [texts.join("\n")] : []);
    expect(sent.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Bonjour" }] }]);
    expect(sent.stream).toBe(true);
    const response = await result.response.text();
    expect(response).toContain('"content":"Bonjour"');
    expect(response).toContain('"finish_reason":"stop"');
    expect(response).toContain("[DONE]");
    expect(response).not.toContain("stream_error");
  });
});
