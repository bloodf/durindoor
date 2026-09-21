import { beforeEach, describe, expect, it, vi } from "vitest";

const operator = vi.hoisted(() => ({ value: false }));
const proxyAwareFetch = vi.hoisted(() => vi.fn(async () => ({ ok: true, status: 200 })));

vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => operator.value) }));
vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getProviderNodes: vi.fn(() => []),
  getProxyPoolById: vi.fn(),
  getProviderNodeById: vi.fn(),
  createProviderConnection: vi.fn(async (data) => ({ id: "c1", ...data })),
  updateProviderConnection: vi.fn(async (id, data) => ({ id, provider: "bedrock", authType: "apikey", ...data })),
  deleteProviderConnection: vi.fn(),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const { GET: listProviders, POST: createProvider } = await import("@/app/api/providers/route.js");
const { PUT: updateProvider } = await import("@/app/api/providers/[id]/route.js");
const { POST: validateProvider } = await import("@/app/api/providers/validate/route.js");
const { probeRegistryProvider } = await import("@/app/api/providers/providerProbe.js");
const { probeConnectionHealth } = await import("@/lib/providerHealthProbe.js");
const models = await import("@/models");
const { SENSITIVE_CONNECTION_FIELDS } = await import("@/lib/db/repos/connectionsRepo.js");

const jsonRequest = (url, body, method = "POST") =>
  new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  operator.value = false;
  vi.clearAllMocks();
});

describe("Bedrock profile is an operator-only, validated input", () => {
  it("refuses a profile connection created with an application API key", async () => {
    const res = await createProvider(jsonRequest("http://localhost/api/providers", {
      provider: "bedrock", name: "sso", providerSpecificData: { profile: "prod-sso" },
    }));
    expect(res.status).toBe(403);
    expect(models.createProviderConnection).not.toHaveBeenCalled();
  });

  it("rejects a malformed or non-string profile even from an operator", async () => {
    operator.value = true;
    for (const profile of [{ nested: true }, "bad name", "a;b"]) {
      const res = await createProvider(jsonRequest("http://localhost/api/providers", {
        provider: "bedrock", name: "sso", providerSpecificData: { profile },
      }));
      expect(res.status).toBe(400);
    }
    expect(models.createProviderConnection).not.toHaveBeenCalled();
  });

  it("lets an operator create a profile-only connection", async () => {
    operator.value = true;
    const res = await createProvider(jsonRequest("http://localhost/api/providers", {
      provider: "bedrock", name: "sso", providerSpecificData: { profile: "prod-sso" },
    }));
    expect(res.status).toBe(201);
  });

  it("refuses to set a profile through PUT with an application API key", async () => {
    models.getProviderConnectionById.mockResolvedValue({
      id: "c1", provider: "bedrock", authType: "apikey", providerSpecificData: { region: "us-east-1" },
    });
    const res = await updateProvider(
      jsonRequest("http://localhost/api/providers/c1", { providerSpecificData: { profile: "prod-sso" } }, "PUT"),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(res.status).toBe(403);
    expect(models.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("refuses to validate a profile with an application API key", async () => {
    const res = await validateProvider(jsonRequest("http://localhost/api/providers/validate", {
      provider: "bedrock", providerSpecificData: { profile: "prod-sso" },
    }));
    expect(res.status).toBe(403);
  });
});

describe("Bedrock session token is a stored secret", () => {
  it("is in the encrypted connection field list", () => {
    expect(SENSITIVE_CONNECTION_FIELDS).toContain("sessionToken");
  });

  it("is stored top-level on create and never echoed back", async () => {
    const res = await createProvider(jsonRequest("http://localhost/api/providers", {
      provider: "bedrock",
      name: "temp",
      apiKey: "aws-secret",
      sessionToken: "sts-token",
      providerSpecificData: { accessKeyId: "ASIAEXAMPLE" },
    }));
    expect(res.status).toBe(201);
    const saved = models.createProviderConnection.mock.calls[0][0];
    expect(saved.sessionToken).toBe("sts-token");
    expect(saved.providerSpecificData.sessionToken).toBeUndefined();
    expect(JSON.stringify(await res.json())).not.toContain("sts-token");
  });

  it("is stripped from the list response, top-level and legacy providerSpecificData", async () => {
    models.getProviderConnections.mockResolvedValue([{
      id: "c1",
      provider: "bedrock",
      authType: "apikey",
      name: "temp",
      apiKey: "aws-secret",
      sessionToken: "sts-token",
      providerSpecificData: { accessKeyId: "ASIAEXAMPLE", sessionToken: "legacy-token" },
    }]);
    const body = JSON.stringify(await (await listProviders(new Request("http://localhost/api/providers"))).json());
    expect(body).not.toContain("sts-token");
    expect(body).not.toContain("legacy-token");
    expect(body).toContain("ASIAEXAMPLE");
  });

  it("can be cleared through PUT", async () => {
    operator.value = true;
    models.getProviderConnectionById.mockResolvedValue({
      id: "c1", provider: "bedrock", authType: "apikey", providerSpecificData: { accessKeyId: "ASIAOLD" },
    });
    const res = await updateProvider(
      jsonRequest("http://localhost/api/providers/c1", { sessionToken: "" }, "PUT"),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(res.status).toBe(200);
    expect(models.updateProviderConnection.mock.calls[0][1].sessionToken).toBe("");
  });
});

describe("Bedrock probes never send an IAM secret as a bearer token", () => {
  const leaked = (calls, secret) =>
    calls.some(([, init]) => JSON.stringify(init?.headers || {}).includes(secret));

  it("validates static keys locally instead of through the bearer probe", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
    // A temporary key with no session token fails before any request is signed or sent.
    const result = await probeRegistryProvider("bedrock", "iam-secret-value", fetcher, {
      accessKeyId: "ASIAEXAMPLE",
    });
    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the bearer probe for a Bedrock API key connection", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
    await probeRegistryProvider("bedrock", "bedrock-api-key", fetcher, {});
    expect(leaked(fetcher.mock.calls, "Bearer bedrock-api-key")).toBe(true);
  });

  it("skips the proxied bearer health probe for static AWS keys", async () => {
    const result = await probeConnectionHealth({
      id: "c1",
      provider: "bedrock",
      apiKey: "iam-secret-value",
      providerSpecificData: { accessKeyId: "ASIAEXAMPLE" },
    }, {
      proxyConfig: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example:8080" },
    });
    expect(leaked(proxyAwareFetch.mock.calls, "iam-secret-value")).toBe(false);
    expect(result.valid).toBe(false);
  });
});
