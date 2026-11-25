import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), count: vi.fn() }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: async (request) => {
  try { return await mocks.provider(await request.json(), request.headers, request.signal); }
  catch { return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 }); }
} }));
vi.mock("@/sse/handlers/countTokens.js", () => ({ handleCountTokens: async (request) => {
  try { return await mocks.count(await request.json(), request.headers); }
  catch { return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 }); }
} }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn() }));

const { POST: messages } = await import("../../src/app/api/v1/messages/route.js");
const { POST: countTokens } = await import("../../src/app/api/v1/messages/count_tokens/route.js");
const body = { model: "synthetic/model", max_tokens: 10, messages: [{ role: "user", content: "hello" }] };
const json = JSON.stringify(body);
function request(payload, encoding, headers = {}) {
  return new Request("http://localhost/v1/messages", { method: "POST", headers: { "content-type": "application/json", ...(encoding ? { "content-encoding": encoding } : {}), ...headers }, body: payload });
}

beforeEach(() => {
  mocks.provider.mockReset().mockResolvedValue(Response.json({ ok: true }));
  mocks.count.mockReset().mockResolvedValue(Response.json({ input_tokens: 1 }));
});

describe.each([["messages", messages, mocks.provider], ["count tokens", countTokens, mocks.count]])("%s inbound encoding", (_name, post, provider) => {
  it.each([undefined, "identity", "gzip", "x-gzip", "GZip"])("accepts %s JSON", async (encoding) => {
    const compressed = encoding && encoding.toLowerCase().includes("gzip");
    const response = await post(request(compressed ? gzipSync(json) : json, encoding));
    expect(response.status).toBe(200);
    expect(provider).toHaveBeenCalledOnce();
    expect(provider.mock.calls[0][0]).toEqual(body);
    if (compressed) {
      expect(provider.mock.calls[0][1].get("content-encoding")).toBeNull();
      expect(provider.mock.calls[0][1].get("content-length")).toBeNull();
    }
  });
  it.each(["br", "gzip, identity", "zstd"])("rejects %s", async (encoding) => {
    expect((await post(request(gzipSync(json), encoding))).status).toBe(415);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([Buffer.from("not gzip"), gzipSync(json).subarray(0, 12), gzipSync("not json")])("rejects malformed input", async (data) => {
    expect((await post(request(data, "gzip"))).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
  it("rejects a declared oversized compressed body", async () => {
    expect((await post(request(gzipSync(json), "gzip", { "content-length": String(64 * 1024 * 1024) }))).status).toBe(413);
    expect(provider).not.toHaveBeenCalled();
  });
  it("rejects an oversized expanded body", async () => {
    expect((await post(request(gzipSync(Buffer.alloc(16 * 1024 * 1024 + 1, 32)), "gzip"))).status).toBe(413);
    expect(provider).not.toHaveBeenCalled();
  });
  it("rejects oversized wire data without a declared length", async () => {
    expect((await post(request(Buffer.alloc(16 * 1024 * 1024 + 1), "gzip"))).status).toBe(413);
    expect(provider).not.toHaveBeenCalled();
  });
});

it("preserves an already aborted Messages request", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await messages(new Request("http://localhost/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "content-encoding": "gzip" },
    body: gzipSync(json), signal: controller.signal,
  }));
  expect(response.status).toBe(499);
  expect(mocks.provider).not.toHaveBeenCalled();
});
