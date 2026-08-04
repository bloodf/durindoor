// transformToOllama: SSE→NDJSON conversion preserved, raw Ollama NDJSON
// passthrough added (port of decolua/9router #2541). The Ollama-compat
// `/api/chat` route can receive EITHER an OpenAI SSE body OR native Ollama
// NDJSON mislabeled `text/event-stream` (ollama-local backend passthrough),
// so the transform sniffs each line instead of trusting content-type.
import { describe, it, expect } from "vitest";
import { transformToOllama } from "../../open-sse/utils/ollamaTransform.js";
import { ollamaToOpenAIResponse } from "../../open-sse/translator/response/ollama-to-openai.js";

const enc = new TextEncoder();

function sseResponse(lines, { chunkSplit = false } = {}) {
  const text = lines.join("\n") + "\n";
  const bytes = enc.encode(text);
  let body;
  if (chunkSplit) {
    // Split INSIDE the multi-byte UTF-8 encoding of "→" (3 bytes: 0xE2 0x86 0x92)
    // so a broken sequence straddles two chunks — exercises the streaming decoder.
    const arrow = bytes.indexOf(0xe2);
    if (arrow < 0) throw new Error("test fixture must contain a multi-byte char");
    body = new ReadableStream({
      start(c) {
        c.enqueue(bytes.slice(0, arrow + 1)); // first byte of →
        c.enqueue(bytes.slice(arrow + 1, arrow + 3)); // last two bytes of →
        c.enqueue(bytes.slice(arrow + 3));
        c.close();
      },
    });
  } else {
    body = new ReadableStream({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    });
  }
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function readLines(response) {
  const text = await response.text();
  return text.split("\n").filter(Boolean);
}

describe("transformToOllama — SSE conversion path (pre-existing behavior)", () => {
  it("converts data: chunks to Ollama message lines and ends with one terminal done:true", async () => {
    const res = transformToOllama(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}',
        "data: [DONE]",
      ]),
      "llama3.2",
    );
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    const lines = await readLines(res);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({ model: "llama3.2", message: { role: "assistant", content: "Hello" }, done: false });
    expect(JSON.parse(lines[1])).toEqual({ model: "llama3.2", message: { role: "assistant", content: " world" }, done: false });
    expect(JSON.parse(lines[2])).toMatchObject({ done: true });
  });

  it("forwards OpenAI reasoning_content as Ollama thinking", async () => {
    const res = transformToOllama(
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"think"},"finish_reason":null}]}',
        "data: [DONE]",
      ]),
      "qwen3",
    );

    const lines = await readLines(res);
    expect(JSON.parse(lines[0])).toEqual({
      model: "qwen3",
      message: { role: "assistant", content: "", thinking: "think" },
      done: false,
    });
  });

  it("ignores SSE control lines (event:, comments, blanks) without emitting anything", async () => {
    const res = transformToOllama(
      sseResponse([
        "event: message",
        ": keep-alive comment",
        "",
        'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}',
        "data: [DONE]",
      ]),
      "m",
    );
    const lines = await readLines(res);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).message.content).toBe("hi");
    expect(JSON.parse(lines[1])).toMatchObject({ done: true });
  });

  it("finish_reason stop emits terminal once — flush must not duplicate it", async () => {
    const res = transformToOllama(
      sseResponse(['data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}']),
      "m",
    );
    const lines = await readLines(res);
    const doneLines = lines.filter((l) => JSON.parse(l).done === true);
    expect(doneLines).toHaveLength(1);
  });

  it("handles content split across chunks (arbitrary byte splits)", async () => {
    const res = transformToOllama(
      sseResponse(
        ['data: {"choices":[{"delta":{"content":"héllo →"},"finish_reason":null}]}', "data: [DONE]"],
        { chunkSplit: true },
      ),
      "m",
    );
    const lines = await readLines(res);
    expect(JSON.parse(lines[0]).message.content).toBe("héllo →");
    expect(JSON.parse(lines[1])).toMatchObject({ done: true });
  });
});

