import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { ROLE } from "../../open-sse/translator/schema/index.js";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";

const credentials = {
  accessToken: "test-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

function stubSession(executor) {
  let opened = 0;
  const connect = vi.fn(() => {
    opened += 1;
    return {
      responseHeaders: Promise.resolve({ ":status": 200 }),
      write() {},
      end() {},
      close() {},
      async read() { return { value: undefined, done: true }; },
    };
  });
  executor.openAgentHttp2Stream = connect;
  return { connect, opened: () => opened };
}

async function runAgent(executor, proxyOptions) {
  return executor.executeAgent({
    model: "gpt-5.2",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials,
    proxyOptions,
  });
}

const ENV_PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

describe("Cursor AgentService proxy enforcement (h2 duplex cannot carry a proxy)", () => {
  beforeEach(() => {
    for (const key of ENV_PROXY_KEYS) vi.stubEnv(key, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  const proxied = [
    ["strict pool", { strictProxy: true, proxyPoolId: "pool-1" }],
    ["strict via enabled+url", { strictProxy: true, enabled: true, url: "http://127.0.0.1:9" }],
    ["strict via connection proxy", { strictProxy: true, connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9" }],
    ["non-strict connection proxy", { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9" }],
    ["relay", { vercelRelayUrl: "https://relay.example/" }],
  ];

  for (const [label, proxyOptions] of proxied) {
    it(`fails closed without opening an h2 session: ${label}`, async () => {
      const executor = new CursorExecutor();
      const { connect } = stubSession(executor);
      await expect(runAgent(executor, proxyOptions)).rejects.toThrow(/proxy/u);
      expect(connect).not.toHaveBeenCalled();
    });
  }

  it("fails closed when only an environment proxy applies", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:9");
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, null)).rejects.toThrow(/proxy/u);
    expect(connect).not.toHaveBeenCalled();
  });

  it("no proxy at all keeps the direct h2 path", async () => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, null)).resolves.toBeTruthy();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("routes proxied text and tool-result history through ChatService without direct h2", async () => {
    vi.stubEnv("CURSOR_AGENT_SERVICE", "on");
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    const agentSpy = vi.spyOn(executor, "executeAgent");
    const h2Spy = vi.spyOn(executor, "makeHttp2Request");
    const fetchSpy = vi.spyOn(executor, "makeFetchRequest").mockResolvedValue({ status: 418 });
    const proxyOptions = {
      strictProxy: true,
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:9",
      disableEnvProxy: true,
    };
    const result = await executor.execute({
      model: "gpt-5.2",
      body: { messages: [
        { role: ROLE.USER, content: "Read the file" },
        { role: ROLE.ASSISTANT, content: null, tool_calls: [
          { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } },
        ] },
        { role: ROLE.TOOL, tool_call_id: "call-1", content: "file contents" },
      ] },
      stream: false,
      credentials,
      proxyOptions,
    });
    expect(result.response.status).toBe(418);
    expect(result.url).toBe(executor.buildUrl());
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
      executor.buildUrl(), expect.any(Object), expect.anything(), undefined, proxyOptions,
    );
    expect(agentSpy).not.toHaveBeenCalled();
    expect(h2Spy).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("CURSOR_AGENT_SERVICE=off keeps text requests off the h2 AgentService path", async () => {
    vi.stubEnv("CURSOR_AGENT_SERVICE", "off");
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    const fetchSpy = vi.spyOn(executor, "makeFetchRequest").mockResolvedValue({ status: 500, headers: {}, body: Buffer.alloc(0) });
    const h2Spy = vi.spyOn(executor, "makeHttp2Request").mockResolvedValue({ status: 500, headers: {}, body: Buffer.alloc(0) });
    await executor.execute({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
      proxyOptions: { disableEnvProxy: true },
    });
    expect(connect).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.length + h2Spy.mock.calls.length).toBe(1);
  });
});
