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

  it("router Authorization: Bearer ... does not bypass D13 free-tier identity", async () => {
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

  it("preserves official downstream request identity through real dispatch", async () => {
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
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "User-Agent": "OpenCode/1.2.3",
      "x-opencode-project": "mine",
      "x-opencode-session": "ses_existing",
      "x-opencode-request": "msg_existing",
      "Accept": "*/*",
    });
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
