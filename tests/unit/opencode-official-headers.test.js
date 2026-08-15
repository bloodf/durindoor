import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

const PEER_TOKEN = "x-9r-peer-token";
const REAL_IP = "x-9r-real-ip";
const OUTBOUND_IP = "x-opencode-client-ip";

afterEach(() => {
  delete process.env.OPENCODE_DISABLE_FREE_TIER_HEADERS;
  delete process.env.NINEROUTER_PEER_TOKEN;
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OpenCodeExecutor official free-tier headers (D13)", () => {
  it("clientHeaders reach the outbound request through real executor dispatch", async () => {
    const fetchMock = stubFetch();
    const token = "a".repeat(48);
    process.env.NINEROUTER_PEER_TOKEN = token;

    await new OpenCodeExecutor().execute({
      model: "deepseek-v3.2-free",
      body: { messages: [] },
      stream: true,
      credentials: {},
      requestContext: {
        clientHeaders: {
          "user-agent": "curl/8.5.0",
          [PEER_TOKEN]: token,
          [REAL_IP]: "203.0.113.5",
        },
      },
    });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["User-Agent"]).toBe("opencode");
    expect(headers["x-opencode-client"]).toBe("desktop");
    expect(headers["x-opencode-project"]).toBe("global");
    expect(headers["Accept"]).toBe("text/event-stream");
    expect(headers[OUTBOUND_IP]).toBe("203.0.113.5");
    expect(headers["x-opencode-request"]).toMatch(/^msg_[a-f0-9]{32}$/);
    expect(headers["x-opencode-session"]).toMatch(/^ses_[a-f0-9]+$/);
  });

  it("preserves official downstream UA through real dispatch", async () => {
    const fetchMock = stubFetch();
    await new OpenCodeExecutor().execute({
      model: "deepseek-v3.2-free",
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
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "User-Agent": "OpenCode/1.2.3",
      "x-opencode-project": "mine",
      "x-opencode-session": "ses_existing",
      "x-opencode-request": "msg_existing",
      "Accept": "*/*",
    });
  });

  it("filters spoofed forwarding headers through real dispatch", async () => {
    const fetchMock = stubFetch();
    await new OpenCodeExecutor().execute({
      model: "deepseek-v3.2-free",
      body: { messages: [] },
      stream: false,
      credentials: {},
      requestContext: {
        clientHeaders: { "x-forwarded-for": "198.51.100.8", "x-real-ip": "198.51.100.9" },
      },
    });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers["x-real-ip"]).toBeUndefined();
    expect(headers[OUTBOUND_IP]).toBeUndefined();
  });

  it("wrong peer token: outbound client IP is NOT trusted", async () => {
    const fetchMock = stubFetch();
    process.env.NINEROUTER_PEER_TOKEN = "a".repeat(48);
    await new OpenCodeExecutor().execute({
      model: "deepseek-v3.2-free",
      body: { messages: [] },
      stream: false,
      credentials: {},
      requestContext: {
        clientHeaders: { [PEER_TOKEN]: "b".repeat(48), [REAL_IP]: "198.51.100.8" },
      },
    });
    expect(fetchMock.mock.calls[0][1].headers[OUTBOUND_IP]).toBeUndefined();
  });

  it("missing peer token: outbound client IP is NOT trusted", async () => {
    const fetchMock = stubFetch();
    process.env.NINEROUTER_PEER_TOKEN = "a".repeat(48);
    await new OpenCodeExecutor().execute({
      model: "deepseek-v3.2-free",
      body: { messages: [] },
      stream: false,
      credentials: {},
      requestContext: { clientHeaders: { [REAL_IP]: "198.51.100.8" } },
    });
    expect(fetchMock.mock.calls[0][1].headers[OUTBOUND_IP]).toBeUndefined();
  });

  it("server env unset: outbound client IP is NOT trusted", async () => {
    const fetchMock = stubFetch();
    await new OpenCodeExecutor().execute({
      model: "deepseek-v3.2-free",
      body: { messages: [] },
      stream: false,
      credentials: {},
      requestContext: { clientHeaders: { [REAL_IP]: "198.51.100.8" } },
    });
    expect(fetchMock.mock.calls[0][1].headers[OUTBOUND_IP]).toBeUndefined();
  });

  it("does not synthesize free-tier headers for paid credentials", () => {
    const headers = new OpenCodeExecutor().buildHeaders(
      { apiKey: "sk-paid" },
      true,
      { clientHeaders: { "user-agent": "curl/8.5.0" } },
      "deepseek-v3.2-free",
    );
    expect(headers).toMatchObject({ "Authorization": "Bearer sk-paid", "User-Agent": "curl/8.5.0" });
    expect(headers["x-opencode-project"]).toBeUndefined();
    expect(headers["x-opencode-session"]).toBeUndefined();
  });

  it("explicit opt-out preserves generic UA on free model", () => {
    process.env.OPENCODE_DISABLE_FREE_TIER_HEADERS = "true";
    const headers = new OpenCodeExecutor().buildHeaders(
      {},
      true,
      { clientHeaders: { "user-agent": "curl/8.5.0" } },
      "deepseek-v3.2-free",
    );
    expect(headers["User-Agent"]).toBe("curl/8.5.0");
    expect(headers["x-opencode-project"]).toBeUndefined();
  });
});
