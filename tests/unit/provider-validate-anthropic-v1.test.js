import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  guardedProbeFetch: vi.fn(),
  getProviderNodeById: vi.fn(),
}));

vi.mock("open-sse/utils/outboundUrlGuard.js", () => ({
  guardedProbeFetch: mocks.guardedProbeFetch,
  OutboundUrlGuardError: class OutboundUrlGuardError extends Error {},
}));

vi.mock("@/models", () => ({
  getProviderNodeById: mocks.getProviderNodeById,
}));

import { POST } from "../../src/app/api/providers/validate/route.js";

function postRequest(body) {
  return new Request("http://localhost/api/providers/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/providers/validate - Anthropic-compatible /v1 normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips /v1 suffix before appending /v1/messages", async () => {
    mocks.getProviderNodeById.mockResolvedValue({
      id: "anthropic-compatible-norm",
      baseUrl: "https://api.example.com/v1",
      defaultModel: "claude-3-haiku-20240307",
    });
    mocks.guardedProbeFetch.mockResolvedValue({ status: 200 });

    const res = await POST(postRequest({
      provider: "anthropic-compatible-norm",
      apiKey: "sk-test",
    }));
    const data = await res.json();

    expect(mocks.guardedProbeFetch).toHaveBeenCalledTimes(1);
    const [url] = mocks.guardedProbeFetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/messages");
    expect(data).toEqual({ valid: true, error: null });
  });

  it("strips /messages before stripping /v1 and appending /v1/messages", async () => {
    mocks.getProviderNodeById.mockResolvedValue({
      id: "anthropic-compatible-msg",
      baseUrl: "https://api.example.com/v1/messages",
      defaultModel: "claude-3-haiku-20240307",
    });
    mocks.guardedProbeFetch.mockResolvedValue({ status: 200 });

    await POST(postRequest({
      provider: "anthropic-compatible-msg",
      apiKey: "sk-test",
    }));

    const [url] = mocks.guardedProbeFetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/messages");
  });

  it("marks 401/403 as invalid", async () => {
    mocks.getProviderNodeById.mockResolvedValue({
      id: "anthropic-compatible-bad",
      baseUrl: "https://api.example.com/v1",
    });
    mocks.guardedProbeFetch.mockResolvedValue({ status: 401 });

    const res = await POST(postRequest({
      provider: "anthropic-compatible-bad",
      apiKey: "bad-key",
    }));
    const data = await res.json();

    expect(data).toEqual({ valid: false, error: "Invalid API key" });
  });
});

export {};
