import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

afterEach(() => {
  delete process.env.OPENCODE_DISABLE_FREE_TIER_HEADERS;
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OpenCodeExecutor official free-tier headers (D13)", () => {
  it("sends official defaults through real executor dispatch", async () => {
    const fetchMock = stubFetch();
    await new OpenCodeExecutor().execute({
      model: "deepseek-v3.2",
      body: { messages: [] },
      stream: true,
      credentials: {},
      requestContext: { clientHeaders: { "user-agent": "curl/8.5.0" } },
    });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers).toMatchObject({
      "User-Agent": "opencode",
      "x-opencode-client": "desktop",
      "x-opencode-project": "global",
      "Accept": "text/event-stream",
    });
    expect(headers["x-opencode-request"]).toMatch(/^msg_[a-f0-9]{32}$/);
    expect(headers["x-opencode-session"]).toMatch(/^ses_[a-f0-9]+$/);
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers["x-real-ip"]).toBeUndefined();
    expect(headers["x-9r-real-ip"]).toBeUndefined();
  });

  it("router Authorization: Bearer ... does not bypass free-tier identity generation", async () => {
    const fetchMock = stubFetch();
    await new OpenCodeExecutor().execute({
      model: "deepseek-v3.2",
      body: { messages: [] },
      stream: true,
      credentials: {},
      requestContext: {
        clientHeaders: { "user-agent": "curl/8.5.0", authorization: "Bearer router-token" },
      },
    });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers).toMatchObject({
      "User-Agent": "opencode",
      "x-opencode-client": "desktop",
      "x-opencode-project": "global",
    });
    expect(headers["x-opencode-request"]).toMatch(/^msg_[a-f0-9]{32}$/);
    expect(headers["x-opencode-session"]).toMatch(/^ses_[a-f0-9]+$/);
  });

  it("uses trusted connection identity, not hostile client session input", async () => {
    const fetchMock = stubFetch();
    const executor = new OpenCodeExecutor();
    const request = (connectionId, sessionId) => ({
      model: "deepseek-v3.2",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { connectionId, rawHeaders: { "x-session-id": sessionId } },
      requestContext: { clientHeaders: { "user-agent": "curl/8.5.0" } },
    });
    await executor.execute(request("account-a", "victim@example.com"));
    await executor.execute(request("account-a", "different-attacker-value"));
    await executor.execute(request("account-b", "victim@example.com"));
    const [first, second, third] = fetchMock.mock.calls.map((call) => call[1].headers);
    expect(first["x-opencode-session"]).toMatch(/^ses_[a-f0-9]{32}$/);
    expect(first["x-opencode-session"]).not.toContain("victim");
    expect(second["x-opencode-session"]).toBe(first["x-opencode-session"]);
    expect(second["x-opencode-request"]).not.toBe(first["x-opencode-request"]);
    expect(third["x-opencode-session"]).not.toBe(first["x-opencode-session"]);
  });

  it("uses executor-private session identity without trusted connection", async () => {
    const fetchMock = stubFetch();
    const request = (sessionId) => ({
      model: "deepseek-v3.2",
      body: { messages: [] },
      stream: true,
      credentials: { rawHeaders: { "x-session-id": sessionId } },
      requestContext: { clientHeaders: { "user-agent": "curl/8.5.0" } },
    });
    const firstExecutor = new OpenCodeExecutor();
    await firstExecutor.execute(request("attacker-a"));
    await firstExecutor.execute(request("attacker-b"));
    await new OpenCodeExecutor().execute(request("attacker-a"));
    const [first, second, third] = fetchMock.mock.calls.map((call) => call[1].headers);
    expect(second["x-opencode-session"]).toBe(first["x-opencode-session"]);
    expect(third["x-opencode-session"]).not.toBe(first["x-opencode-session"]);
  });


  it("official UA: client identity headers are NOT preserved on free tier", async () => {
    const fetchMock = stubFetch();
    await new OpenCodeExecutor().execute({
      model: "deepseek-v3.2",
      body: { messages: [] },
      stream: false,
      credentials: {},
      requestContext: {
        clientHeaders: {
          "User-Agent": "OpenCode/1.2.3",
          "x-opencode-project": "mine",
          "x-opencode-session": "ses_existing",
          "x-opencode-request": "msg_existing",
        },
      },
    });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers).toMatchObject({
      "User-Agent": "opencode",
      "x-opencode-client": "desktop",
      "x-opencode-project": "global",
      "Accept": "*/*",
    });
    expect(headers["x-opencode-session"]).toMatch(/^ses_[a-f0-9]+$/);
    expect(headers["x-opencode-request"]).toMatch(/^msg_[a-f0-9]{32}$/);
    expect(headers["x-opencode-session"]).not.toBe("ses_existing");
    expect(headers["x-opencode-request"]).not.toBe("msg_existing");
  });


  it("spoofed OpenCode UA: client identity headers are NOT preserved", async () => {
    const fetchMock = stubFetch();
    await new OpenCodeExecutor().execute({
      model: "deepseek-v3.2",
      body: { messages: [] },
      stream: true,
      credentials: {},
      requestContext: {
        clientHeaders: {
          "user-agent": "OpenCode/1.2.3",
          "x-opencode-client": "attacker",
          "x-opencode-project": "attacker",
          "x-opencode-session": "ses_attacker",
          "x-opencode-request": "msg_attacker",
        },
      },
    });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers).toMatchObject({
      "User-Agent": "opencode",
      "x-opencode-client": "desktop",
      "x-opencode-project": "global",
    });
    expect(headers["x-opencode-session"]).toMatch(/^ses_[a-f0-9]+$/);
    expect(headers["x-opencode-request"]).toMatch(/^msg_[a-f0-9]{32}$/);
    expect(headers["x-opencode-session"]).not.toBe("ses_attacker");
    expect(headers["x-opencode-request"]).not.toBe("msg_attacker");
  });

  it("does not synthesize free-tier headers for paid credentials", () => {
    const headers = new OpenCodeExecutor().buildHeaders(
      { apiKey: "sk-paid" }, true, { clientHeaders: { "user-agent": "curl/8.5.0" } },
    );
    expect(headers).toMatchObject({ "Authorization": "Bearer sk-paid", "User-Agent": "curl/8.5.0" });
    expect(headers["x-opencode-project"]).toBeUndefined();
    expect(headers["x-opencode-session"]).toBeUndefined();
  });

  it("explicit opt-out preserves generic UA", () => {
    process.env.OPENCODE_DISABLE_FREE_TIER_HEADERS = "true";
    const headers = new OpenCodeExecutor().buildHeaders(
      {}, true, { clientHeaders: { "user-agent": "curl/8.5.0" } },
    );
    expect(headers["User-Agent"]).toBe("curl/8.5.0");
    expect(headers["x-opencode-project"]).toBeUndefined();
  });
});
