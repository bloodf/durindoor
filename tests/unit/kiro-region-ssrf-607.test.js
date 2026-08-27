import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  refreshToken: vi.fn(),
  validateApiKey: vi.fn(),
  resolveCache: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/models", () => ({
  createProviderConnection: mocks.createProviderConnection,
}));

vi.mock("@/lib/oauth/services/kiro", () => ({
  KiroService: class KiroService {
    extractEmailFromJWT() {
      return null;
    }

    refreshToken(...args) {
      return mocks.refreshToken(...args);
    }

    validateApiKey(...args) {
      return mocks.validateApiKey(...args);
    }
  },
}));

vi.mock("open-sse/services/kiroModels.js", () => ({
  resolveKiroCredentialsFromSsoCache: mocks.resolveCache,
}));

function post(path, body) {
  return new Request(`https://durindoor.local${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const maliciousRegions = [
  "us-east-1.evil.example",
  "../../169.254.169.254",
  "us-east-1@169.254.169.254",
  "us-east-1/../metadata",
  "us_east_1",
  123,
];

describe("Kiro region SSRF boundaries (9router #3497, issue #607)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCache.mockRejectedValue(new Error("cache unavailable"));
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(maliciousRegions)("API-key import rejects malformed region %j before validation", async (region) => {
    const { POST } = await import("../../src/app/api/oauth/kiro/api-key/route.js");

    const response = await POST(post("/api/oauth/kiro/api-key", {
      apiKey: "secret-key",
      region,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid Kiro AWS region" });
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
  });

  it.each(maliciousRegions)("refresh-token import rejects malformed region %j before refresh", async (region) => {
    const { POST } = await import("../../src/app/api/oauth/kiro/import/route.js");

    const response = await POST(post("/api/oauth/kiro/import", {
      refreshToken: "aorAAAAAG-test",
      clientId: "client-id",
      clientSecret: "client-secret",
      region,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid Kiro AWS region" });
    expect(mocks.refreshToken).not.toHaveBeenCalled();
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
  });

  it("normalizes and forwards a valid API-key region", async () => {
    mocks.validateApiKey.mockResolvedValue({
      accessToken: "secret-key",
      profileArn: null,
      region: "eu-central-1",
    });
    mocks.createProviderConnection.mockResolvedValue({
      id: "connection-1",
      provider: "kiro",
      email: null,
    });
    const { POST } = await import("../../src/app/api/oauth/kiro/api-key/route.js");

    const response = await POST(post("/api/oauth/kiro/api-key", {
      apiKey: "secret-key",
      region: " EU-CENTRAL-1 ",
    }));

    expect(response.status).toBe(200);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("secret-key", "eu-central-1");
  });

  it("normalizes and forwards a valid IDC refresh region", async () => {
    mocks.refreshToken.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "rotated-token",
      expiresIn: 3600,
    });
    mocks.createProviderConnection.mockResolvedValue({
      id: "connection-1",
      provider: "kiro",
      email: null,
    });
    const { POST } = await import("../../src/app/api/oauth/kiro/import/route.js");

    const response = await POST(post("/api/oauth/kiro/import", {
      refreshToken: "aorAAAAAG-test",
      clientId: "client-id",
      clientSecret: "client-secret",
      region: " EU-CENTRAL-1 ",
    }));

    expect(response.status).toBe(200);
    expect(mocks.refreshToken).toHaveBeenCalledWith("aorAAAAAG-test", {
      clientId: "client-id",
      clientSecret: "client-secret",
      region: "eu-central-1",
      authMethod: "idc",
    });
  });

  it("replaces a malformed cache region before returning auto-import data", async () => {
    mocks.resolveCache.mockResolvedValue({
      refreshToken: "aorAAAAAG-test",
      source: "kiro-auth-token.json",
      clientId: "client-id",
      clientSecret: "client-secret",
      region: "us-east-1@169.254.169.254",
      authMethod: "idc",
      profileArn: null,
    });
    const { GET } = await import("../../src/app/api/oauth/kiro/auto-import/route.js");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.found).toBe(true);
    expect(body.region).toBe("us-east-1");
  });
});
