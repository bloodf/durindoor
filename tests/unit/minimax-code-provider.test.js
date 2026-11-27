import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// MiniMax Code account provider (#2034): device sign-in, refresh and guarded managed-gateway
// chat. Closed mocks only: every account and gateway call below is answered by a synthetic
// fetch, and every token is a placeholder that MiniMax never issued. The provider and executor
// come from the production registry and executor map; nothing is composed here.
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({ ...(await importOriginal()), appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), saveRequestDetail: vi.fn(() => Promise.resolve()), saveRequestUsage: vi.fn(() => Promise.resolve()) }));

const GATEWAY_URL = "https://agent.minimax.io/mavis/api/v1/llm/v1/messages";
const EN = "https://account.minimax.io";
const CN = "https://account.minimax.cn";
const DEVICE_CODE_RAW = "synthetic-device-code";
const USER_CODE = "ABCD-1234";

const TOKEN_A = "mmc_synthetic_access_alpha";
const TOKEN_B = "mmc_synthetic_access_beta";
const REFRESH_A = "mmc_synthetic_refresh_alpha";
const REFRESH_B = "mmc_synthetic_refresh_beta";

let root, routes, handleChat, MinimaxCodeExecutor, provider, auth, oauthProvider, repo;
const wire = { calls: [], live: new Set(), refreshable: new Map(), devicePolls: 0, deviceOutcome: "success", gatewayStatus: null, gatewayBody: null, accountDown: false, nextRefreshId: 0 };

const request = (url, body, method = "POST") => new Request(`http://gateway.invalid${url}`, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
const headerOf = (init) => Object.fromEntries(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
const formOf = (init) => Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
const sha256Url = (value) => crypto.createHash("sha256").update(value).digest("base64url");

const message = (text) => ({ id: "msg_synthetic", type: "message", role: "assistant", model: "MiniMax-M3", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 3, output_tokens: 2 } });
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const streamBody = () => [
  sse("message_start", { type: "message_start", message: { id: "msg_synthetic", type: "message", role: "assistant", model: "MiniMax-M3", content: [], usage: { input_tokens: 3, output_tokens: 0 } } }),
  sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hel" } }),
  sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } }),
  sse("content_block_stop", { type: "content_block_stop", index: 0 }),
  sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }),
  sse("message_stop", { type: "message_stop" }),
].join("");

