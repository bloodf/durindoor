/**
 * Issue #1170: offline acceptance boundary for cursor-api versus installed cursor/cu.
 * Cursor IDE uses account OAuth + machine ID and Connect/protobuf, not a public
 * OpenAI API. Mocked responses prove local wiring only, never account entitlement.
 * Static models and token-presence validation are metadata, not live discovery.
 * g4f, web relays and app-server transports do not establish native vendor support.
 * Keep cursor-api and unverified capabilities hidden pending account-backed proof.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Mock before executor imports: no release updater or MITM DNS transport runs.
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "offline-test",
  updateKimchiUserAgent: vi.fn(async () => "offline-test"),
}));
// Mock before proxy routing: api2.cursor.sh otherwise takes the MITM DNS bypass.
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...await importOriginal(),
  proxyAwareFetch: vi.fn((url, init) => globalThis.fetch(url, init)),
}));
import { CursorExecutor, __setCursorHttp2ForTesting } from "../../open-sse/executors/cursor.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { decodeMessage, encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

const mocks = vi.hoisted(() => ({ connection: vi.fn(), update: vi.fn(), proxy: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.connection,
  updateProviderConnection: mocks.update,
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.proxy }));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: vi.fn() }));

const credentials = {
  accessToken: "offline-cursor-token",
  providerSpecificData: { machineId: "offline-machine-id" },
};
const model = "default";
const body = {
  messages: [{ role: "user", content: "Read README.md" }],
  tools: [{ type: "function", function: {
    name: "lookup_document", description: "Read a file",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  } }],
};
const nativeUrl = "https://api2.cursor.sh/aiserver.v1.ChatService/StreamUnifiedChatWithTools";
let restoreHttp2;
let fetchMock;

function frame(fields) {
  return Buffer.from(wrapConnectRPCFrame(Buffer.concat(fields.map((field) => Buffer.from(field)))));
}

function textFrame(text) {
  return frame([encodeField(2, 2, encodeField(1, 2, text))]);
}

function toolFrame() {
  const call = Buffer.concat([
    encodeField(3, 2, "offline-call"),
    encodeField(9, 2, "lookup_document"),
    encodeField(10, 2, '{"path":"README.md"}'),
    encodeField(11, 0, 1),
  ].map((field) => Buffer.from(field)));
  return frame([encodeField(1, 2, call)]);
}

async function execute(stream = false) {
  return getExecutor("cursor").execute({ model, body, stream, credentials });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.proxy.mockResolvedValue({ connectionProxyEnabled: false, connectionProxyUrl: "", vercelRelayUrl: "" });
  mocks.update.mockResolvedValue(undefined);
  fetchMock = vi.fn(() => { throw new Error("Unexpected offline fetch"); });
  vi.stubGlobal("fetch", fetchMock);
  restoreHttp2 = __setCursorHttp2ForTesting(null);
});

afterEach(() => {
  restoreHttp2();
  vi.unstubAllGlobals();
});

describe("#1170 cursor-api native identity acceptance (offline partial)", () => {
  it("does not promote token presence or static models into candidate support", async () => {
    mocks.connection.mockResolvedValue({ id: "offline-cursor", provider: "cursor", authType: "oauth", ...credentials });
    expect(await testSingleConnection("offline-cursor")).toMatchObject({ valid: true, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getModelsByProviderId("cursor")).toContainEqual(expect.objectContaining({ id: model }));
    expect(await fetchConnectionModels({ provider: "cursor", ...credentials })).toEqual({
      error: "Provider cursor does not support models listing", status: 400,
    });

    mocks.connection.mockResolvedValue({ id: "offline-candidate", provider: "cursor-api", authType: "oauth", ...credentials });
    expect(await testSingleConnection("offline-candidate")).toMatchObject({ valid: false, error: "Provider test not supported" });
    expect(await fetchConnectionModels({ provider: "cursor-api", ...credentials })).toEqual({
      error: "Provider cursor-api does not support models listing", status: 400,
    });
    expect(AI_PROVIDERS["cursor-api"]).toBeUndefined();
    expect(getModelsByProviderId("cursor-api")).toEqual([]);
    expect(hasSpecializedExecutor("cursor-api")).toBe(false);
    expect(getExecutor("cu")).toBeInstanceOf(CursorExecutor);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["cursor-api", "fleet-unknown-cursor-api"])("rejects unsupported %s with 400 before credential or fetch dispatch", async (provider) => {
    const executor = getExecutor(provider);
    const buildHeaders = vi.spyOn(executor, "buildHeaders");
    // A successful mock exposes unsafe fallback dispatch without retry or network.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [] }), {
      headers: { "Content-Type": "application/json" },
    }));
    try {
      let urlError;
      try {
        executor.buildUrl(model, false, 0, credentials);
      } catch (error) {
        urlError = error;
      }
      expect.soft(urlError?.status).toBe(400);

      let executionStatus;
      try {
        const result = await executor.execute({
          model, body: structuredClone(body), stream: false, credentials,
        });
        executionStatus = result.response.status;
      } catch (error) {
        executionStatus = error.status;
      }
      expect.soft(executionStatus).toBe(400);
      expect.soft(buildHeaders).not.toHaveBeenCalled();
      expect.soft(fetchMock).not.toHaveBeenCalled();
    } finally {
      buildHeaders.mockRestore();
    }
  });

  it("sends native model/tool protobuf with account headers, not relay JSON", async () => {
    fetchMock.mockResolvedValue(new Response(textFrame("README contents")));
    const { response, url } = await execute();
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.content).toBe("README contents");
    expect(url).toBe(nativeUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0];
    expect(String(requestUrl)).toBe(nativeUrl);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: "Bearer offline-cursor-token",
      "content-type": "application/connect+proto",
      "connect-protocol-version": "1",
      "x-cursor-client-type": "ide",
      "x-ghost-mode": "true",
    });
    expect(init.headers["x-cursor-checksum"]).toMatch(/offline-machine-id$/);
    expect(init.body).toBeInstanceOf(Uint8Array);
    const wire = Buffer.from(init.body);
    expect(wire.readUInt32BE(1)).toBe(wire.length - 5);
    const envelope = decodeMessage(wire.subarray(5));
    const request = decodeMessage(envelope.get(1)[0].value);
    const wireModel = decodeMessage(request.get(5)[0].value);
    expect(Buffer.from(wireModel.get(1)[0].value).toString()).toBe(model);
    const message = decodeMessage(request.get(1)[0].value);
    expect(Buffer.from(message.get(1)[0].value).toString()).toBe(body.messages[0].content);
    expect(request.get(27)[0].value).toBe(1);
    expect(request.has(34)).toBe(true);
    expect(wire.toString()).toContain("lookup_document");
  });

  it("passes native tool identity and arguments through mocked fetch into SSE", async () => {
    fetchMock.mockResolvedValue(new Response(toolFrame()));
    const { response } = await execute(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const sse = await response.text();
    const events = sse.split("\n\n").filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => chunk.slice(6)).filter((data) => data !== "[DONE]").map(JSON.parse);
    const call = events.flatMap((event) => event.choices[0].delta.tool_calls || [])[0];
    expect(call).toMatchObject({ id: "offline-call", type: "function", function: {
      name: "lookup_document", arguments: '{"path":"README.md"}',
    } });
    expect(events.at(-1).choices[0].finish_reason).toBe("tool_calls");
    expect(sse.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects absent machine identity before sending account token", async () => {
    await expect(getExecutor("cursor").execute({ model, body, stream: false,
      credentials: { accessToken: credentials.accessToken },
    })).rejects.toThrow("Machine ID is required for Cursor API");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, true])("does not accept OpenAI relay JSON as native transport (stream=%s)", async (stream) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      object: "chat.completion", choices: [{ message: { content: "relay answer" }, finish_reason: "stop" }],
    }), { headers: { "Content-Type": "application/json" } }));
    const { response } = await execute(stream);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { type: "stream_error", code: "incomplete_stream" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a native quota error frame without advertising successful streaming", async () => {
    const error = Buffer.from(JSON.stringify({ error: {
      code: "resource_exhausted", message: "Offline quota exhausted",
    } }));
    fetchMock.mockResolvedValue(new Response(Buffer.from(wrapConnectRPCFrame(error))));
    const { response } = await execute(true);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: {
      message: "Offline quota exhausted", type: "rate_limit_error", code: "unknown",
    } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves rejected account status without exposing upstream body", async () => {
    fetchMock.mockResolvedValue(new Response("private upstream account detail", { status: 401 }));
    const { response } = await execute();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: {
      message: "Cursor upstream returned HTTP 401", type: "invalid_request_error", code: "",
    } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
