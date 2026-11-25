// Issue 2284: routes that re-implemented handler logic are thin wrappers over
// src/sse/handlers, and the chat keepalive wrapper has one home there. The wire
// assertions pin the /v1/completions body and headers from before the move.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handleChat: vi.fn() }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));

const { POST } = await import("../../src/app/api/v1/completions/route.js");
const { getRequestId } = await import("../../src/sse/utils/requestCorrelation.js");

const root = join(import.meta.dirname, "../..");
const read = (path) => readFileSync(join(root, path), "utf8");

const ROUTES = {
  "src/app/api/v1/completions/route.js": "@/sse/handlers/completions.js",
  "src/app/api/v1/messages/route.js": "@/sse/handlers/chat/keepalive.js",
  "src/app/api/v1/responses/route.js": "@/sse/handlers/chat/keepalive.js",
};
const ROUTE_IMPORTS = ["@/lib/http/cors.js", "@/sse/utils/requestCorrelation.js"];

function request(body) {
  return new Request("https://router.test/v1/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-key" },
    body,
  });
}

const upstreamHeaders = (contentType) => ({
  "content-type": contentType,
  "content-length": "999",
  "content-encoding": "identity",
  "access-control-allow-origin": "*",
  "x-upstream-marker": "kept",
});

beforeEach(() => mocks.handleChat.mockReset());

describe("thin v1 routes", () => {
  it.each(Object.entries(ROUTES))("%s only delegates to its handler", (path, handlerModule) => {
    const source = read(path);
    const imports = [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).toContain(handlerModule);
    expect(imports.filter((name) => name !== handlerModule && !ROUTE_IMPORTS.includes(name))).toEqual([]);
    expect(source).not.toMatch(/\b(admit|handleChat|requireJsonContentType|decodeAnthropicRequest|withEarlyStreamKeepalive|TransformStream)\b|\.json\(\)/);
  });

  it("applies the chat keepalive wrapper from exactly one module under src/", () => {
    const src = join(root, "src");
    const callers = readdirSync(src, { recursive: true })
      .filter((file) => file.endsWith(".js") && readFileSync(join(src, file), "utf8").includes("withEarlyStreamKeepalive("))
      .map((file) => relative(root, join(src, file)));
    expect(callers).toEqual(["src/sse/handlers/chat/keepalive.js"]);
    expect(read(callers[0]).match(/withEarlyStreamKeepalive\(/g)).toHaveLength(1);
  });
});

describe("POST /v1/completions wire shape", () => {
  it("forwards a chat-shaped request under the same request id and maps the JSON reply", async () => {
    mocks.handleChat.mockResolvedValue(new Response(JSON.stringify({
      id: "chatcmpl-abc",
      object: "chat.completion",
      created: 42,
      model: "openai/gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }), { headers: upstreamHeaders("application/json") }));
    const incoming = request(JSON.stringify({ model: "openai/gpt-4o", prompt: "hi", max_tokens: 8 }));

    const response = await POST(incoming);

    expect(mocks.handleChat).toHaveBeenCalledTimes(1);
    expect(mocks.handleChat.mock.calls[0]).toHaveLength(1);
    const forwarded = mocks.handleChat.mock.calls[0][0];
    expect(getRequestId(forwarded)).toBe(getRequestId(incoming));
    expect(forwarded.headers.get("authorization")).toBe("Bearer test-key");
    expect(await forwarded.json()).toEqual({
      model: "openai/gpt-4o", max_tokens: 8, messages: [{ role: "user", content: "hi" }],
    });
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "x-upstream-marker": "kept",
      "x-request-id": getRequestId(incoming),
    });
    expect(await response.text()).toBe(
      '{"id":"cmpl-abc","object":"text_completion","created":42,"model":"openai/gpt-4o",' +
      '"choices":[{"text":"hello","index":0,"logprobs":null,"finish_reason":"stop"}],' +
      '"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
    );
  });

  it("maps SSE frames and keeps [DONE]", async () => {
    const frame = { id: "chatcmpl-s", object: "chat.completion.chunk", created: 7, model: "m", choices: [{ index: 0, delta: { content: "yo" }, finish_reason: null }] };
    mocks.handleChat.mockResolvedValue(new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, {
      headers: upstreamHeaders("text/event-stream"),
    }));
    const incoming = request(JSON.stringify({ model: "m", prompt: ["hi"], stream: true }));

    const response = await POST(incoming);

    expect(Object.fromEntries(response.headers)).toEqual({
      "content-type": "text/event-stream",
      "access-control-allow-origin": "*",
      "x-upstream-marker": "kept",
      "x-request-id": getRequestId(incoming),
    });
    expect(await response.text()).toBe(
      'data: {"id":"cmpl-s","object":"text_completion","created":7,"model":"m",' +
      '"choices":[{"text":"yo","index":0,"logprobs":null,"finish_reason":null}]}\n\ndata: [DONE]\n\n',
    );
  });

  it.each([
    ["{", "Invalid JSON body"],
    [JSON.stringify({ model: "m" }), "Missing prompt"],
    [JSON.stringify({ model: "m", prompt: ["a", "b"] }), "multiple prompts not supported"],
  ])("answers 400 without dispatching for %s", async (body, message) => {
    const incoming = request(body);

    const response = await POST(incoming);

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(getRequestId(incoming));
    expect((await response.json()).error.message).toBe(message);
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });
});