let challengeOf = new Map();
const syntheticUpstream = async (url, init = {}) => {
  const target = String(url);
  const headers = headerOf(init);
  const form = init.body && target.includes("/oauth2/") ? formOf(init) : null;
  wire.calls.push({ url: target, headers, form, body: init.body && !form ? JSON.parse(init.body) : null, redirect: init.redirect });
  if (wire.accountDown && target.includes("/oauth2/")) throw new TypeError("fetch failed");

  if (target === `${EN}/oauth2/device/code` || target === `${CN}/oauth2/device/code`) {
    challengeOf.set(DEVICE_CODE_RAW, form.code_challenge);
    return Response.json({ device_code: DEVICE_CODE_RAW, user_code: USER_CODE, verification_uri: "https://account.example.invalid/device", verification_uri_complete: "https://account.example.invalid/device?code=ABCD-1234", expires_in: 600, interval: 5 });
  }
  if (target === `${EN}/oauth2/token` || target === `${CN}/oauth2/token`) {
    if (form.grant_type === "urn:ietf:params:oauth:grant-type:device_code") {
      if (form.device_code !== DEVICE_CODE_RAW || sha256Url(form.code_verifier ?? "") !== challengeOf.get(DEVICE_CODE_RAW)) return Response.json({ error: "invalid_grant" }, { status: 400 });
      wire.devicePolls += 1;
      if (wire.deviceOutcome === "pending") return Response.json({ error: "authorization_pending" }, { status: 400 });
      if (wire.deviceOutcome === "denied") return Response.json({ error: "access_denied", error_description: "the user denied the request" }, { status: 400 });
      if (wire.deviceOutcome === "expired") return Response.json({ error: "expired_token" }, { status: 400 });
      wire.live.add(TOKEN_A);
      wire.refreshable.set(REFRESH_A, "alpha");
      return Response.json({ access_token: TOKEN_A, refresh_token: REFRESH_A, expires_in: 7200, token_type: "Bearer" });
    }
    if (form.grant_type === "refresh_token") {
      const owner = wire.refreshable.get(form.refresh_token);
      if (!owner) return Response.json({ error: "invalid_grant", error_description: "refresh token revoked" }, { status: 400 });
      wire.nextRefreshId += 1;
      const access = `mmc_rotated_access_${owner}_${wire.nextRefreshId}`;
      const refresh = `mmc_rotated_refresh_${owner}_${wire.nextRefreshId}`;
      wire.refreshable.delete(form.refresh_token); // one-time use: the token rotates
      wire.refreshable.set(refresh, owner);
      wire.live.add(access);
      return Response.json({ access_token: access, refresh_token: refresh, expires_in: 3600 });
    }
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }
  if (target === GATEWAY_URL) {
    const bearer = (headers.authorization ?? "").replace(/^Bearer /, "");
    if (!wire.live.has(bearer)) return Response.json({ type: "error", error: { type: "authentication_error", message: "invalid token" } }, { status: 401 });
    if (wire.gatewayStatus === 429) return new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "plan quota reached" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "17" } });
    if (wire.gatewayStatus === 400) return Response.json({ type: "error", error: { type: "invalid_request_error", message: "invalid params, context window exceeds limit (2013)" } }, { status: 400 });
    if (wire.gatewayBody) return Response.json(wire.gatewayBody);
    const body = JSON.parse(init.body);
    if (body.stream) return new Response(streamBody(), { headers: { "content-type": "text/event-stream" } });
    return Response.json(message("hello"));
  }
  throw new Error(`unexpected mocked URL ${target}`);
};

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-code-test-"));
  vi.stubEnv("MINIMAX_CODE_GATEWAY_RETRIES", "0"); // the retry has its own test file (minimax-code-budget.test.js)
  vi.stubEnv("DATA_DIR", path.join(root, "data")); vi.stubEnv("HOME", path.join(root, "home")); vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true }); delete global._dbAdapter; vi.resetModules();
  challengeOf = new Map();
  Object.assign(wire, { calls: [], live: new Set([TOKEN_A, TOKEN_B]), refreshable: new Map([[REFRESH_A, "alpha"], [REFRESH_B, "beta"]]), devicePolls: 0, deviceOutcome: "success", gatewayStatus: null, gatewayBody: null, accountDown: false, nextRefreshId: 0 });
  vi.stubGlobal("fetch", vi.fn(syntheticUpstream));
  routes = { models: await import("../../src/app/api/v1/models/route.js"), messages: await import("../../src/app/api/v1/messages/route.js") };
  ({ MinimaxCodeExecutor } = await import("../../open-sse/executors/minimax-code.js"));
  ({ default: provider } = await import("../../open-sse/providers/registry/minimax-code.js"));
  auth = await import("../../open-sse/services/minimaxCodeAuth.js");
  ({ minimaxCodeOAuthProvider: oauthProvider } = await import("../../src/lib/oauth/services/minimax-code.js"));
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  repo = await import("../../src/lib/db/repos/connectionsRepo.js");
}, 60000);

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.(); delete global._dbAdapter;
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true });
});

