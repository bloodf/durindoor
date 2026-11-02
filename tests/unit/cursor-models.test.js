import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCursorModelCache,
  parseCursorUsableModels,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";

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

  it("skips the live fetch (no direct socket) when a proxy applies", async () => {
    stubH2(200, concat(model("claude-4.6-opus", "Claude 4.6 Opus")));
    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    }, { proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9" } })).resolves.toBeNull();
    expect(http2Mock.connect).not.toHaveBeenCalled();
  });

  it("fails open when the Cursor catalog request fails", async () => {
    stubH2(403, "no");

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });
});
