import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const { isRetryableThrownError } = await import("../../open-sse/utils/thrownErrorRetry.js");

const run = () => new BaseExecutor("test", {
  baseUrls: ["https://a.invalid/api", "https://b.invalid/api"],
  retry: { 502: { attempts: 2, delayMs: 0 } },
}).execute({ model: "m", body: {}, stream: false, credentials: { apiKey: "k" } });

beforeEach(() => { fetchMock.mockReset(); }); // a returned mock would run as teardown

describe("OmniRoute #20416 - non-transient thrown errors are not retried", () => {
  it.each([
    new TypeError("Cannot read properties of undefined (reading 'network')"),
    new SyntaxError("Unexpected token"),
    new RangeError("Invalid string length"),
    new ReferenceError("x is not defined"),
  ])("surfaces $name on the first send without retry or URL fallback", async (failure) => {
    fetchMock.mockRejectedValue(failure);
    const error = await run().catch((caught) => caught);
    expect(error).toBe(failure);
    expect(error.errorKind).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    new TypeError("fetch failed"),
    new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }),
    new Error("socket hang up"),
    new Error("opaque transport failure"),
  ])("still retries $name: $message on every URL", async (failure) => {
    fetchMock.mockRejectedValue(failure);
    const error = await run().catch((caught) => caught);
    expect(error.errorKind).toBe("network");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("keeps timeouts, transport codes and unknown values retryable", () => {
    expect(isRetryableThrownError(Object.assign(new TypeError("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isRetryableThrownError(Object.assign(new TypeError("x"), { name: "TimeoutError" }))).toBe(true);
    expect(isRetryableThrownError(undefined)).toBe(true);
    expect(isRetryableThrownError(Object.assign(new TypeError("Invalid URL"), { code: "ERR_INVALID_URL" }))).toBe(false);
  });
});
