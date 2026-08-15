import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, refreshProviderCredentials, shouldRefreshCredentials } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refreshProviderCredentials: vi.fn(async () => ({ accessToken: "rotated" })),
  shouldRefreshCredentials: vi.fn(() => false),
}));
vi.stubGlobal("fetch", fetchMock);

// Stub the shared credential manager so we can assert the executor delegates to
// it (no duplicate fetch) without spinning up the DB-backed refresh path.
vi.mock("../../open-sse/services/oauthCredentialManager.js", () => ({
  refreshProviderCredentials,
  shouldRefreshCredentials,
}));

import { requestDeviceCode, pollForToken } from "../../src/lib/oauth/providers.js";
import { PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import {
  GrokCliExecutor,
  countGrokCliUserTurns,
  resolveGrokCliTurnIdx,
  _resetGrokCliTurnStore,
} from "../../open-sse/executors/grok-cli.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { isImportTokenOAuthProvider } from "../../src/shared/utils/importTokenProviders.js";

function formOf(call) {
  const body = call?.[1]?.body;
  return body instanceof URLSearchParams ? body : new URLSearchParams(String(body ?? ""));
}

beforeEach(() => {
  fetchMock.mockReset();
  refreshProviderCredentials.mockClear();
  shouldRefreshCredentials.mockClear();
  _resetGrokCliTurnStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("grok-cli device-code OAuth (#2502)", () => {
  it("is registered as a device_code provider (not import_token)", () => {
    expect(PROVIDER_OAUTH["grok-cli"].flowType).toBe("device_code");
    expect(isImportTokenOAuthProvider("grok-cli")).toBe(false);
  });

  it("requestDeviceCode posts client_id + scope + referrer as form data", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          device_code: "dc-1",
          user_code: "ABCD-1234",
          verification_uri: "https://x.ai/activate",
          expires_in: 600,
          interval: 5,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const data = await requestDeviceCode("grok-cli");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://auth.x.ai/oauth2/device/code");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = formOf(fetchMock.mock.calls[0]);
    expect(form.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
    expect(form.get("scope")).toContain("grok-cli:access");
    expect(form.get("referrer")).toBe("grok-build");
    expect(data.user_code).toBe("ABCD-1234");
  });

  it("pollForToken treats authorization_pending as a soft (pending) response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "authorization_pending" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await pollForToken("grok-cli", "dc-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://auth.x.ai/oauth2/token");
    const form = formOf(fetchMock.mock.calls[0]);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
    expect(form.get("device_code")).toBe("dc-1");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(result).toMatchObject({ success: false, error: "authorization_pending", pending: true });
  });

  it("pollForToken survives a non-JSON error body without throwing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("upstream exploded", { status: 502 }));

    const result = await pollForToken("grok-cli", "dc-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_response");
  });
});

describe("GrokCliExecutor (#2502)", () => {
  it("resolves grok-4.5 effort variants through canonical alias and provider id", () => {
    expect(getModelUpstreamId("gb", "grok-4.5-high")).toBe("grok-4.5");
    expect(getModelUpstreamId("grok-cli", "grok-4.5-medium")).toBe("grok-4.5");
    expect(getModelUpstreamId("grok-cli", "grok-4.5")).toBe("grok-4.5");
  });

  it("counts user turns and the per-session idx never decreases", () => {
    const twoUser = [
      { type: "message", role: "user", content: "hi" },
      { type: "message", role: "assistant", content: "hello" },
      { type: "message", role: "user", content: "again" },
    ];
    const oneUser = [{ type: "message", role: "user", content: "hi" }];
    expect(countGrokCliUserTurns(twoUser)).toBe(2);
    // Monotonic per session: reflects the user-turn count and never goes backwards,
    // even when a later input has fewer user messages.
    expect(resolveGrokCliTurnIdx("sess-1", twoUser)).toBe(2);
    expect(resolveGrokCliTurnIdx("sess-1", twoUser)).toBe(2);
    expect(resolveGrokCliTurnIdx("sess-1", oneUser)).toBe(2);
    // A fresh session starts from its own input.
    expect(resolveGrokCliTurnIdx("sess-2", oneUser)).toBe(1);
  });

  it("delegates refresh to the shared credential manager", async () => {
    const ex = new GrokCliExecutor();
    const creds = { refreshToken: "rt-1" };
    const rotated = await ex.refreshCredentials(creds, console);
    expect(rotated).toEqual({ accessToken: "rotated" });
    expect(refreshProviderCredentials).toHaveBeenCalledWith("grok-cli", creds, console);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("buildHeaders uses a generated agent id and never bleeds a credential id", () => {
    const ex = new GrokCliExecutor();
    ex._defaultAgentId = "machine-default"; // simulate execute() having resolved it

    const withCred = ex.buildHeaders({ providerSpecificData: { deviceId: "dev-A" } });
    expect(withCred["x-grok-agent-id"]).toBe("dev-A");

    // A second connection without a device id must NOT inherit dev-A.
    const noCred = ex.buildHeaders({ providerSpecificData: {} });
    expect(noCred["x-grok-agent-id"]).toBe("machine-default");
    expect(noCred["x-grok-agent-id"]).not.toBe("dev-A");
  });

  it("execute() resolves a UUID-shaped default agent id before the request", async () => {
    const ex = new GrokCliExecutor();
    expect(ex._defaultAgentId).toBeNull();
    fetchMock.mockRejectedValue(new Error("no network"));
    await ex
      .execute({ model: "grok-4.5", body: { input: [] }, stream: true, credentials: {} })
      .catch(() => {});
    expect(typeof ex._defaultAgentId).toBe("string");
    expect(ex._defaultAgentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const h = ex.buildHeaders({ providerSpecificData: {} });
    expect(h["x-grok-agent-id"]).toBe(ex._defaultAgentId);
  });

  it("formatAgentId is deterministic and UUID-shaped for short machine ids", () => {
    const a = GrokCliExecutor.formatAgentId("0123456789abcdef");
    const b = GrokCliExecutor.formatAgentId("0123456789abcdef");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(GrokCliExecutor.formatAgentId("")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("exposes a single executor instance (alias resolution happens upstream)", () => {
    expect(getExecutor("grok-cli")).toBeInstanceOf(GrokCliExecutor);
  });
});
