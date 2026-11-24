import { EventEmitter } from "node:events";
import { PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCursorModelCache,
  parseCursorUsableModels,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...await importOriginal(),
  proxyAwareFetch: vi.fn(async () => new Response(null, { status: 503 })),
}));

const http2Mock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("http2", () => ({ default: http2Mock, ...http2Mock }));

// Fake h2 client: answers the unary POST with `status` and `payload`.
function stubH2(status, payload) {
  const req = new EventEmitter();
  req.end = vi.fn(() => queueMicrotask(() => {
    req.emit("response", { ":status": status });
    req.emit("data", Buffer.from(payload));
    req.emit("end");
  }));
  const client = new EventEmitter();
  client.request = vi.fn(() => req);
  client.close = vi.fn();
  client.destroy = vi.fn();
  req.destroy = vi.fn();
  http2Mock.connect.mockReturnValue(client);
  return client;
}

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Uint8Array.from(bytes);
}

function field(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3) | 2, ...varint(value.length), ...value]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function model(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    clearCursorModelCache();
    vi.mocked(proxyAwareFetch).mockClear();
  });

  afterEach(() => {
    http2Mock.connect.mockReset();
    clearCursorModelCache();
  });

  it("decodes the GetUsableModels protobuf response", () => {
    const payload = concat(
      model("default", "Auto"),
      model("gpt-5.3-codex", "GPT 5.3 Codex"),
      model("gpt-5.3-codex", "Duplicate"),
    );

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "default", name: "Auto" },
      { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    ]);
  });

  it("fetches the account-specific catalog and caches it", async () => {
    const payload = concat(model("claude-4.6-opus", "Claude 4.6 Opus"));
    const client = stubH2(200, payload);
    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });
    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    expect(http2Mock.connect).toHaveBeenCalledTimes(1);
    expect(http2Mock.connect).toHaveBeenCalledWith("https://agent.api5.cursor.sh");
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      ":path": "/agent.v1.AgentService/GetUsableModels",
      "content-type": "application/proto",
      accept: "application/proto",
    }));
  });

  it("uses the configured JSON catalog endpoint and separates ghost-mode cache entries", async () => {
    stubH2(503, []);
    const config = PROVIDER_OAUTH.cursor;
    const originalEndpoint = config.apiEndpoint;
    config.apiEndpoint = "https://catalog.invalid/";
    try {
      vi.mocked(proxyAwareFetch)
        .mockResolvedValueOnce(Response.json({ models: ["private-model"] }))
        .mockResolvedValueOnce(Response.json({ models: ["shared-model"] }));
      const credentials = { accessToken: "synthetic", providerSpecificData: { machineId: "machine" } };
      const options = { proxyOptions: { disableEnvProxy: true } };
      await expect(resolveCursorModels(credentials, options)).resolves.toMatchObject({ models: [{ id: "auto" }, { id: "private-model" }] });
      credentials.providerSpecificData.ghostMode = false;
      await expect(resolveCursorModels(credentials, options)).resolves.toMatchObject({ models: [{ id: "auto" }, { id: "shared-model" }] });
      expect(proxyAwareFetch).toHaveBeenLastCalledWith(
        "https://catalog.invalid/aiserver.v1.AiService/AvailableModels",
        expect.objectContaining({ headers: expect.objectContaining({ "x-ghost-mode": "false" }) }),
        expect.any(Object),
      );
    } finally {
      config.apiEndpoint = originalEndpoint;
    }
  });

  it("discards oversized protobuf and JSON catalog responses", async () => {
    const client = stubH2(200, Buffer.alloc(1024 * 1024 + 1));
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(Response.json({ padding: "x".repeat(1024 * 1024), models: ["synthetic"] }));
    await expect(resolveCursorModels({
      accessToken: "synthetic",
      providerSpecificData: { machineId: "machine" },
    }, { proxyOptions: { disableEnvProxy: true } })).resolves.toBeNull();
    expect(client.request.mock.results[0].value.destroy).toHaveBeenCalled();
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("skips the live fetch (no direct socket) when a proxy applies", async () => {
    stubH2(200, concat(model("claude-4.6-opus", "Claude 4.6 Opus")));
    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    }, { proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9" } })).resolves.toBeNull();
    expect(http2Mock.connect).not.toHaveBeenCalled();
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      expect.stringContaining("/AvailableModels"),
      expect.objectContaining({ redirect: "error" }),
      expect.objectContaining({ connectionProxyUrl: "http://127.0.0.1:9", strictProxy: true }),
    );
  });

  it("keeps proxy-bound lookups separate from the direct catalog cache", async () => {
    stubH2(200, concat(model("claude-4.6-opus", "Claude 4.6 Opus")));
    const credentials = { accessToken: "cursor-token", providerSpecificData: { machineId: "machine-id" } };
    const direct = { proxyOptions: { disableEnvProxy: true } };
    const proxied = { proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9" } };

    await expect(resolveCursorModels(credentials, proxied)).resolves.toBeNull();
    await expect(resolveCursorModels(credentials, direct)).resolves.toEqual({ models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }] });
    await expect(resolveCursorModels(credentials, proxied)).resolves.toBeNull();
    expect(http2Mock.connect).toHaveBeenCalledTimes(1);
  });

  it("fails open when the Cursor catalog request fails", async () => {
    stubH2(403, "no");

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });

  it("negative-caches a failed lookup so repeated calls do not re-dial", async () => {
    stubH2(403, "no");
    const creds = { accessToken: "cursor-token", providerSpecificData: { machineId: "machine-id" } };

    await expect(resolveCursorModels(creds)).resolves.toBeNull();
    await expect(resolveCursorModels(creds)).resolves.toBeNull();
    expect(http2Mock.connect).toHaveBeenCalledTimes(1);

    await expect(resolveCursorModels(creds, { forceRefresh: true })).resolves.toBeNull();
    expect(http2Mock.connect).toHaveBeenCalledTimes(2);
  });

  it("destroys the h2 request and client when the lookup is aborted", async () => {
    const req = new EventEmitter();
    req.end = vi.fn();
    req.destroy = vi.fn();
    const client = new EventEmitter();
    client.request = vi.fn(() => req);
    client.close = vi.fn();
    client.destroy = vi.fn();
    http2Mock.connect.mockReturnValue(client);
    const controller = new AbortController();
    const pending = resolveCursorModels(
      { accessToken: "cursor-token", providerSpecificData: { machineId: "machine-id" } },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(req.end).toHaveBeenCalled());
    controller.abort();
    await expect(pending).resolves.toBeNull();
    expect(req.destroy).toHaveBeenCalled();
    expect(client.destroy).toHaveBeenCalled();
  });
});
