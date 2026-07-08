import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { probeNoAuthLocalProvider } from "../../src/app/api/providers/validate/route.js";

const originalFetch = global.fetch;

describe("probeNoAuthLocalProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("probes /models with bearer auth header when apiKey is provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    const result = await probeNoAuthLocalProvider("http://localhost:1234/v1", "local-key");

    expect(result).toEqual({ valid: true, error: null });
    const [, init] = fetch.mock.calls[0];
    expect(init?.headers).toEqual({ Authorization: "Bearer local-key" });
  });

  it("probes /models without auth header and accepts OK responses", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    const result = await probeNoAuthLocalProvider("http://localhost:1234/v1");

    expect(result).toEqual({ valid: true, error: null });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:1234/v1/models",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const [, init] = fetch.mock.calls[0];
    expect(init?.headers).toBeUndefined();
  });

  it("rejects non-OK /models responses", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const result = await probeNoAuthLocalProvider("http://localhost:1234/v1");
    expect(result).toEqual({ valid: false, error: "Endpoint unreachable or rejected" });
  });

  it("rejects network failures", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed"));

    const result = await probeNoAuthLocalProvider("http://localhost:1234/v1");
    expect(result).toEqual({ valid: false, error: "fetch failed" });
  });

  it("strips /api/chat suffix from Ollama-style base URL", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    await probeNoAuthLocalProvider("http://localhost:11434/api/chat");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/models",
      expect.anything(),
    );
  });

  it("returns error when baseUrl is empty", async () => {
    const result = await probeNoAuthLocalProvider("");
    expect(result).toEqual({ valid: false, error: "Base URL required for no-auth provider" });
  });
});
