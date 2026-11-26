// OmniRoute #20375: ChatPlayground serves every chat model from one unified web route.
import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { ChatPlaygroundExecutor, discoverChatPlaygroundModels, validateChatPlaygroundCookie } from "../../open-sse/executors/chatplayground.js";
import { createUnifiedChatStream } from "../../open-sse/executors/chatplaygroundStream.js";
import provider from "../../open-sse/providers/registry/chatplayground.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

const API = "https://web.chatplayground.ai/api";
const JWT = "eyJhbGciOiJub25lIn0.eyJzaWQiOiJzaWQtYSJ9.signature";
const COOKIE = `__client=client-a; __session=${JWT}`;
const MODEL = "gpt-6-luna";
const CATALOG = [
  { slug: MODEL, displayName: "ChatGPT-6 Luna", provider: "openai", group: "chat", tier: "basic" },
  { slug: "gpt-image-2", displayName: "Image", provider: "openai", group: "image", tier: "basic" },
];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const frame = (event) => `data: ${JSON.stringify(event)}\n\n`;
const FINISH = { type: "finish", finishReason: "stop", messageMetadata: { usage: { inputTokens: 2, outputTokens: 9, reasoningTokens: 4 } } };
const REPLY = [
  { type: "start" }, { type: "start-step" }, { type: "reasoning-delta", id: "r", delta: "think" },
  { type: "text-start", id: "0" }, { type: "text-delta", id: "0", delta: "ha" }, { type: "text-delta", id: "0", delta: "ha" },
  { type: "text-delta", id: "0", delta: "", providerMetadata: {} }, { type: "text-end", id: "0" }, { type: "finish-step" }, FINISH,
].map(frame).join("") + "data: [DONE]\n\n";
const OPENAI_USAGE = { prompt_tokens: 2, completion_tokens: 9, total_tokens: 11, completion_tokens_details: { reasoning_tokens: 4 } };

/** Closed mock of the unified API; any other URL fails the request with a 404. */
function wire(reply = REPLY) {
  return vi.fn(async (url) => {
    if (String(url).includes("/tokens")) return json({ jwt: "minted" });
    if (url === `${API}/me`) return json({ user: {} });
    if (url === `${API}/models`) return json(CATALOG);
    if (url === `${API}/chat`) return new Response(reply);
    return json({}, 404);
  });
}
const run = (fetcher, { stream = false, body = { messages: [{ role: "user", content: "hi" }] } } = {}) =>
  new ChatPlaygroundExecutor(fetcher).execute({ model: MODEL, body, stream, credentials: { apiKey: COOKIE } });
const chatCall = (fetcher) => fetcher.mock.calls.find(([url]) => url === `${API}/chat`);
const chunksOf = (text) => text.split("\n\n").map((f) => f.slice(6)).filter((d) => d && d !== "[DONE]").map((d) => JSON.parse(d));

