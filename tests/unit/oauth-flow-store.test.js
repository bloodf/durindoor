import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OAUTH_TIMEOUT } from "@/lib/oauth/constants/oauth.js";
import {
  beginOAuthFlowIntent,
  cancelOAuthFlow,
  claimOAuthFlow,
  clearOAuthFlowsForTests,
  consumeOAuthFlow,
  createOAuthFlow,
  getOAuthFlow,
  invalidateOAuthFlows,
  isOAuthFlowClaimActive,
  releaseOAuthFlow,
  settleOAuthFlowClaim,
} from "@/lib/oauth/flowStore.js";

describe("OAuth flow store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    clearOAuthFlowsForTests();
  });

  afterEach(() => {
    clearOAuthFlowsForTests();
    vi.useRealTimers();
  });

  it("returns only an opaque descriptor and keeps exchange secrets server-side", () => {
    const created = createOAuthFlow({
      provider: "codex",
      state: "oauth-state",
      kind: "authorization",
      payload: {
        codeVerifier: "super-secret-verifier",
        redirectUri: "http://localhost/callback",
      },
    });

    expect(created.flowId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(created.flowId).not.toBe(created.state);
    expect(created.expiresAt - Date.now()).toBe(OAUTH_TIMEOUT);
    expect(JSON.stringify(created)).not.toContain("super-secret-verifier");
    expect(JSON.stringify(getOAuthFlow({ state: "oauth-state", provider: "codex" })))
      .not.toContain("super-secret-verifier");
  });

  it("claims atomically and consumes an authorization flow once", () => {
    const created = createOAuthFlow({
      provider: "codex",
      state: "oauth-state",
      payload: { codeVerifier: "verifier" },
    });

    const claim = claimOAuthFlow({ flowId: created.flowId, state: created.state, provider: "codex" });

    expect(isOAuthFlowClaimActive(claim)).toBe(true);
    expect(claim.payload).toEqual({ codeVerifier: "verifier" });
    expect(Object.isFrozen(claim.payload)).toBe(true);
    expect(claimOAuthFlow({ state: created.state, provider: "codex" })).toBeNull();
    expect(consumeOAuthFlow(claim)).toBe(true);
    expect(isOAuthFlowClaimActive(claim)).toBe(false);
    expect(getOAuthFlow({ flowId: created.flowId, provider: "codex" })).toBeNull();
    expect(consumeOAuthFlow(claim)).toBe(false);
  });

  it("releases a pending device claim so the next poll can claim it", () => {
    const created = createOAuthFlow({
      provider: "qwen",
      kind: "device",
      payload: { deviceCode: "server-only-device-code" },
    });

    const firstClaim = claimOAuthFlow({ flowId: created.flowId, provider: "qwen" });
    expect(settleOAuthFlowClaim(firstClaim, { pending: true })).toBe("released");

    const secondClaim = claimOAuthFlow({ flowId: created.flowId, provider: "qwen" });
    expect(secondClaim.payload.deviceCode).toBe("server-only-device-code");
    expect(settleOAuthFlowClaim(secondClaim, { pending: false })).toBe("consumed");
    expect(getOAuthFlow({ flowId: created.flowId, provider: "qwen" })).toBeNull();
  });

  it("does not release authorization flows through the device-pending path", () => {
    const created = createOAuthFlow({ provider: "codex", state: "state", payload: {} });
    const claim = claimOAuthFlow({ flowId: created.flowId, provider: "codex" });

    expect(releaseOAuthFlow(claim)).toBe(false);
    expect(settleOAuthFlowClaim(claim, { pending: true })).toBe("consumed");
    expect(getOAuthFlow({ flowId: created.flowId, provider: "codex" })).toBeNull();
  });

  it("invalidates active and claimed flows on cancel or provider restart", () => {
    const ownerIntent = beginOAuthFlowIntent("codex", "owner-1");
    const first = createOAuthFlow({ provider: "codex", state: "state-1", payload: {}, intent: ownerIntent });
    const claimed = claimOAuthFlow({ flowId: first.flowId, provider: "codex" });
    const second = createOAuthFlow({ provider: "codex", state: "state-2", payload: {}, intent: ownerIntent });
    const other = createOAuthFlow({ provider: "xai", state: "state-3", payload: {} });

    expect(cancelOAuthFlow({ state: "state-1", provider: "codex" })).toBe(true);
    expect(isOAuthFlowClaimActive(claimed)).toBe(false);
    expect(consumeOAuthFlow(claimed)).toBe(false);
    expect(invalidateOAuthFlows({ provider: "codex", ownerId: "owner-1" })).toBe(1);
    expect(getOAuthFlow({ flowId: second.flowId, provider: "codex" })).toBeNull();
    expect(getOAuthFlow({ flowId: other.flowId, provider: "xai" })).not.toBeNull();
  });

  it("expires flows at the bounded server-side TTL", () => {
    const created = createOAuthFlow({
      provider: "codex",
      state: "expiring-state",
      ttlMs: OAUTH_TIMEOUT * 2,
      payload: {},
    });

    expect(created.expiresAt - Date.now()).toBe(OAUTH_TIMEOUT);
    vi.advanceTimersByTime(OAUTH_TIMEOUT);

    expect(getOAuthFlow({ flowId: created.flowId, provider: "codex" })).toBeNull();
    expect(claimOAuthFlow({ state: created.state, provider: "codex" })).toBeNull();
  });

  it("rejects ambiguous selectors and duplicate state aliases", () => {
    const first = createOAuthFlow({ provider: "codex", state: "same-state", payload: {} });
    const second = createOAuthFlow({ provider: "codex", state: "other-state", payload: {} });

    expect(() => createOAuthFlow({ provider: "xai", state: "same-state", payload: {} }))
      .toThrow(/already exists/i);
    expect(claimOAuthFlow({
      flowId: first.flowId,
      state: second.state,
      provider: "codex",
    })).toBeNull();
  });

  it("prevents a slower superseded request from creating a late flow", () => {
    const firstIntent = beginOAuthFlowIntent("codex", "owner-1");
    const secondIntent = beginOAuthFlowIntent("codex", "owner-1");

    expect(() => createOAuthFlow({
      provider: "codex",
      state: "late-state",
      intent: firstIntent,
      payload: {},
    })).toThrow(/superseded/i);
    expect(createOAuthFlow({
      provider: "codex",
      state: "current-state",
      intent: secondIntent,
      payload: {},
    })).toEqual(expect.objectContaining({ state: "current-state" }));
  });

  it("keeps independent same-provider owners isolated", () => {
    const firstIntent = beginOAuthFlowIntent("codex", "owner-1");
    const first = createOAuthFlow({
      provider: "codex", state: "owner-1-state", intent: firstIntent, payload: {},
    });
    const secondIntent = beginOAuthFlowIntent("codex", "owner-2");
    const second = createOAuthFlow({
      provider: "codex", state: "owner-2-state", intent: secondIntent, payload: {},
    });

    expect(getOAuthFlow({ flowId: first.flowId, provider: "codex" })).not.toBeNull();
    expect(getOAuthFlow({ flowId: second.flowId, provider: "codex" })).not.toBeNull();
  });

  it("requires the official single-process runtime capability in production", () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldCapability = process.env.DURINDOOR_SINGLE_PROCESS_RUNTIME;
    process.env.NODE_ENV = "production";
    delete process.env.DURINDOOR_SINGLE_PROCESS_RUNTIME;
    try {
      expect(() => beginOAuthFlowIntent("codex", "owner-1")).toThrow(/single-process/i);
      process.env.DURINDOOR_SINGLE_PROCESS_RUNTIME = "1";
      expect(beginOAuthFlowIntent("codex", "owner-1")).toMatchObject({ ownerId: "owner-1" });
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      if (oldCapability === undefined) delete process.env.DURINDOOR_SINGLE_PROCESS_RUNTIME;
      else process.env.DURINDOOR_SINGLE_PROCESS_RUNTIME = oldCapability;
    }
  });
});