describe("transformToOllama — native Ollama NDJSON passthrough (#2541)", () => {
  it("forwards raw NDJSON lines unchanged even when labeled text/event-stream", async () => {
    const upstream = [
      '{"model":"llama3.2","message":{"role":"assistant","content":"Hello"},"done":false}',
      '{"model":"llama3.2","message":{"role":"assistant","content":"!"},"done":false}',
      '{"model":"llama3.2","message":{"role":"assistant","content":""},"done":true,"total_duration":123}',
    ];
    const res = transformToOllama(sseResponse(upstream), "llama3.2");
    const lines = await readLines(res);
    expect(lines).toEqual(upstream); // byte-for-byte, including the real done:true with stats
  });

  it("emits no synthetic done:true after an upstream done:true", async () => {
    const res = transformToOllama(
      sseResponse([
        '{"model":"m","message":{"role":"assistant","content":"x"},"done":false}',
        '{"model":"m","message":{"role":"assistant","content":""},"done":true}',
      ]),
      "m",
    );
    const lines = await readLines(res);
    expect(lines).toHaveLength(2);
  });

  it("forwards an upstream error frame and does NOT append a fake done:true", async () => {
    const res = transformToOllama(
      sseResponse(['{"error":"model \\"nope\\" not found, try pulling it first"}']),
      "nope",
    );
    const lines = await readLines(res);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ error: 'model "nope" not found, try pulling it first' });
  });

  it("normalizes an SSE data: error object to an Ollama-native error string", async () => {
    const res = transformToOllama(
      sseResponse(['data: {"error":{"message":"model missing","type":"invalid_request_error","code":"model_not_found"}}']),
      "missing",
    );
    const lines = await readLines(res);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ error: "model missing" });
  });

  it("normalizes a bare internal {error:{...}} frame to an Ollama-native error string", async () => {
    const res = transformToOllama(
      sseResponse(['{"error":{"message":"bad gateway","type":"server_error","code":"internal_server_error"}}']),
      "gate",
    );
    const lines = await readLines(res);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ error: "bad gateway" });
  });

  it("forwards an SSE data: Ollama-native {error:string} frame unchanged", async () => {
    const res = transformToOllama(
      sseResponse(['data: {"error":"native ollama error"}']),
      "native",
    );
    const lines = await readLines(res);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ error: "native ollama error" });
  });

  it("forwards a final NDJSON line that has no trailing newline (flush processes residual buffer)", async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('{"model":"m","message":{"role":"assistant","content":"end"},"done":true}'));
        c.close();
      },
    });
    const res = transformToOllama(new Response(body, { status: 200 }), "m");
    const lines = await readLines(res);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).done).toBe(true);
  });

  it("preserves the upstream HTTP status on the NDJSON response", async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('{"error":"not found"}'));
        c.close();
      },
    });
    const res = transformToOllama(new Response(body, { status: 404 }), "m");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    const lines = await readLines(res);
    expect(JSON.parse(lines[0])).toEqual({ error: "not found" });
  });

  it("converts a buffered OpenAI chat completion (stream:false path) to a native Ollama response", async () => {
    // The route returns `handleChat(request)` through this transform even for
    // stream:false, where the body is ONE OpenAI chat-completion JSON object.
    // It must be projected to the Ollama non-stream shape, not dropped into an
    // empty synthetic done (Codex P2 review on #2541).
    const res = transformToOllama(
      sseResponse([
        '{"id":"chatcmpl-1","object":"chat.completion","created":1700000000,"model":"gpt-x","choices":[{"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}',
      ]),
      "gpt-x",
    );
    const lines = await readLines(res);
    expect(lines).toHaveLength(1);
    const out = JSON.parse(lines[0]);
    expect(out.message).toEqual({ role: "assistant", content: "hi" });
    expect(out.done).toBe(true);
    expect(out.prompt_eval_count).toBe(3);
    expect(out.eval_count).toBe(1);
  });

  it("drops arbitrary non-Ollama bare JSON objects and emits only the synthetic terminal", async () => {
    // Arbitrary JSON that is neither an Ollama NDJSON object nor an OpenAI
    // completion must not leak to Ollama clients as a mixed-format line
    // (Codex P2 review on #2541).
    const res = transformToOllama(
      sseResponse([
        '{"foo":"bar"}',
        '[1,2,3]',
        '{"model":"m","message":{"role":"assistant","content":"real"},"done":false}',
      ]),
      "m",
    );
    const lines = await readLines(res);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).message.content).toBe("real");
    const terminal = JSON.parse(lines[1]);
    expect(terminal.done).toBe(true);
    expect(terminal.message).toEqual({ role: "assistant", content: "" });
  });
});

// Translator-level regression: an Ollama `{error: ...}` frame inside a 200
// NDJSON stream must surface as an OpenAI error finish, not be dropped into an
// empty/unterminated success stream (Codex P2 review on #2541).
describe("ollamaToOpenAIResponse — upstream error frames (#2541)", () => {
  it("returns a finish_reason 'error' chunk and records state.upstreamError as a message object", () => {
    const state = {};
    const out = ollamaToOpenAIResponse({ model: "llama3.2", error: "model not found" }, state);
    expect(out).not.toBeNull();
    expect(out.choices[0].finish_reason).toBe("error");
    expect(state.upstreamError).toEqual({ message: "model not found" });
    expect(state.finishReason).toBe("error");
  });
});
