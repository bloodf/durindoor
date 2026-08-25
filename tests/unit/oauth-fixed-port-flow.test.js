import http from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeAndSaveAuthorizationCode: vi.fn(),
}));

vi.mock("@/lib/oauth/flowCompletion.js", () => ({
  exchangeAndSaveAuthorizationCode: mocks.exchangeAndSaveAuthorizationCode,
}));

import {
  clearOAuthFlowsForTests,
  createOAuthFlow,
  getOAuthFlow,
} from "@/lib/oauth/flowStore.js";
import {
  clearCodexSession,
  clearXaiSession,
  getCodexSessionStatus,
  getXaiSessionStatus,
  isLoopbackOrigin,
  registerCodexSession,
  registerXaiSession,
  startCodexProxy,
  startLocalServer,
  stopCodexProxy,
  stopXaiProxy,
} from "@/lib/oauth/utils/server.js";

function callbackRequest(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path,
      method: "GET",
      headers: { Connection: "close", ...headers },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

describe("fixed-port OAuth flow binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOAuthFlowsForTests();
  });

  afterEach(async () => {
    await Promise.all([stopCodexProxy(), stopXaiProxy()]);
    clearCodexSession("codex-state");
    clearXaiSession("xai-state");
    clearOAuthFlowsForTests();
  });

  it("registers only matching opaque flows and exposes no exchange secrets", async () => {
    const codex = createOAuthFlow({
      provider: "codex",
      state: "codex-state",
      payload: {
        codeVerifier: "codex-secret-verifier",
        redirectUri: "http://localhost:1455/auth/callback",
        proxySelection: { mode: "strict-pool", poolId: "pool-1" },
      },
    });
    const xai = createOAuthFlow({
      provider: "xai",
      state: "xai-state",
      payload: {
        codeVerifier: "xai-secret-verifier",
        redirectUri: "http://127.0.0.1:56121/callback",
        proxySelection: { mode: "direct" },
      },
    });

    expect(await startCodexProxy(20127)).toEqual({ success: true });
    const { startXaiProxy } = await import("@/lib/oauth/utils/server.js");
    expect(await startXaiProxy(20127)).toEqual({ success: true });
    expect(registerCodexSession({ state: codex.state, flowId: codex.flowId })).toBe(true);
    expect(registerXaiSession({ state: xai.state, flowId: xai.flowId })).toBe(true);
    expect(registerCodexSession({ state: codex.state, flowId: xai.flowId })).toBe(false);

    const codexStatus = getCodexSessionStatus(codex.state);
    const xaiStatus = getXaiSessionStatus(xai.state);
    expect(codexStatus).toEqual(expect.objectContaining({ flowId: codex.flowId, status: "pending" }));
    expect(xaiStatus).toEqual(expect.objectContaining({ flowId: xai.flowId, status: "pending" }));
    expect(JSON.stringify({ codexStatus, xaiStatus })).not.toContain("secret-verifier");
    expect(JSON.stringify({ codexStatus, xaiStatus })).not.toContain("pool-1");
  });

  it("claims and consumes a Codex state exactly once in server-side mode", async () => {
    const flow = createOAuthFlow({
      provider: "codex",
      state: "codex-state",
      payload: {
        codeVerifier: "server-verifier",
        redirectUri: "http://localhost:1455/auth/callback",
        proxySelection: { mode: "direct" },
      },
    });
    mocks.exchangeAndSaveAuthorizationCode.mockResolvedValue({
      connection: { id: "connection-1", email: "user@example.test" },
    });

    expect(await startCodexProxy(20127)).toEqual({ success: true });
    expect(registerCodexSession({ state: flow.state, flowId: flow.flowId })).toBe(true);
    const response = await callbackRequest(
      1455,
      "/auth/callback?code=oauth-code&state=codex-state",
    );

    expect(response.status).toBe(200);
    expect(response.body).toContain("Authentication Successful");
    expect(mocks.exchangeAndSaveAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(mocks.exchangeAndSaveAuthorizationCode).toHaveBeenCalledWith(
      "codex",
      "oauth-code",
      "codex-state",
      expect.objectContaining({
        flowId: flow.flowId,
        payload: expect.objectContaining({ codeVerifier: "server-verifier" }),
      }),
    );
    expect(getOAuthFlow({ flowId: flow.flowId, provider: "codex" })).toBeNull();
    expect(getCodexSessionStatus("codex-state")).toEqual(expect.objectContaining({
      status: "done",
      connectionId: "connection-1",
    }));
  });

  it("preserves the legacy Mode B redirect when no server flow is registered", async () => {
    expect(await startCodexProxy(20127)).toEqual({ success: true });
    const response = await callbackRequest(
      1455,
      "/auth/callback?code=legacy-code&state=legacy-state",
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      "http://localhost:20127/callback?code=legacy-code&state=legacy-state",
    );
    expect(mocks.exchangeAndSaveAuthorizationCode).not.toHaveBeenCalled();
  });

  it("rejects a stale callback without stopping the successor server", async () => {
    const oldFlow = createOAuthFlow({
      provider: "codex",
      state: "old-state",
      payload: { codeVerifier: "old", redirectUri: "http://localhost/callback" },
    });
    expect(await startCodexProxy(20127)).toEqual({ success: true });
    expect(registerCodexSession({ state: oldFlow.state, flowId: oldFlow.flowId })).toBe(true);
    await stopCodexProxy();

    const newFlow = createOAuthFlow({
      provider: "codex",
      state: "codex-state",
      payload: { codeVerifier: "new", redirectUri: "http://localhost/callback" },
    });
    expect(await startCodexProxy(20127)).toEqual({ success: true });
    expect(registerCodexSession({ state: newFlow.state, flowId: newFlow.flowId })).toBe(true);
    mocks.exchangeAndSaveAuthorizationCode.mockResolvedValue({
      connection: { id: "connection-new", email: "new@example.test" },
    });

    const stale = await callbackRequest(1455, "/auth/callback?code=old-code&state=old-state");
    expect(stale.status).toBe(400);
    expect(getCodexSessionStatus("codex-state")).toEqual(expect.objectContaining({ status: "pending" }));

    const current = await callbackRequest(1455, "/auth/callback?code=new-code&state=codex-state");
    expect(current.status).toBe(200);
    expect(mocks.exchangeAndSaveAuthorizationCode).toHaveBeenCalledWith(
      "codex",
      "new-code",
      "codex-state",
      expect.objectContaining({ flowId: newFlow.flowId }),
    );
  });

  it("keeps the shared listener alive when a newer flow supersedes an in-flight callback", async () => {
    let finishOldExchange;
    const oldExchange = new Promise((resolve) => {
      finishOldExchange = resolve;
    });
    mocks.exchangeAndSaveAuthorizationCode
      .mockReturnValueOnce(oldExchange)
      .mockResolvedValueOnce({
        connection: { id: "connection-new", email: "new@example.test" },
      });

    const oldFlow = createOAuthFlow({
      provider: "codex",
      state: "old-processing-state",
      payload: { codeVerifier: "old", redirectUri: "http://localhost/callback" },
    });
    expect(await startCodexProxy(20127)).toEqual({ success: true });
    expect(registerCodexSession({ state: oldFlow.state, flowId: oldFlow.flowId })).toBe(true);

    const oldCallback = callbackRequest(
      1455,
      "/auth/callback?code=old-code&state=old-processing-state",
    );
    await vi.waitFor(() => {
      expect(mocks.exchangeAndSaveAuthorizationCode).toHaveBeenCalledTimes(1);
    });

    const newFlow = createOAuthFlow({
      provider: "codex",
      state: "codex-state",
      payload: { codeVerifier: "new", redirectUri: "http://localhost/callback" },
    });
    expect(registerCodexSession({ state: newFlow.state, flowId: newFlow.flowId })).toBe(true);

    finishOldExchange({
      connection: { id: "connection-old", email: "old@example.test" },
    });
    expect((await oldCallback).status).toBe(200);
    expect(getCodexSessionStatus("codex-state")).toEqual(expect.objectContaining({
      flowId: newFlow.flowId,
      status: "pending",
    }));

    const current = await callbackRequest(
      1455,
      "/auth/callback?code=new-code&state=codex-state",
    );
    expect(current.status).toBe(200);
    expect(mocks.exchangeAndSaveAuthorizationCode).toHaveBeenLastCalledWith(
      "codex",
      "new-code",
      "codex-state",
      expect.objectContaining({ flowId: newFlow.flowId }),
    );
  });
});

