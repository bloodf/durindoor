import { afterEach, describe, expect, it, vi } from "vitest";

import { hasTrustedPeerHeaders } from "../../src/lib/auth/trustedPeer.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

const PEER_TOKEN = "x-9r-peer-token";
const REAL_IP = "x-9r-real-ip";

afterEach(() => {
  delete process.env.OPENCODE_DISABLE_FREE_TIER_HEADERS;
  delete process.env.NINEROUTER_PEER_TOKEN;
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
  });

  it("trusted wrapper proof: spoofed x-9r-real-ip is accepted only with matching peer token", () => {
    const token = "a".repeat(48);
    process.env.NINEROUTER_PEER_TOKEN = token;
    const request = { headers: { get: (name) => (name === PEER_TOKEN ? token : null) } };
    expect(hasTrustedPeerHeaders(request)).toBe(true);
  });

  it("wrong peer token: x-9r-real-ip is NOT trusted", () => {
    process.env.NINEROUTER_PEER_TOKEN = "a".repeat(48);
    const request = { headers: { get: (name) => (name === PEER_TOKEN ? "b".repeat(48) : null) } };
    expect(hasTrustedPeerHeaders(request)).toBe(false);
  });

  it("missing peer token: x-9r-real-ip is NOT trusted", () => {
    process.env.NINEROUTER_PEER_TOKEN = "a".repeat(48);
    const request = { headers: { get: () => null } };
    expect(hasTrustedPeerHeaders(request)).toBe(false);
  });

  it("server env unset: client cannot fabricate peer token", () => {
    delete process.env.NINEROUTER_PEER_TOKEN;
    const request = { headers: { get: () => "a".repeat(48) } };
    expect(hasTrustedPeerHeaders(request)).toBe(false);
  });
});
