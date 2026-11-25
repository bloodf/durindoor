import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { __setBypassTransportForTesting, createBypassRequest } from "../../open-sse/utils/proxyFetch.js";

function fakeTransport(headers) {
  const request = new EventEmitter();
  const response = Object.assign(new PassThrough(), { statusCode: 200, statusMessage: "OK", headers });
  let respond;
  request.write = vi.fn();
  request.destroy = vi.fn();
  request.end = vi.fn(() => queueMicrotask(() => {
    respond(response);
    response.end("{}");
  }));
  const https = {
    request: vi.fn((_options, callback) => {
      respond = callback;
      return request;
    }),
  };
  return { https, tls: { checkServerIdentity: () => undefined } };
}

describe("port decolua/9router#4823: DNS-bypass response headers", () => {
  it("returns fetch Headers from the DNS-bypass transport", async () => {
    const restore = __setBypassTransportForTesting(fakeTransport({
      "content-type": "application/json",
      "set-cookie": ["a=1", "b=2"],
    }));
    try {
      const response = await createBypassRequest(new URL("https://bypass.test/v1"), "203.0.113.7", {});

      expect(response.headers).toBeInstanceOf(Headers);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(response.headers.has("CONTENT-TYPE")).toBe(true);
      expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    } finally {
      restore();
    }
  });
});