describe("isLoopbackOrigin", () => {
  it("allows a missing Origin but rejects an empty Origin header", () => {
    expect(isLoopbackOrigin(undefined)).toBe(true);
    expect(isLoopbackOrigin(null)).toBe(true);
    expect(isLoopbackOrigin("")).toBe(false);
  });

  it("allows localhost and 127.0.0.1 loopback origins", () => {
    expect(isLoopbackOrigin("http://localhost:1455")).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1:56121")).toBe(true);
    expect(isLoopbackOrigin("http://localhost")).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1")).toBe(true);
  });

  it("rejects non-loopback origins", () => {
    expect(isLoopbackOrigin("https://attacker.example")).toBe(false);
    expect(isLoopbackOrigin("http://evil.local")).toBe(false);
    expect(isLoopbackOrigin("https://localhost")).toBe(false);
  });
});

describe("local OAuth callback Origin guard", () => {
  afterEach(async () => {
    await Promise.all([stopCodexProxy(), stopXaiProxy()]);
  });

  it("rejects Codex proxy callbacks with a non-loopback Origin", async () => {
    expect(await startCodexProxy(20127)).toEqual({ success: true });
    const response = await callbackRequest(
      1455,
      "/auth/callback?code=csrf-code&state=csrf-state",
      { Origin: "https://attacker.example" },
    );

    expect(response.status).toBe(403);
    expect(response.body).toContain("Cross-origin callback rejected");
  });

  it("rejects xAI proxy callbacks with a non-loopback Origin", async () => {
    const { startXaiProxy } = await import("@/lib/oauth/utils/server.js");
    expect(await startXaiProxy(20127)).toEqual({ success: true });
    const response = await callbackRequest(
      56121,
      "/callback?code=csrf-code&state=csrf-state",
      { Origin: "https://attacker.example" },
    );

    expect(response.status).toBe(403);
    expect(response.body).toContain("Cross-origin callback rejected");
  });

  it("allows startLocalServer callbacks without Origin", async () => {
    let received = null;
    const { port, close } = await startLocalServer((params) => {
      received = params;
    });

    const response = await callbackRequest(
      port,
      "/callback?code=local-code&state=local-state",
    );
    await close();

    expect(response.status).toBe(200);
    expect(response.body).toContain("Authentication Successful");
    expect(received).toEqual({ code: "local-code", state: "local-state" });
  });

  it("rejects startLocalServer callbacks with a non-loopback Origin", async () => {
    let received = null;
    const { port, close } = await startLocalServer((params) => {
      received = params;
    });

    const response = await callbackRequest(
      port,
      "/callback?code=csrf-code&state=csrf-state",
      { Origin: "https://attacker.example" },
    );
    await close();

    expect(response.status).toBe(403);
    expect(response.body).toBe("Cross-origin callback rejected");
    expect(received).toBeNull();
  });
});
