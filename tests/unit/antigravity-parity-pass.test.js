import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const workDir = path.resolve(import.meta.dirname, "../../.work");
fs.mkdirSync(workDir, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(workDir, "antigravity-parity-"));
vi.stubEnv("DATA_DIR", dataDir);
vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "parity-client");
vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "parity-secret");
vi.stubEnv("ANTIGRAVITY_ONBOARD_MAX_ATTEMPTS", "2");
vi.stubEnv("ANTIGRAVITY_ONBOARD_RETRY_DELAY_MS", "0");

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init) => Response.json(body, init) },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (...args) => outbound(...args),
}));

let route, db, projects, chat, AntigravityExecutor;
let replies;
const outbound = vi.fn(async (input) => {
  const url = new URL(input);
  const operation = url.pathname.split(/[/:]/).at(-1);
  const reply = replies[operation]?.shift();
  if (reply) return reply();
  throw new Error(`Unexpected outbound request: ${url}`);
});

const json = (body, status = 200) => () => Response.json(body, { status });

beforeAll(async () => {
  vi.stubGlobal("fetch", outbound);
  route = await import("@/app/api/oauth/[provider]/[action]/route.js");
  db = await import("@/lib/localDb");
  chat = await import("@/app/api/v1/chat/completions/route.js");
  projects = await import("open-sse/services/projectId.js");
  ({ AntigravityExecutor } = await import("open-sse/executors/antigravity.js"));
  vi.stubGlobal("fetch", outbound);
}, 60_000);

beforeEach(() => {
  replies = {
    token: [json({ access_token: "access-parity", refresh_token: "refresh-parity" })],
    userinfo: [json({ email: " parity@example.test " })],
    loadCodeAssist: [json({})],
    onboardUser: [],
  };
  outbound.mockClear();
});

