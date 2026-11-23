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

describe("Cursor AgentService proxy enforcement", () => {
  beforeEach(() => {
    for (const key of ENV_PROXY_KEYS) vi.stubEnv(key, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { strictProxy: true, proxyPoolId: "pool-1" },
    { vercelRelayUrl: "https://relay.example/" },
  ])("fails closed for an unavailable route", async (proxyOptions) => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, proxyOptions)).rejects.toThrow(/proxy|relay/i);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    { strictProxy: true, enabled: true, url: "http://127.0.0.1:9" },
    { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9" },
    { disableEnvProxy: true },
  ])("passes the selected route to AgentService", async (proxyOptions) => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await runAgent(executor, proxyOptions);
    expect(connect).toHaveBeenCalledOnce();
    expect(connect.mock.calls[0][3]).toBe(proxyOptions);
  });

  it("does not replace an unavailable bound pool with an environment proxy", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:9");
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, { proxyPoolId: "pool-1", strictProxy: true })).rejects.toThrow(/proxy/i);
    expect(connect).not.toHaveBeenCalled();
  });

  it("routes an environment proxy through AgentService", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:9");
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await executor.execute({ model: "gpt-5.2", body: { messages: [{ role: ROLE.USER, content: "hi" }] }, stream: false, credentials });
    expect(connect).toHaveBeenCalledOnce();
  });

  it.each([
    { strictProxy: true, enabled: true, url: "http://127.0.0.1:9" },
    { strictProxy: true, connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9" },
    { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9" },
  ])("execute forwards a configured proxy without falling back", async (proxyOptions) => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    const fetch = vi.spyOn(executor, "makeFetchRequest");
    await executor.execute({ model: "gpt-5.2", body: { messages: [{ role: ROLE.USER, content: "hi" }] }, stream: false, credentials, proxyOptions });
    expect(connect).toHaveBeenCalledOnce();
    expect(connect.mock.calls[0][3]).toBe(proxyOptions);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes proxied text and tool-result history through AgentService", async () => {
    vi.stubEnv("CURSOR_AGENT_SERVICE", "on");
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9" };
    await executor.execute({
      model: "gpt-5.2", stream: false, credentials, proxyOptions,
      body: { messages: [
        { role: ROLE.USER, content: "Read the file" },
        { role: ROLE.ASSISTANT, content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
        { role: ROLE.TOOL, tool_call_id: "call-1", content: "file contents" },
      ] },
    });
    expect(connect).toHaveBeenCalledOnce();
    expect(connect.mock.calls[0][3]).toBe(proxyOptions);
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
