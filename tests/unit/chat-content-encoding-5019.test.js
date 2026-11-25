import * as zlib from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { decodeAnthropicRequest } from "../../src/sse/utils/inboundGzip.js";
import { getRequestId } from "../../src/sse/utils/requestCorrelation.js";

vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn() }));

const { POST: chat } = await import("../../src/app/api/v1/chat/completions/route.js");
const { POST: responses } = await import("../../src/app/api/v1/responses/route.js");
const { POST: compact } = await import("../../src/app/api/v1/responses/compact/route.js");

// Schema-invalid on purpose: the validator answers before auth, routing or any upstream call.
const json = JSON.stringify({ model: 123, messages: [] });
const request = (path, body, encoding, headers = {}) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(encoding ? { "content-encoding": encoding } : {}), ...headers },
  body,
});
const message = async (response) => (await response.json()).error.message;

describe("9router #5019 compressed JSON request bodies", () => {
  describe.each([
    ["/v1/chat/completions", chat],
    ["/v1/responses", responses],
    ["/v1/responses/compact", compact],
  ])("%s", (path, post) => {
    it.each([
      ["zstd", zlib.zstdCompressSync],
      ["gzip", zlib.gzipSync],
      ["br", zlib.brotliCompressSync],
      ["deflate", zlib.deflateSync],
    ])("decodes %s before validating the body", async (encoding, compress) => {
      const plain = await message(await post(request(path, json)));
      const response = await post(request(path, compress(json), encoding));

      expect(response.status).toBe(400);
      expect(plain).not.toBe("Invalid JSON body");
      expect(await message(response)).toBe(plain);
    });

    it("answers 400 for a corrupt body", async () => {
      const response = await post(request(path, "broken", "zstd"));
      expect(response.status).toBe(400);
      expect(await message(response)).toBe("Invalid JSON body");
    });

    it("answers 415 for an unknown or stacked encoding", async () => {
      for (const encoding of ["compress", "gzip, zstd"]) {
        expect((await post(request(path, json, encoding))).status).toBe(415);
      }
    });

    it("answers 413 when the decoded body exceeds the single-request limit", async () => {
      const bomb = zlib.zstdCompressSync(Buffer.alloc(16 * 1024 * 1024 + 1, 32));
      expect((await post(request(path, bomb, "zstd"))).status).toBe(413);
    });
  });

  it("hands on a plain request with the same request id and no representation headers", async () => {
    const bytes = zlib.zstdCompressSync(json);
    const original = request("/v1/responses", bytes, " ZSTD ", { "content-length": String(bytes.length), authorization: "Bearer fixture" });
    const requestId = getRequestId(original);
    const { request: decoded } = await decodeAnthropicRequest(original);

    expect(await decoded.text()).toBe(json);
    expect(decoded.headers.get("content-encoding")).toBeNull();
    expect(decoded.headers.get("content-length")).toBeNull();
    expect(decoded.headers.get("authorization")).toBe("Bearer fixture");
    expect(getRequestId(decoded)).toBe(requestId);
  });
});
