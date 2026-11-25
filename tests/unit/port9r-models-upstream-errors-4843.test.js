import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routedFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: routedFetch,
}));

import { getProviderConnectionById } from "@/lib/localDb";
import { classifyUpstreamError } from "../../open-sse/utils/error.js";
import { GET } from "../../src/app/api/providers/[id]/models/route.js";

const failure = (code) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
const call = () => GET(new Request("http://localhost/api/providers/c1/models"), { params: Promise.resolve({ id: "c1" }) });
const connect = (provider, extra = {}) =>
  getProviderConnectionById.mockResolvedValue({ id: "c1", provider, apiKey: "test-key", ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline test"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("port(upstream) #4843: upstream failures during model discovery", () => {
  it.each(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"])(
    "classifies %s as a 504 timeout", (code) => {
      expect(classifyUpstreamError(failure(code))).toMatchObject({ status: 504, code: "UPSTREAM_TIMEOUT" });
    });

  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED"])(
    "classifies %s as a 502 unreachable upstream", (code) => {
      expect(classifyUpstreamError(failure(code))).toMatchObject({ status: 502, code: "UPSTREAM_UNREACHABLE" });
    });

  it("names a DOMException timeout instead of its numeric legacy code", () => {
    expect(classifyUpstreamError(new DOMException("aborted", "TimeoutError"))).toEqual({
      status: 504, code: "UPSTREAM_TIMEOUT", message: "Upstream provider timed out (TimeoutError)",
    });
  });

  it("keeps unknown and malformed failures at 500", () => {
    for (const bad of [new Error("parser exploded"), undefined, null, "boom", 42, {}]) {
      expect(classifyUpstreamError(bad)).toMatchObject({ status: 500, code: "UPSTREAM_FETCH_FAILED" });
    }
  });

  it("sanitizes the message of an unclassified failure", () => {
    expect(classifyUpstreamError(new Error("bad header Bearer abcdef123456")).message).not.toContain("abcdef123456");
  });

  it.each([
    ["openai", {}],
    ["openai-compatible-chat-test", { providerSpecificData: { baseUrl: "https://api.example.com/v1" } }],
  ])("answers 502 for an unreachable %s upstream and bounds the request", async (provider, extra) => {
    connect(provider, extra);
    routedFetch.mockRejectedValue(failure("ECONNREFUSED"));
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Upstream provider unreachable (ECONNREFUSED)", code: "UPSTREAM_UNREACHABLE" });
    expect(routedFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("answers 504 when a registry modelsFetcher times out", async () => {
    connect("qiniu");
    routedFetch.mockRejectedValue(new DOMException("aborted", "TimeoutError"));
    const res = await call();
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ code: "UPSTREAM_TIMEOUT" });
  });

  it("aborts a hung upstream once the discovery deadline passes", async () => {
    connect("openai");
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    routedFetch.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
      deadline.abort(new DOMException("deadline", "TimeoutError"));
    }));
    const res = await call();
    expect(res.status).toBe(504);
    expect(timeout).toHaveBeenCalledWith(8000);
  });

  it("still reports an internal failure as 500", async () => {
    connect("openai");
    routedFetch.mockRejectedValue(new Error("catalog parser exploded"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "catalog parser exploded", code: "UPSTREAM_FETCH_FAILED" });
  });
});