const farFuture = () => new Date(Date.now() + 3600 * 1000).toISOString();
const connect = (name, accessToken, refreshToken, { optIn = true, expiresAt = farFuture(), data = {} } = {}) => repo.createProviderConnection({
  provider: "minimax-code", authType: "oauth", name, accessToken, refreshToken, expiresAt, isActive: true,
  providerSpecificData: { authKind: "oauth", region: "en", ...(optIn ? { enableSessionDispatch: true } : {}), ...data },
});
const openai = (model = "mmcode/MiniMax-M3", extra = {}) => handleChat(request("/v1/chat/completions", { model, messages: [{ role: "user", content: "ping" }], ...extra }));
const anthropic = (extra = {}) => routes.messages.POST(request("/v1/messages", { model: "mmcode/MiniMax-M3", max_tokens: 64, messages: [{ role: "user", content: "ping" }], ...extra }));
const direct = (credentials, extra = {}, model = "MiniMax-M3") => new MinimaxCodeExecutor().execute({ model, body: { model, messages: [{ role: "user", content: "ping" }], max_tokens: 32, ...extra }, stream: Boolean(extra.stream), credentials });
const optedIn = (accessToken, data = {}) => ({ accessToken, providerSpecificData: { enableSessionDispatch: true, region: "en", ...data } });
const gatewayCalls = () => wire.calls.filter((call) => call.url === GATEWAY_URL);
const accountCalls = () => wire.calls.filter((call) => call.url.includes("/oauth2/"));

