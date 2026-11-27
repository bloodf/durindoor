// MIT: OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523
// src/lib/oauth/providers/devin-desktop.ts; CLIProxyAPI dbe641f286a489ecb39e3c041c554371e6add864
// internal/auth/devin/devin_auth.go.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createProviderConnection } = vi.hoisted(() => ({ createProviderConnection: vi.fn() }));
vi.mock("open", () => ({ default: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection, getProxyPoolById: vi.fn() }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
import { getProvider } from "../../src/lib/oauth/providers.js";
import { POST } from "@/app/api/oauth/[provider]/[action]/route.js";
import { clearOAuthFlowsForTests } from "@/lib/oauth/flowStore.js";
import { generatePKCE } from "../../src/lib/oauth/utils/pkce.js";
import { devinDesktopOAuth, DEVIN_DESKTOP_CONFIG, refreshDevinDesktopSession } from "../../src/lib/oauth/services/devin-desktop.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); clearOAuthFlowsForTests(); });

describe("Devin sign-in source contracts", () => {
  it("keeps the CLI import provider distinct from Desktop browser PKCE", () => {
    const cli = getProvider("devin-cli");
    const desktop = getProvider("devin-desktop");
    expect(cli.flowType).toBe("import_token");
    expect(cli.buildAuthUrl()).toBeNull();
    expect(cli.supportsBrowserPkce).not.toBe(true);
    expect(desktop).toBe(devinDesktopOAuth);
    const { codeVerifier, codeChallenge, state } = generatePKCE(desktop.pkceVerifierBytes);
    const url = new URL(desktop.buildAuthUrl(desktop.config, "http://127.0.0.1:59653/callback", state, codeChallenge));
    expect(codeVerifier).toHaveLength(128);
    expect(Object.fromEntries(url.searchParams)).toEqual({ redirect_uri: "http://127.0.0.1:59653/callback", state, prompt: "select_account", code_challenge: codeChallenge, code_challenge_method: "S256" });
  });

  it("exchanges concurrent codes with their own verifier and proxy, without a refresh token", async () => {
    const calls = [];
    const fetcher = vi.fn(async (url, init) => {
      calls.push({ url, ...init, parsed: JSON.parse(init.body) });
      return Response.json({ token: `synthetic-${JSON.parse(init.body).code}` });
    });
    const results = await Promise.all(["a", "b"].map((id) => devinDesktopOAuth.exchangeToken(
      DEVIN_DESKTOP_CONFIG, `http://127.0.0.1:59653/callback?code=${id}&state=state-${id}`,
      "", `verifier-${id}`, `state-${id}`, null, { proxyUrl: `http://proxy-${id}.invalid` }, fetcher
    )));
    expect(results.map((result) => result.accessToken)).toEqual(["devin-session-token$synthetic-a", "devin-session-token$synthetic-b"]);
    expect(calls.map(({ url, parsed, proxyOptions }) => ({ url, parsed, proxyOptions }))).toEqual(["a", "b"].map((id) => ({
      url: DEVIN_DESKTOP_CONFIG.tokenUrl, parsed: { code: id, code_verifier: `verifier-${id}` }, proxyOptions: { proxyUrl: `http://proxy-${id}.invalid` },
    })));
    expect(await refreshDevinDesktopSession()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a foreign callback before network and conceals upstream response bodies", async () => {
    const fetcher = vi.fn(async () => new Response("synthetic-secret", { status: 401 }));
    await expect(devinDesktopOAuth.exchangeToken(DEVIN_DESKTOP_CONFIG, "http://localhost/callback?code=secret&state=foreign", "", "verifier", "owned", null, null, fetcher)).rejects.toThrow("state mismatch");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(devinDesktopOAuth.exchangeToken(DEVIN_DESKTOP_CONFIG, "code", "", "verifier", "owned", null, null, fetcher)).rejects.toThrow(/^Devin token exchange failed: 401$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

async function post(provider, action, body) {
  return POST(new Request(`http://localhost/api/oauth/${provider}/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ provider, action }) });
}

describe("bound Devin OAuth handler", () => {
  beforeEach(() => {
    clearOAuthFlowsForTests();
    createProviderConnection.mockReset();
    createProviderConnection.mockImplementation(async (record, options = {}) => {
      if (options.shouldCommit && !options.shouldCommit()) throw new Error("cancelled");
      return { id: `connection-${createProviderConnection.mock.calls.length}`, ...record };
    });
  });

  it("binds distinct accounts to their verifier and rejects a replay after accepted work", async () => {
    const calls = [];
    const fetcher = vi.fn(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return Response.json({ token: `synthetic-${calls.at(-1).body.code}` });
    });
    vi.stubGlobal("fetch", fetcher);
    const starts = await Promise.all(["a", "b"].map(async (ownerId) => {
      const response = await post("devin-desktop", "authorize", { ownerId, proxyMode: "direct" });
      expect(response.status).toBe(200);
      return response.json();
    }));
    expect(starts[0].state).not.toBe(starts[1].state);
    expect(starts[0]).not.toHaveProperty("codeVerifier");
    const bad = await post("devin-desktop", "exchange", { flowId: starts[0].flowId, state: starts[1].state, code: "foreign" });
    expect(bad.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const exchanges = await Promise.all(starts.map((flow, i) => post("devin-desktop", "exchange", {
      flowId: flow.flowId, state: flow.state, code: `code-${i}`, codeVerifier: "attacker-verifier",
    })));
    expect(exchanges.map((response) => response.status)).toEqual([200, 200]);
    for (const [i, flow] of starts.entries()) {
      const payload = await exchanges[i].json();
      expect(JSON.stringify(payload)).not.toContain(`synthetic-code-${i}`);
      const call = calls.find(({ body }) => body.code === `code-${i}`);
      const challenge = new URL(flow.authUrl).searchParams.get("code_challenge");
      const { createHash } = await import("node:crypto");
      expect(createHash("sha256").update(call.body.code_verifier).digest("base64url")).toBe(challenge);
      expect(call.body.code_verifier).not.toBe("attacker-verifier");
    }
    expect(createProviderConnection.mock.calls.map(([record]) => record.accessToken).sort()).toEqual([
      "devin-session-token$synthetic-code-0", "devin-session-token$synthetic-code-1",
    ]);
    const replay = await post("devin-desktop", "exchange", { flowId: starts[0].flowId, state: starts[0].state, code: "code-0" });
    expect(replay.status).toBe(410);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects unsupported device and CLI browser modes before outbound traffic", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const provider of ["devin-cli", "devin-desktop"]) {
      expect((await post(provider, "device-code", {})).status).toBe(400);
    }
    expect((await post("devin-cli", "authorize", {})).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("invalidates an older flow for the same owner and rejects expired flow without exchange", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
      const first = await (await post("devin-desktop", "authorize", { ownerId: "owner" })).json();
      const second = await (await post("devin-desktop", "authorize", { ownerId: "owner" })).json();
      expect((await post("devin-desktop", "exchange", { flowId: first.flowId, state: first.state, code: "code" })).status).toBe(410);
      vi.setSystemTime(second.expiresAt + 1000);
      expect((await post("devin-desktop", "exchange", { flowId: second.flowId, state: second.state, code: "code" })).status).toBe(410);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

// Staging-only: replace with a positive provider-registration assertion when integrated.
describe("staged CLI import validation", () => {
  it("validates and maps the imported credential without changing production registration", async () => {
    const { mapDevinCliImport } = await import("../../src/lib/oauth/providerParity/devin/import.js");
    expect(getProvider("devin-cli").mapTokens).not.toBe(mapDevinCliImport);
    expect(() => mapDevinCliImport("short")).toThrow("Token is too short");
    expect(() => mapDevinCliImport({ token: {} })).toThrow("Invalid token payload");
    expect(mapDevinCliImport({ token: "  synthetic-cli-token-123  " })).toEqual({
      accessToken: "synthetic-cli-token-123", refreshToken: null, expiresIn: null,
      providerSpecificData: { authKind: "import_token" },
    });
  });
});
