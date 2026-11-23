import { describe, it, expect, vi } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

const proxyMocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: proxyMocks.fetch }));

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = (checksum >>> 8) ^ CRC32_TABLE[(checksum ^ byte) & 0xff];
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function createMockFrame(eventType, payloadObj) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const headerNameBytes = new TextEncoder().encode(":event-type");
  const headerValueBytes = new TextEncoder().encode(eventType);
  const headerLength = 1 + headerNameBytes.length + 1 + 2 + headerValueBytes.length;
  const totalLength = 12 + headerLength + payloadBytes.length + 4;
  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headerLength, false);
  view.setUint32(8, crc32(buffer.subarray(0, 8)), false);
  let offset = 12;
  buffer[offset++] = headerNameBytes.length;
  buffer.set(headerNameBytes, offset);
  offset += headerNameBytes.length;
  buffer[offset++] = 7; // String type
  view.setUint16(offset, headerValueBytes.length, false);
  offset += 2;
  buffer.set(headerValueBytes, offset);
  offset += headerValueBytes.length;
  buffer.set(payloadBytes, offset);
  view.setUint32(totalLength - 4, crc32(buffer.subarray(0, totalLength - 4)), false);
  return buffer;
}

async function readAllSSE(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output;
}

function parseSSEObjects(output) {
  return output
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)));
}

function framesStream(frames) {
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  });
}

describe("Kiro parity: estimated usage", () => {
  it.each([true, false])("splits context total when metering is present: %s", async (metering) => {
    const frames = [
      createMockFrame("assistantResponseEvent", { content: "12345678" }),
      createMockFrame("contextUsageEvent", { contextUsagePercentage: 12 }),
      createMockFrame("messageStopEvent", {}),
    ];
    if (metering) frames.push(createMockFrame("meteringEvent", { usage: 0.01, unit: "credit" }));
    const response = new KiroExecutor().transformEventStreamToSSE({ body: framesStream(frames) }, "claude-test");
    const objects = parseSSEObjects(await readAllSSE(response.body));
    const usage = objects.find((object) => object.usage)?.usage;
    expect(usage).toMatchObject({ prompt_tokens: 23998, completion_tokens: 2, total_tokens: 24000, estimated: true });
  });
});

describe("Kiro parity: refresh routing", () => {
  it("uses social refresh for imported credentials even with an OIDC registration", async () => {
    const { KiroService } = await import("../../src/lib/oauth/services/kiro.js");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ accessToken: "fresh" }), { status: 200 }));
    try {
      const result = await new KiroService().refreshToken("social-token", { authMethod: "imported", clientId: "id", clientSecret: "secret" });
      expect(fetchMock.mock.calls[0][0]).toBe("https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken");
      expect(result).toMatchObject({ accessToken: "fresh", refreshToken: "social-token", expiresIn: 3600 });
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe("Kiro parity: usage limits", () => {
  it.each([
    [{ overageEnabled: true }, true],
    [{ overageConfiguration: { overageStatus: "enabled" } }, true],
    [{}, false],
  ])("reports overage configuration %j", async (overage, unlimited) => {
    const { getKiroUsage } = await import("../../open-sse/services/usage/kiro.js");
    const fetchMock = proxyMocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      ...overage,
      usageBreakdownList: [{ resourceType: "AGENTIC_REQUEST", currentUsageWithPrecision: 12, usageLimitWithPrecision: 10 }],
    }), { status: 200 }));
    try {
      const result = await getKiroUsage("token", { authMethod: "api_key" });
      expect(result.quotas.agentic_request).toMatchObject({ used: 12, total: 10, unlimited });
      if (unlimited) expect(result.quotas.agentic_request.remainingPercentage).toBe(100);
    } finally {
      fetchMock.mockReset();
    }
  });
  it("explains a missing usage breakdown", async () => {
    const { getKiroUsage } = await import("../../open-sse/services/usage/kiro.js");
    const fetchMock = proxyMocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    try {
      const result = await getKiroUsage("token", { authMethod: "api_key" });
      expect(result.message).toContain("no usage breakdown");
      expect(result.quotas).toEqual({});
    } finally {
      fetchMock.mockReset();
    }
  });
});

describe("Kiro parity: API key validation", () => {
  it("finds the accepting region even when profile discovery is denied", async () => {
    const { KiroService } = await import("../../src/lib/oauth/services/kiro.js");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("denied", { status: 403 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValue(new Response("denied", { status: 403 }));
    try {
      const credential = await new KiroService().validateApiKey("test-key");
      expect(credential).toMatchObject({ region: "eu-central-1", profileArn: null, authMethod: "api_key" });
      expect(fetchMock.mock.calls[0][0]).toContain("q.us-east-1.amazonaws.com/ListAvailableModels");
      expect(fetchMock.mock.calls[1][0]).toContain("q.eu-central-1.amazonaws.com/ListAvailableModels");
      expect(fetchMock.mock.calls[1][1].headers.tokentype).toBe("API_KEY");
    } finally { fetchMock.mockRestore(); }
  });
});

describe("Kiro parity: branded gateway fallback", () => {
  it.each([
    [403, "denied", true],
    [400, "profileArn is required for this request", true],
    [400, "Improperly formed request", true],
    [400, "invalid model", false],
  ])("handles gateway HTTP %s (%s)", async (status, message, fallback) => {
    proxyMocks.fetch.mockReset()
      .mockResolvedValueOnce(new Response(message, { status }))
      .mockResolvedValueOnce(new Response(framesStream([createMockFrame("messageStopEvent", {}), createMockFrame("meteringEvent", { usage: 0.01 }), createMockFrame("contextUsageEvent", { contextUsagePercentage: 1 })]), { status: 200 }));
    const executor = new KiroExecutor();
    const result = await executor.execute({
      model: "claude-test", stream: false,
      body: { profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/test" },
      credentials: { accessToken: "token", providerSpecificData: { authMethod: "google" } },
    });
    expect(proxyMocks.fetch).toHaveBeenCalledTimes(fallback ? 2 : 1);
    expect(result.response.status).toBe(fallback ? 200 : status);
    if (!fallback) expect(await result.response.text()).toBe(message);
  });
});

describe("Kiro parity: social device protocol", () => {
  it("uses the device endpoints and preserves slow_down", async () => {
    const { KiroService } = await import("../../src/lib/oauth/services/kiro.js");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ deviceCode: "device", verificationUriComplete: "https://example.test/verify" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "slow_down" })));
    try {
      const service = new KiroService();
      await service.startSocialDevice("github");
      expect(fetchMock.mock.calls[0][0]).toContain("/oauth/device/authorization");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ clientId: "kiro-cli", loginProvider: "Github" });
      expect(await service.pollSocialDevice("device")).toEqual({ pending: true, error: "slow_down" });
      expect(fetchMock.mock.calls[1][0]).toContain("/oauth/device/poll");
    } finally { fetchMock.mockRestore(); }
  });
});

describe("Kiro parity: API key runtime", () => {
  it("uses only the regional Amazon Q runtime", async () => {
    proxyMocks.fetch.mockReset().mockResolvedValue(new Response("unavailable", { status: 403 }));
    const result = await new KiroExecutor().execute({
      model: "claude-test", stream: false,
      body: {}, credentials: { accessToken: "key", providerSpecificData: { authMethod: "api_key", region: "eu-central-1" } },
    });
    expect(proxyMocks.fetch).toHaveBeenCalledTimes(1);
    expect(proxyMocks.fetch.mock.calls[0][0]).toBe("https://q.eu-central-1.amazonaws.com/generateAssistantResponse");
    expect(result.response.status).toBe(403);
  });
});
