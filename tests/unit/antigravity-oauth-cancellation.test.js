import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Dashboard sign-in cancellation reaches the Antigravity onboarding poll.
// Everything below is a closed mock: synthetic tokens, synthetic projects, no
// network. Upstream reference for the behavior: router-for-me/CLIProxyAPI and
// OmniRoute both stop the onboarding request and its poll delay when the
// caller goes away.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ag-cancel-"));
const previous = { ...process.env };
process.env.DATA_DIR = tempDir;
process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = "test-client";
process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = "test-secret";
process.env.ANTIGRAVITY_ONBOARD_MAX_ATTEMPTS = "3";
process.env.ANTIGRAVITY_ONBOARD_RETRY_DELAY_MS = "5000";

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => Response.json(body, init) },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));

let providers, route, db;
const calls = [];

// Mocked upstream state; reset before each test.
const state = { onboardQueue: [], hangOnboard: false };

function abortError() {
  return new DOMException("This operation was aborted", "AbortError");
}

// A request that stays open until its signal aborts, like a real fetch.
function hang(signal) {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    signal?.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

const providerFetch = vi.fn(async (input, options = {}) => {
  const url = String(input);
  calls.push({ url, options });
  if (url.includes("oauth2.googleapis.com/token")) {
    return Response.json({ access_token: "access-c", refresh_token: "refresh-c", expires_in: 3600 });
  }
  if (url.includes("userinfo")) return Response.json({ email: "cancel@example.test" });
  if (url.includes(":loadCodeAssist")) {
    return Response.json({ allowedTiers: [{ id: "free-tier", isDefault: true }] });
  }
  if (url.includes(":onboardUser")) {
    if (state.hangOnboard) return hang(options.signal);
    const next = state.onboardQueue.length
      ? state.onboardQueue.shift()
      : { done: true, response: { cloudaicompanionProject: { id: "project-c" } } };
    return Response.json(next);
  }
  throw new Error(`Unexpected outbound URL: ${url}`);
});

const onboardCalls = () => calls.filter(({ url }) => url.includes(":onboardUser"));
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function until(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await flush();
  expect(predicate()).toBe(true);
}

function exchange(signal) {
  return providers.exchangeTokens(
    "antigravity", "code", "http://localhost/callback", "verifier", "state", {}, null, signal
  );
}

beforeAll(async () => {
  vi.stubGlobal("fetch", providerFetch);
  providers = await import("@/lib/oauth/providers.js");
  route = await import("@/app/api/oauth/[provider]/[action]/route.js");
  db = await import("@/lib/localDb");
  // Importing open-sse installs its fetch wrapper; restore the closed mock.
  vi.stubGlobal("fetch", providerFetch);
}, 60_000);

beforeEach(() => {
  calls.length = 0;
  state.onboardQueue = [];
  state.hangOnboard = false;
  providerFetch.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  vi.unstubAllGlobals();
  process.env = previous;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Antigravity onboarding cancellation", () => {
  it("completes unchanged when the signal never fires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    state.onboardQueue = [
      { done: false },
      { done: true, response: { cloudaicompanionProject: { id: "project-polled" } } },
    ];
    const controller = new AbortController();
    const pending = exchange(controller.signal);
    await until(() => onboardCalls().length === 1);
    await vi.advanceTimersByTimeAsync(5000);
    const tokens = await pending;
    expect(tokens).toMatchObject({
      accessToken: "access-c",
      email: "cancel@example.test",
      projectId: "project-polled",
    });
    expect(onboardCalls()).toHaveLength(2);
    // Every outbound request combines the callback signal with a deadline.
    controller.abort();
    for (const { url, options } of calls) {
      expect(options.signal.aborted, url).toBe(true);
      expect(options.signal.reason, url).toBe(controller.signal.reason);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("completes unchanged without any signal", async () => {
    const tokens = await exchange(undefined);
    expect(tokens.projectId).toBe("project-c");
    expect(onboardCalls()).toHaveLength(1);
  });

  it("stops at once when aborted before the exchange", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await exchange(controller.signal).catch((e) => e);
    expect(error).toBeInstanceOf(providers.OAuthCancelledError);
    expect(error.code).toBe("OAUTH_CANCELLED");
    expect(calls).toHaveLength(0);
  });

  it("stops when aborted during the onboarding request", async () => {
    state.hangOnboard = true;
    const controller = new AbortController();
    const pending = exchange(controller.signal).catch((e) => e);
    await until(() => onboardCalls().length === 1);
    controller.abort();
    const error = await pending;
    expect(error).toBeInstanceOf(providers.OAuthCancelledError);
    expect(error.code).toBe("OAUTH_CANCELLED");
    // A cancellation is not a project failure.
    expect(error.message).not.toMatch(/project|onboarding failed/i);
    await flush();
    expect(onboardCalls()).toHaveLength(1);
  });

  it("stops during a poll delay and sends no further request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    state.onboardQueue = [{ done: false }, { done: false }];
    const controller = new AbortController();
    const pending = exchange(controller.signal).catch((e) => e);
    await until(() => onboardCalls().length === 1);
    // The first poll answered done:false; the 5 s delay is now pending.
    await until(() => vi.getTimerCount() === 1);
    controller.abort();
    const error = await pending;
    expect(error).toBeInstanceOf(providers.OAuthCancelledError);
    expect(error.code).toBe("OAUTH_CANCELLED");
    // The delay timer is released and running the clock sends nothing more.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onboardCalls()).toHaveLength(1);
  });

  it("keeps the signal optional on the shared exchange path", async () => {
    // The trailing argument is optional for every other provider: the shared
    // path stays callable without it.
    expect(providers.exchangeTokens.length).toBeGreaterThanOrEqual(6);
    expect(providers.throwIfOAuthCancelled(undefined)).toBeUndefined();
    expect(() => providers.throwIfOAuthCancelled(AbortSignal.abort())).toThrow(providers.OAuthCancelledError);
  });
});

describe("Antigravity OAuth route cancellation", () => {
  async function post(action, body, signal) {
    return route.POST(new Request(`http://localhost/api/oauth/antigravity/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : null),
    }), { params: Promise.resolve({ provider: "antigravity", action }) });
  }

  async function start() {
    const response = await post("authorize", { redirectUri: "http://localhost/callback", proxyMode: "direct" });
    return response.json();
  }

  it("forwards the request signal, saves nothing and reports a cancelled outcome", async () => {
    state.hangOnboard = true;
    const flow = await start();
    const before = await db.getProviderConnections({ provider: "antigravity" });
    const controller = new AbortController();
    const pending = post("exchange", { code: "code", state: flow.state, flowId: flow.flowId }, controller.signal);
    await until(() => onboardCalls().length === 1);
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect((await response.json()).error).toMatch(/cancelled/i);
    const after = await db.getProviderConnections({ provider: "antigravity" });
    expect(after).toHaveLength(before.length);
    expect(onboardCalls()).toHaveLength(1);
  });

  it("saves the account when the request is not cancelled", async () => {
    const flow = await start();
    const controller = new AbortController();
    const response = await post("exchange", { code: "code", state: flow.state, flowId: flow.flowId }, controller.signal);
    expect(response.status).toBe(200);
    const body = await response.json();
    const saved = await db.getProviderConnectionById(body.connection.id);
    expect(saved.projectId).toBe("project-c");
  });
});