describe("port(omniroute): #20375 ChatPlayground unified web chat API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("points the registry at the unified web origin", () => {
    expect(provider.transport).toMatchObject({ baseUrl: `${API}/chat`, modelsUrl: `${API}/models`, validateUrl: `${API}/me` });
    expect(JSON.stringify(provider)).not.toContain("app.chatplayground.ai");
  });

  it("discovers slug rows, drops image rows, and still reads botId rows", async () => {
    await expect(discoverChatPlaygroundModels({ apiKey: COOKIE }, wire())).resolves.toEqual({ models: [{ id: MODEL, name: "ChatGPT-6 Luna" }] });
    vi.stubGlobal("fetch", vi.fn(async () => json([...CATALOG, { botId: "old-bot", modelName: "Old" }])));
    const found = await fetchConnectionModels({ id: "cp", provider: "chatplayground", apiKey: COOKIE });
    expect(found.models).toEqual([{ id: MODEL, name: "ChatGPT-6 Luna" }, { id: "old-bot", name: "Old" }]);
  });

  it("validates against /me with the current Clerk mint contract", async () => {
    const fetcher = wire();
    await expect(validateChatPlaygroundCookie(COOKIE, fetcher)).resolves.toEqual({ valid: true, status: 200 });
    const [[mintUrl, mint], [meUrl]] = fetcher.mock.calls;
    expect(mintUrl).toContain("__clerk_api_version=2026-08-20&_clerk_js_version=6.43.0");
    expect(mint.body).toBe("organization_id=&tab_state=visible&token=");
    expect(meUrl).toBe(`${API}/me`);
  });

  it("sends only the strict body, with history rendered into one message", async () => {
    const fetcher = wire();
    await run(fetcher, { body: { temperature: 0.2, max_tokens: 5, messages: [
      { role: "system", content: "be brief" }, { role: "assistant", content: "earlier" },
      { role: "user", content: [{ type: "text", text: "latest" }] },
    ] } });
    const payload = JSON.parse(chatCall(fetcher)[1].body);
    expect(payload).toEqual({
      modelSlug: MODEL, noSave: true, submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      message: { text: "Conversation history:\nsystem: be brief\nassistant: earlier\n\nReply to the last message.\nlatest" },
    });
  });

  it("buffers the event stream into one completion with usage and reasoning", async () => {
    const result = await run(wire());
    expect(await result.response.json()).toMatchObject({
      object: "chat.completion", model: MODEL, usage: OPENAI_USAGE,
      choices: [{ message: { role: "assistant", content: "haha", reasoning_content: "think" }, finish_reason: "stop" }],
    });
  });

  it("streams repeated deltas, reasoning and usage as Chat Completions chunks", async () => {
    const result = await run(wire(), { stream: true });
    const text = await result.response.text();
    const chunks = chunksOf(text);
    expect(chunks.map((c) => c.choices[0].delta.content ?? "").join("")).toBe("haha");
    expect(chunks.map((c) => c.choices[0].delta.reasoning_content ?? "").join("")).toBe("think");
    expect(chunks.at(-1)).toMatchObject({ choices: [{ finish_reason: "stop" }], usage: OPENAI_USAGE });
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("reassembles events split at any byte, including the last unterminated one", async () => {
    const bytes = new TextEncoder().encode(`${frame({ type: "text-delta", delta: "olá" })}data: ${JSON.stringify({ type: "finish", finishReason: "length" })}`);
    const source = new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    const chunks = chunksOf(await new Response(createUnifiedChatStream(source, MODEL)).text());
    expect(chunks[0].choices[0].delta.content).toBe("olá");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("length");
  });

  it.each([
    ["an in-band error frame", frame({ type: "error", errorText: "model overloaded" }), /model overloaded/],
    ["a stream with no finish event", frame({ type: "text-delta", delta: "partial" }), /ended before its finish event/],
    ["a non-stream body", "<html>gateway</html>", /ended before its finish event/],
  ])("never reports %s as a successful reply", async (_label, reply, message) => {
    const buffered = await run(wire(reply));
    expect(buffered.response.status).toBe(502);
    expect((await buffered.response.json()).error.message).toMatch(message);
    const streamed = await run(wire(reply), { stream: true });
    await expect(streamed.response.text()).rejects.toThrow(message);
  });

  it.each([
    ["an oversized message", [{ role: "user", content: "x".repeat(15_001) }], /Message at index 0/],
    ["an oversized transcript", [{ role: "user", content: "x".repeat(9_000) }, { role: "user", content: "y".repeat(9_000) }], /Serialized conversation/],
    ["inline image content", [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }], /image_url/],
  ])("rejects %s before any request", async (_label, messages, message) => {
    const fetcher = wire();
    const result = await run(fetcher, { body: { messages } });
    expect(result.response.status).toBe(400);
    expect((await result.response.json()).error.message).toMatch(message);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