afterAll(() => {
  projects?.stopCacheCleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function post(action, body, signal) {
  return route.POST(new Request(`http://localhost/api/oauth/antigravity/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }), { params: Promise.resolve({ provider: "antigravity", action }) });
}

async function signIn(signal) {
  const authorization = await post("authorize", { redirectUri: "http://localhost/callback", proxyMode: "direct" });
  const { state, flowId } = await authorization.json();
  return post("exchange", { code: "parity-code", state, flowId }, signal);
}

function polls() {
  return outbound.mock.calls.filter(([url]) => String(url).endsWith(":onboardUser"));
}

describe("Antigravity project provisioning parity", () => {
  it.each([
    [{ allowedTiers: [null, { isDefault: true, id: " " }, { isDefault: true, id: " paid-tier " }] }, "paid-tier", null],
    [{ currentTier: { id: " current-tier " } }, "current-tier", "   "],
    [{}, "free-tier", {}],
  ])("selects a usable tier and accepts the terminal project alias", async (load, tier, error) => {
    replies.loadCodeAssist = [json(load)];
    replies.onboardUser = [
      json({ done: false }),
      json({ done: true, error, response: { cloudaicompanionProject: "", projectId: { id: " provisioned " } } }),
    ];
    const response = await signIn();
    expect(response.status, await response.clone().text()).toBe(200);
    const connection = await db.getProviderConnectionById((await response.json()).connection.id);
    expect(connection).toMatchObject({ projectId: "provisioned", email: "parity@example.test" });
    expect(polls()).toHaveLength(2);
    for (const [, options] of polls()) {
      const body = JSON.parse(options.body);
      expect(body).toHaveProperty("tier_id", tier);
      expect(body).not.toHaveProperty("tierId");
    }
  });

  it("uses the loaded project alias without polling", async () => {
    replies.loadCodeAssist = [json({ cloudaicompanionProject: { id: 123 }, project: " existing " })];
    const response = await signIn();
    expect(response.status, await response.clone().text()).toBe(200);
    const connection = await db.getProviderConnectionById((await response.json()).connection.id);
    expect(connection.projectId).toBe("existing");
    expect(polls()).toHaveLength(0);
  });

  it.each([
    ["token", json({ access_token: " " }), "did not return an access token", 1],
    ["token", json({}, 429), "token exchange failed: 429", 1],
    ["userinfo", json({}, 403), "user info failed: 403", 2],
    ["userinfo", json({ email: " " }), "did not return an email", 2],
    ["loadCodeAssist", json([], 200), "Invalid Antigravity OAuth response", 3],
    ["onboardUser", json({}, 429), "onboarding failed: 429", 4],
    ["onboardUser", () => new Response("bad JSON"), "JSON", 4],
    ["onboardUser", json({ done: true, error: " denied ", response: { project: "ignored" } }), "operation error: denied", 4],
    ["onboardUser", json({ done: true, error: [] }), "operation error: []", 4],
  ])("stops on a terminal %s failure with no credential write", async (operation, reply, message, count) => {
    replies[operation] = [reply];
    const before = await db.getProviderConnections({ provider: "antigravity" });
    const response = await signIn();
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain(message);
    expect(outbound).toHaveBeenCalledTimes(count);
    expect(await db.getProviderConnections({ provider: "antigravity" })).toEqual(before);
  });

  it("propagates cancellation into the authorization-code exchange", async () => {
    const controller = new AbortController();
    const tokenCall = Promise.withResolvers();
    replies.token = [() => tokenCall.promise];
    const before = await db.getProviderConnections({ provider: "antigravity" });
    const response = signIn(controller.signal);
    await vi.waitFor(() => expect(outbound).toHaveBeenCalledTimes(1));
    const [, options] = outbound.mock.calls[0];
    expect(options.signal.aborted).toBe(false);
    controller.abort();
    expect(options.signal.aborted).toBe(true);
    tokenCall.reject(options.signal.reason);
    expect((await response).status).toBe(499);
    expect(await db.getProviderConnections({ provider: "antigravity" })).toEqual(before);
  });

  it.each([
    [{ code: 403 }, 403],
    [{ status: " resource_exhausted " }, 429],
    [{ code: 16 }, 401],
    [{ message: "unclassified" }, 502],
  ])("classifies a runtime terminal operation error without caching its project", async (error, status) => {
    replies.onboardUser = [json({ done: true, error, response: { projectId: "ignored" } })];
    const lookup = () => projects.getProjectIdForConnection(`parity-${status}`, "synthetic-access", {}, null, "antigravity");
    await expect(lookup()).rejects.toMatchObject({ status, credentialScoped: true });
    expect(polls()).toHaveLength(1);
    expect(JSON.parse(polls()[0][1].body).tier_id).toBe("free-tier");

    replies.loadCodeAssist = [json({ project: { id: "next-attempt" } })];
    await expect(lookup()).resolves.toBe("next-attempt");
  });
});


describe("Antigravity executor refresh parity", () => {
  it.each([
    [json({ error: "invalid_grant" }, 400), { error: "invalid_grant" }],
    [json({ error: "invalid_client" }, 401), null],
    [() => new Response("Service unavailable", { status: 503 }), null],
    [json({ access_token: " " }), null],
    [json({ access_token: " rotated ", refresh_token: "", expires_in: 3600 }),
      { accessToken: "rotated", refreshToken: "synthetic-refresh", expiresIn: 3600, projectId: "bound-project" }],
  ])("classifies the closed token response without falling back to another account", async (reply, expected) => {
    replies.token = [reply];
    const executor = new AntigravityExecutor();
    await expect(executor.refreshCredentials({
      refreshToken: "synthetic-refresh",
      projectId: "bound-project",
    })).resolves.toEqual(expected);
    expect(outbound).toHaveBeenCalledTimes(1);
    const [, options] = outbound.mock.calls[0];
    expect(options.body.get("grant_type")).toBe("refresh_token");
    expect(options.body.get("refresh_token")).toBe("synthetic-refresh");
  });
});


it("sends the selected connection's user agent through the chat gateway", async () => {
  const connections = await db.getProviderConnections({ provider: "antigravity" });
  for (const connection of connections) {
    await db.updateProviderConnection(connection.id, { isActive: false });
  }
  const connection = await db.createProviderConnection({
    provider: "antigravity",
    authType: "oauth",
    email: "wire@example.test",
    accessToken: "synthetic-inference-access",
    projectId: "wire-project",
    providerSpecificData: { user_agent: "  parity-agent/1  " },
    isActive: true,
  });
  try {
    replies.generateContent = [json({
      response: {
        candidates: [{ content: { role: "model", parts: [{ text: "Wire hello" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2, totalTokenCount: 4 },
      }
    })];
    const response = await chat.POST(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "ag/gemini-3-flash",
        stream: false,
        messages: [{ role: "user", content: "Hello" }],
      }),
    }));
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).toContain("Wire hello");
    const [, options] = outbound.mock.calls.find(([url]) => String(url).endsWith(":generateContent"));
    expect(new Headers(options.headers).get("user-agent")).toBe("parity-agent/1");
    expect(new Headers(options.headers).get("authorization")).toBe("Bearer synthetic-inference-access");
    expect(JSON.parse(options.body).project).toBe("wire-project");
  } finally {
    await db.updateProviderConnection(connection.id, { isActive: false });
    for (const existing of connections) {
      if (existing.isActive) await db.updateProviderConnection(existing.id, { isActive: true });
    }
  }
});
