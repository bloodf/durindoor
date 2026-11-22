import { describe, it, expect, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({
  connection: null,
}));

vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(async () => [mocks.connection]),
  getProviderConnectionById: vi.fn(async () => mocks.connection),
  getProviderNodes: vi.fn(() => []),
  getProxyPoolById: vi.fn(),
  getProviderNodeById: vi.fn(),
  createProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb.js", () => ({
  getProviderConnections: vi.fn(async () => [{
    isActive: true,
    apiKey: "sk-live-upstream-key-1234567890",
    accessToken: "oauth-access-token-abcdef123456",
    providerSpecificData: {},
  }]),
}));

vi.mock("@/sse/services/model.js", () => ({ getModelInfo: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    buildUrl: () => "https://api.example.test/v1/chat/completions",
    buildHeaders: (credentials) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.apiKey}`,
      "x-api-key": credentials.apiKey,
      Cookie: "session=abc",
      "X-Forwarded-Auth": credentials.accessToken,
    }),
    transformRequest: (_model, body) => body,
  }),
}));

const { GET: listProviders } = await import("@/app/api/providers/route.js");
const { GET: getProviderById } = await import("@/app/api/providers/[id]/route.js");
const { POST: translate } = await import("../../src/app/api/translator/translate/route.js");

const SECRET_PSD = {
  baseUrl: "https://api.githubcopilot.com",
  copilotToken: "tid=live-copilot-bearer",
  dcaToken: "dca-long-lived-device-token",
  futureAuthToken: "future-secret-value",
};

function copilotConnection() {
  return {
    id: "gh-1",
    provider: "github",
    authType: "oauth",
    name: "Copilot",
    accessToken: "ghu_access",
    copilotToken: "tid=live-copilot-bearer",
    dcaToken: "dca-long-lived-device-token",
    providerSpecificData: { ...SECRET_PSD },
    priority: 1,
    isActive: true,
  };
}

describe("#2234 provider routes expose providerSpecificData by allowlist", () => {
  it("GET /api/providers drops copilotToken, dcaToken and unknown keys", async () => {
    mocks.connection = copilotConnection();
    const body = await (await listProviders({ headers: new Headers() })).json();
    const text = JSON.stringify(body);
    expect(text).not.toContain("live-copilot-bearer");
    expect(text).not.toContain("dca-long-lived-device-token");
    expect(text).not.toContain("future-secret-value");
    expect(body.connections[0].providerSpecificData.baseUrl).toBe("https://api.githubcopilot.com");
  });

  it("GET /api/providers/:id drops copilotToken, dcaToken and unknown keys", async () => {
    mocks.connection = copilotConnection();
    const res = await getProviderById({ headers: new Headers() }, { params: Promise.resolve({ id: "gh-1" }) });
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("live-copilot-bearer");
    expect(text).not.toContain("dca-long-lived-device-token");
    expect(text).not.toContain("future-secret-value");
    expect(text).toContain("https://api.githubcopilot.com");
  });
});

describe("#2229 translator step 3 redacts credentials", () => {
  it("does not return the upstream key in headers", async () => {
    const response = await translate({
      json: async () => ({
        step: 3,
        body: {
          provider: "openai",
          model: "gpt-4o",
          body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: false },
        },
      }),
    });
    expect(response.status).toBe(200);
    const { result } = await response.json();
    const text = JSON.stringify(result.headers);
    expect(text).not.toContain("sk-live-upstream-key-1234567890");
    expect(text).not.toContain("oauth-access-token-abcdef123456");
    expect(result.headers.Authorization).toBe("[REDACTED]");
    expect(result.headers["x-api-key"]).toBe("[REDACTED]");
    expect(result.headers.Cookie).toBe("[REDACTED]");
    expect(result.headers["Content-Type"]).toBe("application/json");
    expect(result.url).toBe("https://api.example.test/v1/chat/completions");
  });
});
