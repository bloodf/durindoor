import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  refreshCredentials: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb.js", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy.js", () => ({ resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig }));
vi.mock("open-sse/index.js", () => ({ getExecutor: () => ({ execute: mocks.execute, refreshCredentials: mocks.refreshCredentials }) }));

const { POST } = await import("../../src/app/api/translator/send/route.js");

const selectedSecret = "SELECTED-STORED-CREDENTIAL-CANARY";
const rawCanaries = [
  "RAW-PROVIDER-BODY-CANARY",
  "url-password-canary",
  "json-access-token-canary",
  "cookie-canary",
  "oauth-code-canary",
  "oauth-state-canary",
  "private-key-canary",
  selectedSecret,
  "/home/private/project/source.js",
];

let providerResponse;
describe("translator send provider error sanitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.getProviderConnections.mockResolvedValue([{
      id: "connection-1",
      provider: "openai",
      apiKey: selectedSecret,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      providerSpecificData: {},
      isActive: true,
    }]);
    const raw = [
      rawCanaries[0],
      `https://user:${rawCanaries[1]}@provider.test/fail`,
      JSON.stringify({ access_token: rawCanaries[2], cookie: rawCanaries[3], oauth_code: rawCanaries[4], oauth_state: rawCanaries[5], private_key: rawCanaries[6] }),
      selectedSecret,
      `at handler (${rawCanaries[8]}:12:3)`,
      "control\u0000line\r\n",
      "x".repeat(9000),
    ].join(" ");
    providerResponse = new Response(raw, { status: 502 });
    mocks.execute.mockResolvedValue({ response: providerResponse });
  });

  it("returns and logs only bounded credential-aware diagnostic text", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(new Request("http://localhost/api/translator/send", {
      method: "POST",
      body: JSON.stringify({ provider: "openai", model: "gpt-test", body: { messages: [{ role: "user", content: "hello" }] } }),
    }));
    const result = await response.json();
    const logged = consoleSpy.mock.calls.flat().join(" ");
    const exposed = `${logged} ${result.details}`;

    expect(response.status).toBe(502);
    expect(providerResponse.bodyUsed).toBe(true);
    expect(result.error).toBe("Provider error: 502");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.request_id).toBe(response.headers.get("x-request-id"));
    expect(result.details.length).toBeLessThanOrEqual(4096);
    for (const canary of rawCanaries) expect(exposed).not.toContain(canary);
    expect(exposed).not.toMatch(/[\u0000\r\n]/);
    expect(result.details).toBe("Upstream provider returned HTTP 502");
  });
});
