// Issue 2563: compressed bodies were decoded (up to 16 MiB each) before the client key check.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn() }));

const MiB = 1024 * 1024;
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let key;
let decode;
let routes;

// Schema-invalid on purpose: an admitted request stops at validation, before any routing.
const json = JSON.stringify({ model: 123, messages: [] });
// Random base64 compresses about 1.3:1, far below the ratio cap.
const incompressible = (bytes) => JSON.stringify({ pad: randomBytes(bytes).toString("base64").slice(0, bytes) });
const request = (body, { encoding = "br", apiKey, pathname = "/v1/chat/completions" } = {}) => new Request(`http://localhost${pathname}`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(encoding ? { "content-encoding": encoding } : {}),
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  },
  body,
});
const fast = (text) => zlib.brotliCompressSync(text, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } });

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-preauth-decode-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  key = (await db.createApiKey("preauth", "machine-1")).key;
  ({ decodeAnthropicRequest: decode } = await import("../../src/sse/utils/inboundGzip.js"));
  routes = {
    "/v1/chat/completions": (await import("../../src/app/api/v1/chat/completions/route.js")).POST,
    "/v1/responses": (await import("../../src/app/api/v1/responses/route.js")).POST,
    "/v1/responses/compact": (await import("../../src/app/api/v1/responses/compact/route.js")).POST,
    "/v1/messages": (await import("../../src/app/api/v1/messages/route.js")).POST,
    "/v1/messages/count_tokens": (await import("../../src/app/api/v1/messages/count_tokens/route.js")).POST,
  };
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  delete global._dbAdapter;
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("with requireApiKey on", () => {
  beforeAll(() => db.updateSettings({ requireApiKey: true }));

  it.each(["/v1/chat/completions", "/v1/responses", "/v1/responses/compact", "/v1/messages", "/v1/messages/count_tokens"])(
    "%s answers 401 to a missing or unknown key without decoding",
    async (pathname) => {
      const decompress = vi.spyOn(zlib, "brotliDecompress");
      for (const apiKey of [undefined, "sk-unknown"]) {
        const incoming = request(fast(json), { apiKey, pathname });
        const response = await routes[pathname](incoming);

        expect(response.status).toBe(401);
        expect(incoming.bodyUsed).toBe(false);
      }
      expect(decompress).not.toHaveBeenCalled();
    },
  );

  it("decodes for a valid key, up to the full ceiling", async () => {
    const decompress = vi.spyOn(zlib, "brotliDecompress");
    const body = incompressible(9 * MiB);
    const { request: decoded } = await decode(request(fast(body), { apiKey: key }));

    expect(await decoded.text()).toBe(body);
    expect(decompress).toHaveBeenCalledOnce();
  });

  it.each([
    ["br", zlib.brotliCompressSync],
    ["gzip", zlib.gzipSync],
    ["deflate", zlib.deflateSync],
    ["zstd", zlib.zstdCompressSync],
  ])("answers 413 to a %s ratio bomb even with a valid key", async (encoding, compress) => {
    const bomb = compress(Buffer.alloc(4 * MiB, 32));
    expect(4 * MiB / bomb.length).toBeGreaterThan(200);

    const { response } = await decode(request(bomb, { encoding, apiKey: key }));

    expect(response.status).toBe(413);
  });
});

describe("in local mode", () => {
  beforeAll(() => db.updateSettings({ requireApiKey: false }));

  it("holds a caller without a stored key to the lower ceiling", async () => {
    const compressed = fast(incompressible(9 * MiB));

    for (const apiKey of [undefined, "sk-placeholder"]) {
      expect((await decode(request(compressed, { apiKey }))).response.status).toBe(413);
    }
    expect((await decode(request(compressed, { apiKey: key }))).request).toBeDefined();
  });

  it("still decodes an anonymous body under that ceiling", async () => {
    const body = incompressible(MiB);
    const { request: decoded } = await decode(request(fast(body)));

    expect(await decoded.text()).toBe(body);
  });

  it.each([["plain", null], ["compressed", "br"]])("parses a %s Responses body once", async (_label, encoding) => {
    const parses = vi.spyOn(Request.prototype, "json");
    const response = await routes["/v1/responses"](request(encoding ? fast(json) : json, { encoding, pathname: "/v1/responses" }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).not.toBe("Invalid JSON body");
    expect(parses).toHaveBeenCalledOnce();
  });
});