describe("MiniMax Code staged provider module", () => {
  it("is a distinct OAuth identity from the MiniMax API-key and Token Plan providers", async () => {
    expect(provider).toMatchObject({ id: "minimax-code", alias: "mmcode", category: "oauth", authType: "oauth", hasOAuth: true });
    expect(provider.transport).toMatchObject({ baseUrl: GATEWAY_URL, format: "claude", executor: "minimax-code", auth: { header: "Authorization", scheme: "bearer" } });
    expect(provider.models.map((model) => model.id)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);

    // The production registry holds exactly one entry for the identity and its alias.
    const real = (await vi.importActual("../../open-sse/providers/registry/index.js")).default;
    expect(real.filter((entry) => entry.id === "minimax-code" || entry.alias === "mmcode")).toHaveLength(1);
    expect(real.find((entry) => entry.id === "minimax-code")).toMatchObject({ alias: "mmcode", category: "oauth" });
    const minimax = real.find((entry) => entry.id === "minimax");
    const minimaxCn = real.find((entry) => entry.id === "minimax-cn");
    expect([minimax.category, minimaxCn.category]).toEqual(["apikey", "apikey"]);
    expect(minimax.transport.auth.header).toBe("x-api-key");
    expect(provider.transport.baseUrl).not.toBe(minimax.transport.baseUrl);
  });

  it("exports an empty cookie profile and the connection opt-in contract", async () => {
    const { minimaxCodeCookieProfile, minimaxCodeConnectionOptIn } = await import("../../open-sse/providers/registry/minimax-code.js");
    expect(minimaxCodeCookieProfile).toMatchObject({ notApplicable: true, domains: [], cookieNames: [], validationProbe: null });
    expect(minimaxCodeConnectionOptIn).toEqual({ providerSpecificData: "enableSessionDispatch" });
  });

  it("is composed into the registry and lists its catalog for an active connection under the mmcode alias", async () => {
    const { PROVIDERS, PROVIDER_MODELS } = await import("../../open-sse/providers/index.js");
    expect(PROVIDERS["minimax-code"]).toMatchObject({ baseUrl: GATEWAY_URL, format: "claude" });
    expect(PROVIDER_MODELS.mmcode.map((model) => model.id)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    await connect("mmc-a", TOKEN_A, REFRESH_A);
    const catalog = await (await routes.models.GET(request("/v1/models", null, "GET"))).json();
    expect(catalog.data.map((entry) => entry.id)).toEqual(expect.arrayContaining(["mmcode/MiniMax-M3.1-Flash", "mmcode/MiniMax-M3"]));
  });

  it("accepts only catalog models and both namespaces, and rejects option-looking ids", async () => {
    const { resolveMinimaxCodeModel } = await import("../../open-sse/executors/minimax-code.js");
    expect(resolveMinimaxCodeModel("mmcode/MiniMax-M3")).toEqual({ ok: true, model: "MiniMax-M3" });
    expect(resolveMinimaxCodeModel("minimax-code/MiniMax-M3.1-Flash")).toEqual({ ok: true, model: "MiniMax-M3.1-Flash" });
    expect(resolveMinimaxCodeModel("")).toEqual({ ok: true, model: "MiniMax-M3.1-Flash" });
    expect(resolveMinimaxCodeModel("MiniMax-M9")).toMatchObject({ ok: false, error: expect.stringContaining("Supported models") });
    expect(resolveMinimaxCodeModel("-x")).toMatchObject({ ok: false });
    const rejected = await direct(optedIn(TOKEN_A), {}, "MiniMax-M9");
    expect(rejected.response.status).toBe(400);
    expect(gatewayCalls()).toHaveLength(0);
  });
});

describe("MiniMax Code device sign-in", () => {
  it("requests a device code with the S256 challenge, the published client binding and no redirect following", async () => {
    const challenge = sha256Url("verifier-1");
    const result = await oauthProvider.requestDeviceCode(oauthProvider.config, challenge, {});
    expect(result).toMatchObject({ user_code: USER_CODE, verification_uri_complete: expect.stringContaining("code=ABCD-1234"), expires_in: 600, interval: 5, region: "en" });
    const [call] = accountCalls();
    expect(call.url).toBe(`${EN}/oauth2/device/code`);
    expect(call.redirect).toBe("manual");
    expect(call.headers).toMatchObject({ "content-type": "application/x-www-form-urlencoded", "user-agent": "minimax-code-cli" });
    expect(call.form).toEqual({ client_id: "mcode-public", scope: "agent.default", audience: "agent-backend", code_challenge: challenge, code_challenge_method: "S256" });
  });

  it("walks pending -> success, binding the grant to the PKCE verifier", async () => {
    const verifier = auth.MINIMAX_CODE_CLIENT_ID && crypto.randomBytes(32).toString("base64url");
    const { device_code: deviceCode } = await oauthProvider.requestDeviceCode(oauthProvider.config, sha256Url(verifier), {});

    wire.deviceOutcome = "pending";
    await expect(oauthProvider.pollToken(oauthProvider.config, deviceCode, verifier)).resolves.toEqual({ ok: false, data: { error: "authorization_pending", error_description: "" } });

    // A different verifier cannot redeem the code, even once the user has approved it.
    wire.deviceOutcome = "success";
    const wrong = await oauthProvider.pollToken(oauthProvider.config, deviceCode, "some-other-verifier");
    expect(wrong).toMatchObject({ ok: false, data: { error: "invalid_grant" } });

    const done = await oauthProvider.pollToken(oauthProvider.config, deviceCode, verifier);
    expect(done).toMatchObject({ ok: true, data: { access_token: TOKEN_A, refresh_token: REFRESH_A } });
    const poll = accountCalls().at(-1);
    expect(poll.form).toMatchObject({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: DEVICE_CODE_RAW, client_id: "mcode-public", code_verifier: verifier });

    const mapped = oauthProvider.mapTokens(done.data);
    expect(mapped).toMatchObject({ accessToken: TOKEN_A, refreshToken: REFRESH_A, expiresIn: 7200, providerSpecificData: { authKind: "oauth", region: "en", clientId: "mcode-public" } });
    // Signing in never turns dispatch on: that stays an explicit operator decision.
    expect(mapped.providerSpecificData).not.toHaveProperty("enableSessionDispatch");
  });

  it("ends on denial and expiry, and reports an unreachable account endpoint", async () => {
    const { device_code: deviceCode } = await oauthProvider.requestDeviceCode(oauthProvider.config, sha256Url("v"), {});
    wire.deviceOutcome = "denied";
    await expect(oauthProvider.pollToken(oauthProvider.config, deviceCode, "v")).resolves.toMatchObject({ ok: false, data: { error: "access_denied" } });
    wire.deviceOutcome = "expired";
    await expect(oauthProvider.pollToken(oauthProvider.config, deviceCode, "v")).resolves.toMatchObject({ ok: false, data: { error: "expired_token" } });
    wire.accountDown = true;
    await expect(oauthProvider.pollToken(oauthProvider.config, deviceCode, "v")).resolves.toMatchObject({ ok: false, data: { error: "network_error" } });
    await expect(oauthProvider.requestDeviceCode(oauthProvider.config, sha256Url("v"), {})).rejects.toMatchObject({ status: 502, code: "account_unreachable" });
  });

  it("uses the cn account host for the cn region and polls the host that issued the code", async () => {
    const issued = await oauthProvider.requestDeviceCode(oauthProvider.config, sha256Url("v"), { region: "CN" });
    expect(issued.region).toBe("cn");
    expect(accountCalls()[0].url).toBe(`${CN}/oauth2/device/code`);
    const done = await oauthProvider.pollToken(oauthProvider.config, issued.device_code, "v");
    expect(accountCalls().at(-1).url).toBe(`${CN}/oauth2/token`);
    expect(oauthProvider.mapTokens(done.data).providerSpecificData.region).toBe("cn");
    // An unknown region falls back to the global host rather than a caller-chosen one.
    await oauthProvider.requestDeviceCode(oauthProvider.config, sha256Url("v"), { region: "https://evil.example" });
    expect(accountCalls().at(-1).url).toBe(`${EN}/oauth2/device/code`);
  });

  it("requires a PKCE challenge before any network call", async () => {
    await expect(oauthProvider.requestDeviceCode(oauthProvider.config, "", {})).rejects.toMatchObject({ status: 400 });
    expect(wire.calls).toHaveLength(0);
  });
});

describe("MiniMax Code token refresh", () => {
  it("exchanges the connection's own refresh token and returns the rotated pair", async () => {
    const result = await new MinimaxCodeExecutor().refreshCredentials({ refreshToken: REFRESH_A, providerSpecificData: { region: "en", enableSessionDispatch: true } });
    expect(result).toMatchObject({ accessToken: "mmc_rotated_access_alpha_1", refreshToken: "mmc_rotated_refresh_alpha_1", expiresIn: 3600, providerSpecificData: { region: "en", enableSessionDispatch: true } });
    const [call] = accountCalls();
    expect(call.url).toBe(`${EN}/oauth2/token`);
    expect(call.form).toEqual({ grant_type: "refresh_token", refresh_token: REFRESH_A, client_id: "mcode-public", scope: "agent.default", audience: "agent-backend" });
    expect(call.headers["user-agent"]).toBe("minimax-code-cli");
  });

  it("returns null for a revoked token, a missing token and an unreachable account service", async () => {
    const executor = new MinimaxCodeExecutor();
    await expect(executor.refreshCredentials({ refreshToken: "revoked", providerSpecificData: {} })).resolves.toBeNull();
    await expect(executor.refreshCredentials({ providerSpecificData: {} })).resolves.toBeNull();
    wire.accountDown = true;
    await expect(executor.refreshCredentials({ refreshToken: REFRESH_A, providerSpecificData: {} })).resolves.toBeNull();
  });

  it("refreshes an expired connection before dispatch and persists the rotation on that connection", async () => {
    const stale = await connect("mmc-stale", "mmc_expired_access", REFRESH_A, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const other = await connect("mmc-other", TOKEN_B, REFRESH_B);
    const response = await openai();
    expect(response.status).toBe(200);
    expect(accountCalls().map((call) => call.form.refresh_token)).toEqual([REFRESH_A]);
    expect(gatewayCalls()[0].headers.authorization).toBe("Bearer mmc_rotated_access_alpha_1");

    const saved = await repo.getProviderConnectionById(stale.id);
    expect(saved).toMatchObject({ accessToken: "mmc_rotated_access_alpha_1", refreshToken: "mmc_rotated_refresh_alpha_1" });
    // The sibling's credential is untouched.
    expect(await repo.getProviderConnectionById(other.id)).toMatchObject({ accessToken: TOKEN_B, refreshToken: REFRESH_B });
  });
});

describe("MiniMax Code dispatch guard", () => {
  it("answers a clear 403 and sends nothing upstream when the connection has not opted in", async () => {
    for (const providerSpecificData of [{}, { enableSessionDispatch: "true" }, { enableSessionDispatch: 1 }, { enableSessionDispatch: false }]) {
      const result = await direct({ accessToken: TOKEN_A, providerSpecificData });
      expect(result.response.status).toBe(403);
      const body = await result.response.json();
      expect(body.error).toMatchObject({ type: "provider_error", code: "minimax_code_dispatch_disabled" });
      expect(body.error.message).toContain("providerSpecificData.enableSessionDispatch");
    }
    expect(wire.calls).toHaveLength(0);
  });

  it("refuses on the OpenAI and Anthropic routes without calling the gateway or the account service", async () => {
    await connect("mmc-off", TOKEN_A, REFRESH_A, { optIn: false });
    const openaiResult = await openai();
    expect(openaiResult.status).toBe(403);
    const text = JSON.stringify(await openaiResult.json());
    expect(text).toContain("enableSessionDispatch");
    expect(text).not.toContain(TOKEN_A);
    expect((await anthropic()).status).toBe(403);
    expect(wire.calls).toHaveLength(0);
  });

  it("opts in per connection: enabling one account does not open a sibling", async () => {
    const result = await direct(optedIn(TOKEN_A));
    expect(result.response.status).toBe(200);
    const sibling = await direct({ accessToken: TOKEN_B, providerSpecificData: { region: "en" } });
    expect(sibling.response.status).toBe(403);
    expect(gatewayCalls()).toHaveLength(1);
  });

  it("needs a signed-in access token and a trusted gateway host", async () => {
    expect((await direct({ providerSpecificData: { enableSessionDispatch: true } })).response.status).toBe(401);
    for (const gatewayUrl of ["http://agent.minimax.io/v1/messages", "https://evil.example/mavis", "https://user:pw@agent.minimax.io/x", "https://agent.minimax.io.evil.example/x"]) {
      const result = await direct(optedIn(TOKEN_A, { gatewayUrl }));
      expect(result.response.status).toBe(400);
    }
    const cn = await direct(optedIn(TOKEN_A, { region: "cn" }));
    expect(cn.response.status).toBe(400);
    expect((await cn.response.json()).error.message).toContain("cn region");
    expect(gatewayCalls()).toHaveLength(0);
  });

  it("never sends a stored API key to the account gateway", async () => {
    const result = await direct({ ...optedIn(TOKEN_A), apiKey: "synthetic-minimax-api-key" });
    expect(result.response.status).toBe(200);
    const [call] = gatewayCalls();
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(call.headers["x-api-key"]).toBeUndefined();
    expect(JSON.stringify(call)).not.toContain("synthetic-minimax-api-key");
  });
});

describe("MiniMax Code chat through the gateway routes", () => {
  it("answers JSON chat on the OpenAI route with the Anthropic-shaped gateway call", async () => {
    await connect("mmc-a", TOKEN_A, REFRESH_A);
    const response = await openai();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.choices[0].message.content).toBe("hello");
    expect(payload.usage).toMatchObject({ completion_tokens: 2 });
    expect(payload.choices[0].finish_reason).toBe("stop");

    const [call] = gatewayCalls();
    expect(call.headers).toMatchObject({ authorization: `Bearer ${TOKEN_A}`, "anthropic-version": "2023-06-01", "user-agent": "MiniMaxAgent", "content-type": "application/json" });
    expect(call.body).toMatchObject({ model: "MiniMax-M3", stream: false });
    expect(call.body.messages).toEqual([{ role: "user", content: expect.anything() }]);
    expect(accountCalls()).toHaveLength(0);
  });

  it("streams OpenAI chunks on the OpenAI route", async () => {
    await connect("mmc-a", TOKEN_A, REFRESH_A);
    const response = await openai("mmcode/MiniMax-M3", { stream: true });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"content":"hel"');
    expect(text).toContain('"content":"lo"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(gatewayCalls()[0].headers.accept).toBe("text/event-stream");
    expect(gatewayCalls()[0].body.stream).toBe(true);
  });

  it("serves JSON and streamed chat on the Anthropic Messages route", async () => {
    await connect("mmc-a", TOKEN_A, REFRESH_A);
    const json = await anthropic();
    expect(json.status).toBe(200);
    const body = await json.json();
    expect(body).toMatchObject({ type: "message", role: "assistant" });
    expect(JSON.stringify(body.content)).toContain("hello");

    const streamed = await anthropic({ stream: true });
    expect(streamed.status).toBe(200);
    const text = await streamed.text();
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("hel");
    expect(text).toContain("message_stop");
    for (const call of gatewayCalls()) expect(call.headers.authorization).toBe(`Bearer ${TOKEN_A}`);
  });
});

describe("MiniMax Code credential and quota error mapping", () => {
  it("maps a revoked sign-in to 401 on every route once the refresh also fails", async () => {
    wire.live.delete(TOKEN_A);
    wire.refreshable.delete(REFRESH_A);
    await connect("mmc-revoked", TOKEN_A, REFRESH_A);
    const openaiResult = await openai();
    expect(openaiResult.status).toBe(401);
    const text = JSON.stringify(await openaiResult.json());
    expect(text).not.toContain(TOKEN_A);
    expect(text).not.toContain(REFRESH_A);
    expect((await anthropic()).status).toBe(401);
    // The failed refresh was attempted and sent only this connection's token.
    expect(accountCalls().every((call) => call.form.refresh_token === REFRESH_A)).toBe(true);
  });

  it("recovers from a gateway 401 by refreshing once and retrying with the rotated token", async () => {
    wire.live.delete(TOKEN_A); // access token revoked server-side, refresh token still good
    await connect("mmc-a", TOKEN_A, REFRESH_A);
    const response = await openai();
    expect(response.status).toBe(200);
    expect(accountCalls()).toHaveLength(1);
    expect(gatewayCalls().map((call) => call.headers.authorization)).toEqual([`Bearer ${TOKEN_A}`, "Bearer mmc_rotated_access_alpha_1"]);
  });

  it("explains a rejected token without echoing it", async () => {
    wire.live.delete(TOKEN_A);
    const result = await direct(optedIn(TOKEN_A));
    expect(result.response.status).toBe(401);
    const body = await result.response.json();
    expect(body.error).toMatchObject({ type: "authentication_error", code: "invalid_credentials" });
    expect(body.error.message).toContain("sign in again");
    expect(JSON.stringify(body)).not.toContain(TOKEN_A);
  });

  it("maps quota responses to 429 with the retry hint", async () => {
    wire.gatewayStatus = 429;
    const throttled = await direct(optedIn(TOKEN_A));
    expect(throttled.response.status).toBe(429);
    expect(throttled.response.headers.get("retry-after")).toBe("17");
    const body = await throttled.response.json();
    expect(body.error).toMatchObject({ type: "rate_limit_error", code: "quota_exceeded" });
    // Upstream text is never echoed: the refusal carries a fixed public message.
    expect(body.error.message).not.toContain("plan quota reached");

    await connect("mmc-a", TOKEN_A, REFRESH_A);
    expect((await openai()).status).toBe(429);
    expect((await anthropic()).status).toBe(429);
  });

  it("turns a context-window refusal into 413 so it is not read as a model outage", async () => {
    wire.gatewayStatus = 400;
    const result = await direct(optedIn(TOKEN_A));
    expect(result.response.status).toBe(413);
    expect((await result.response.json()).error.code).toBe("context_length_exceeded");
  });

  it("treats a 200 error envelope as a failure and passes ordinary JSON through", async () => {
    wire.gatewayBody = { type: "error", error: { type: "rate_limit_error", message: "daily plan quota exhausted" } };
    const failed = await direct(optedIn(TOKEN_A));
    expect(failed.response.status).toBe(429);
    wire.gatewayBody = { type: "error", error: { type: "overloaded_error", message: "busy" } };
    // No pinned source guarantees that an overloaded gateway did no work.
    const overloaded = await direct(optedIn(TOKEN_A));
    expect(overloaded.response.status).toBe(500);
    const unknown = (await overloaded.response.json()).error;
    expect(unknown.code).toBe("upstream_outcome_unknown");
    expect(unknown.message.length).toBeGreaterThan(0);
    expect(unknown.message.length).toBeLessThan(400);
    wire.gatewayBody = { type: "error", error: { type: "api_error", message: "internal" } };
    expect((await direct(optedIn(TOKEN_A))).response.status).toBe(500);
    wire.gatewayBody = message("fine");
    const ok = await direct(optedIn(TOKEN_A));
    expect(ok.response.status).toBe(200);
    expect((await ok.response.json()).content[0].text).toBe("fine");
  });
});

describe("MiniMax Code connection isolation", () => {
  it("keeps two connections on their own tokens: each request sends only its own bearer", async () => {
    await connect("mmc-a", TOKEN_A, REFRESH_A);
    await connect("mmc-b", TOKEN_B, REFRESH_B);
    for (let index = 0; index < 4; index += 1) expect((await openai()).status).toBe(200);
    const bearers = gatewayCalls().map((call) => call.headers.authorization);
    expect(bearers).toHaveLength(4);
    for (const bearer of bearers) expect([`Bearer ${TOKEN_A}`, `Bearer ${TOKEN_B}`]).toContain(bearer);
    for (const call of gatewayCalls()) {
      const own = call.headers.authorization === `Bearer ${TOKEN_A}` ? TOKEN_B : TOKEN_A;
      expect(JSON.stringify(call)).not.toContain(own);
    }
  });

  it("refreshes two expired connections independently, each with its own refresh token and region", async () => {
    const executor = new MinimaxCodeExecutor();
    const a = await executor.refreshCredentials({ refreshToken: REFRESH_A, providerSpecificData: { region: "en", marker: "a" } });
    const b = await executor.refreshCredentials({ refreshToken: REFRESH_B, providerSpecificData: { region: "cn", marker: "b" } });
    expect(a).toMatchObject({ accessToken: "mmc_rotated_access_alpha_1", providerSpecificData: { marker: "a", region: "en" } });
    expect(b).toMatchObject({ accessToken: "mmc_rotated_access_beta_2", providerSpecificData: { marker: "b", region: "cn" } });
    expect(accountCalls().map((call) => [call.url, call.form.refresh_token])).toEqual([[`${EN}/oauth2/token`, REFRESH_A], [`${CN}/oauth2/token`, REFRESH_B]]);
    // One account's rotated token is not valid for the other's refresh.
    await expect(executor.refreshCredentials({ refreshToken: "mmc_rotated_refresh_alpha_1", providerSpecificData: {} })).resolves.toMatchObject({ accessToken: "mmc_rotated_access_alpha_3" });
  });

  it("does not let one revoked connection poison the live one", async () => {
    wire.live.delete(TOKEN_A);
    expect((await direct(optedIn(TOKEN_A))).response.status).toBe(401);
    expect((await direct(optedIn(TOKEN_B))).response.status).toBe(200);
  });
});
