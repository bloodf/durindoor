import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
  isOperatorRequest: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: mocks.getApiKeys,
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: mocks.isOperatorRequest,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const originalFetch = global.fetch;

describe("model test route kind routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiKeys.mockResolvedValue([{ key: "sk-internal", isActive: true }]);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      created: 1,
      data: [{ b64_json: "abc" }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("routes image model tests to /api/v1/images/generations", async () => {
    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "hf/black-forest-labs/FLUX.1-schnell",
        kind: "image",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/images/generations"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "hf/black-forest-labs/FLUX.1-schnell",
          prompt: "test",
        }),
      })
    );
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["x-9r-cli-token"]).toBe("cli-token");
  });

  it("forwards connectionId as x-connection-id for an operator", async () => {
    mocks.isOperatorRequest.mockResolvedValue(true);
    const { POST } = await import("../../src/app/api/models/test/route.js");
    await POST(new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o", kind: "llm", connectionId: " conn-2 " }),
    }));
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers["x-connection-id"]).toBe("conn-2");
    expect(headers["x-9r-cli-token"]).toBe("cli-token");
  });

  it("refuses connectionId from a non-operator (e.g. API key) without probing", async () => {
    mocks.isOperatorRequest.mockResolvedValue(false);
    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o", connectionId: "conn-2" }),
    }));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("omits x-connection-id when none requested, without needing operator", async () => {
    mocks.isOperatorRequest.mockResolvedValue(false);
    const { POST } = await import("../../src/app/api/models/test/route.js");
    await POST(new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o" }),
    }));
    expect(global.fetch.mock.calls[0][1].headers["x-connection-id"]).toBeUndefined();
  });

  it.each(["", "   ", 42, null])("rejects invalid connectionId %j", async (connectionId) => {
    mocks.isOperatorRequest.mockResolvedValue(true);
    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o", connectionId }),
    }));
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("batch: pins every probe to connectionId for an operator, 403 otherwise", async () => {
    const { POST } = await import("../../src/app/api/models/test/batch/route.js");
    const mk = (body) => new Request("http://localhost/api/models/test/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const models = [{ model: "openai/a", kind: "llm" }, { model: "openai/b", kind: "llm" }];

    mocks.isOperatorRequest.mockResolvedValue(true);
    await (await POST(mk({ models, connectionId: "conn-2" }))).text();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    for (const call of global.fetch.mock.calls) expect(call[1].headers["x-connection-id"]).toBe("conn-2");

    global.fetch.mockClear();
    mocks.isOperatorRequest.mockResolvedValue(false);
    const denied = await POST(mk({ models, connectionId: "conn-2" }));
    expect(denied.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();

    expect((await POST(mk({ models, connectionId: "  " }))).status).toBe(400);
  });

  it("routes embedding model tests to /api/v1/embeddings", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2] }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "voyage/voyage-3-large",
        kind: "embedding",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/embeddings"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "voyage/voyage-3-large",
          input: "test",
        }),
      })
    );
  });

  it("fails embedding model tests when provider returns no embedding data", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ embedding: null }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "voyage/voyage-3-large",
        kind: "embedding",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.error).toBe("Provider returned no embedding data");
  });

  it("routes stt model tests to /api/v1/audio/transcriptions", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: "test",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "hf/openai/whisper-small",
        kind: "stt",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/audio/transcriptions"),
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      })
    );
  });

  it("returns formatted HTTP errors for non-2xx embedding responses", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "bad upstream" },
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    }));

    const { POST } = await import("../../src/app/api/models/test/route.js");

    const req = new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "voyage/voyage-3-large",
        kind: "embedding",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.status).toBe(502);
    expect(body.error).toBe("HTTP 502: bad upstream");
  });
});
