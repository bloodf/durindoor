// #1217: 1min.ai executor (prompt-string wire, API-KEY header, event:/data: SSE).
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));

const { OneMinAiExecutor, buildPrompt, translateOneMinAiStream, ONEMINAI_CHAT_URL } = await import("../../open-sse/executors/oneminai.js");
const { getExecutor } = await import("../../open-sse/executors/index.js");
const { PROVIDERS } = await import("../../open-sse/config/providers.js");

const enc = new TextEncoder();
const streamOf = (...parts) => new ReadableStream({
  start(c) {
    for (const p of parts) c.enqueue(enc.encode(p));
    c.close();
  },
});
const readAll = async (stream) => {
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += new TextDecoder().decode(value);
  }
};
const deltas = (sse) => sse.split("\n\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)));

describe("oneminai registry and request shape", () => {
  it("is registered with its own executor and API-KEY auth", () => {
    expect(getExecutor("oneminai")).toBeInstanceOf(OneMinAiExecutor);
    expect(PROVIDERS.oneminai.baseUrl).toBe(ONEMINAI_CHAT_URL);
    const ex = new OneMinAiExecutor();
    expect(ex.buildHeaders({ apiKey: "k1" })).toEqual({ "Content-Type": "application/json", "API-KEY": "k1" });
    expect(ex.buildUrl("m", true)).toBe(`${ONEMINAI_CHAT_URL}?isStreaming=true`);
    expect(ex.buildUrl("m", false)).toBe(ONEMINAI_CHAT_URL);
  });

  it("passes a single user message through and flattens history", () => {
    expect(buildPrompt([{ role: "user", content: "hi" }])).toBe("hi");
    expect(buildPrompt([
      { role: "system", content: "be brief" },
      { role: "user", content: [{ type: "text", text: "q1" }] },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ])).toBe("System: be brief\n\nUser: q1\n\nAssistant: a1\n\nUser: q2");
    expect(new OneMinAiExecutor().transformRequest("gpt-4o-mini", { messages: [{ role: "user", content: "hi" }] }))
      .toEqual({ type: "UNIFY_CHAT_WITH_AI", model: "gpt-4o-mini", promptObject: { prompt: "hi" } });
  });
});

describe("execute", () => {
  beforeEach(() => fetchMock.mockReset());
  const run = (body, stream = false) => new OneMinAiExecutor().execute({ model: "gpt-4o-mini", body, stream, credentials: { apiKey: "k" }, signal: undefined });

  it("translates a JSON aiRecord into an OpenAI completion", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ aiRecord: { aiRecordDetail: { resultObject: ["Hel", "lo"] } } }), { status: 200 }));
    const { response, transformedBody, headers } = await run({ messages: [{ role: "user", content: "hi" }] });
    const json = await response.json();
    expect(json.choices[0].message).toEqual({ role: "assistant", content: "Hello" });
    expect(json.object).toBe("chat.completion");
    expect(transformedBody.promptObject.prompt).toBe("hi");
    expect(headers["API-KEY"]).toBe("k");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).type).toBe("UNIFY_CHAT_WITH_AI");
  });

  it("maps upstream errors to OpenAI error bodies with the upstream status", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }));
    const { response } = await run({ messages: [{ role: "user", content: "hi" }] });
    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toMatch(/Invalid API key/);
  });

  it("returns 502 on network failure", async () => {
    // Other modules (e.g. background UA refresh) share the mocked fetch: fail only 1min.ai.
    fetchMock.mockImplementation(async (url) => {
      if (String(url).startsWith(ONEMINAI_CHAT_URL)) throw new Error("ECONNRESET");
      return new Response("{}", { status: 200 });
    });
    const { response } = await run({ messages: [{ role: "user", content: "hi" }] });
    expect(response.status).toBe(502);
  });

  it("rejects tools and media instead of silently dropping them", async () => {
    for (const body of [
      { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "x" } }] },
      { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] }] },
    ]) {
      const { response } = await run(body);
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams content events as OpenAI chunks", async () => {
    fetchMock.mockResolvedValue(new Response(streamOf(
      'event: content\ndata: {"content":"Hel"}\n\n',
      'event: content\ndata: {"content":"lo"}\n\nevent: result\ndata: {}\n\n',
      "event: done\ndata: {}\n\n",
    ), { status: 200 }));
    const { response } = await run({ messages: [{ role: "user", content: "hi" }] }, true);
    const sse = await readAll(response.body);
    const chunks = deltas(sse);
    expect(chunks[0].choices[0].delta).toEqual({ role: "assistant" });
    expect(chunks.map((c) => c.choices[0].delta.content).filter(Boolean).join("")).toBe("Hello");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
    expect(sse.trim().endsWith("data: [DONE]")).toBe(true);
  });
});

describe("stream errors and cancel", () => {
  it("an error before content becomes an OpenAI error frame", async () => {
    const sse = await readAll(translateOneMinAiStream(streamOf('event: error\ndata: {"message":"quota exceeded"}\n\n'), "m", "id", 1));
    expect(deltas(sse)[0].error.message).toMatch(/quota exceeded/);
    expect(sse).toContain("data: [DONE]");
  });

  it("an error after content keeps the content then errors the stream", async () => {
    const reader = translateOneMinAiStream(streamOf('event: content\ndata: {"content":"partial"}\n\nevent: error\ndata: {}\n\n'), "m", "id", 1).getReader();
    let text = "";
    await expect((async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        text += new TextDecoder().decode(value);
      }
    })()).rejects.toThrow(/1min.ai upstream stream failed/);
    expect(text).toContain("partial");
  });

  it("downstream cancel cancels the upstream reader", async () => {
    const cancel = vi.fn();
    const upstream = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel });
    await translateOneMinAiStream(upstream, "m", "id", 1).cancel("client gone");
    expect(cancel).toHaveBeenCalled();
  });
});
