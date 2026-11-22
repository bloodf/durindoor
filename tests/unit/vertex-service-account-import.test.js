import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { importSPKI, jwtVerify } from "jose";
import "../translator/registerAll.js";
import { VertexExecutor } from "../../open-sse/executors/vertex.js";

const wire = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: wire,
}));

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const VERTEX_HOST = "https://aiplatform.googleapis.com";
const GEMINI = "gemini-2.5-flash";

/** Minimal service-account JSON with a freshly generated test RSA key. */
function newServiceAccount(label) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    json: {
      type: "service_account",
      project_id: `vertex-${label}-project`,
      client_email: `vertex-${label}@example.test`,
      private_key_id: `vertex-${label}-key`,
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    },
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

/** ADC credential file produced by `gcloud auth application-default login`. */
function newAdcCredential(label) {
  return {
    type: "authorized_user",
    client_id: `client-${label}.apps.googleusercontent.com`,
    client_secret: `secret-${label}`,
    refresh_token: `refresh-${label}`,
    quota_project_id: `adc-${label}-project`,
  };
}

function bodyOf(init) {
  return new URLSearchParams(String(init?.body || ""));
}

function headerOf(init, name) {
  return new Headers(init?.headers || {}).get(name);
}

/**
 * Closed transport for the Vertex service-account surface. Only the Google
 * token endpoint and the Vertex AI endpoint are reachable; anything else is a
 * fixture error.
 */
function closedTransport(handlers = {}) {
  const calls = [];
  let issued = 0;
  wire.mockImplementation(async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, init, headers: new Headers(init?.headers || {}) });
    if (target === TOKEN_URL) {
      const form = bodyOf(init);
      if (form.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer") {
        const token = handlers.accessToken?.() || `ya29.synthetic-${++issued}`;
        return Response.json({ access_token: token, expires_in: 3600, token_type: "Bearer" });
      }
      if (form.get("grant_type") === "refresh_token") {
        const token = handlers.accessToken?.() || `ya29.adc-${form.get("refresh_token")}`;
        return Response.json({ access_token: token, expires_in: 3600, token_type: "Bearer" });
      }
      throw new Error(`Unexpected grant_type: ${form.get("grant_type")}`);
    }
    if (target.startsWith(`${VERTEX_HOST}/v1/`)) {
      return handlers.upstream?.({ url: target, init }) ??
        Response.json({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    }
    throw new Error(`Unexpected fixture URL: ${target}`);
  });
  return calls;
}

async function dispatch(credentials, { model = GEMINI, stream = false, log = null } = {}) {
  const executor = new VertexExecutor("vertex");
  return executor.execute({
    model,
    body: { contents: [{ role: "user", parts: [{ text: "hello" }] }] },
    stream,
    credentials,
    log,
    proxyOptions: { disableEnvProxy: true },
  });
}

afterEach(() => {
  wire.mockReset();
});

describe("Vertex service-account import", () => {
  it("mints a signed project-scoped token and dispatches the imported project", async () => {
    const account = newServiceAccount("mint");
    const calls = closedTransport();

    const result = await dispatch({
      apiKey: JSON.stringify(account.json),
      providerSpecificData: { location: "us-central1" },
    });

    expect(calls.map((call) => call.url)).toEqual([
      TOKEN_URL,
      `${VERTEX_HOST}/v1/projects/${account.json.project_id}/locations/us-central1/publishers/google/models/${GEMINI}:generateContent`,
    ]);

    // The token request carries a real RS256 assertion signed by the imported key.
    const assertion = bodyOf(calls[0].init).get("assertion");
    expect(assertion).toBeTruthy();
    const verified = await jwtVerify(assertion, await importSPKI(account.publicKeyPem, "RS256"), {
      issuer: account.json.client_email,
      audience: TOKEN_URL,
    });
    expect(verified.payload.scope).toContain("https://www.googleapis.com/auth/cloud-platform");
    expect(verified.payload.iss).toBe(account.json.client_email);

    // The model request is bound to the imported project and the minted bearer.
    expect(headerOf(calls[1].init, "authorization")).toBe("Bearer ya29.synthetic-1");
    expect(calls[1].init.method).toBe("POST");
    expect(JSON.parse(calls[1].init.body).contents).toEqual([
      { role: "user", parts: [{ text: "hello" }] },
    ]);
    expect(result.url).toBe(calls[1].url);
  });

  it("dispatches a project-scoped stream with the SSE accept header", async () => {
    const account = newServiceAccount("stream");
    const calls = closedTransport();

    await dispatch({
      apiKey: JSON.stringify(account.json),
      providerSpecificData: { location: "us-central1" },
    }, { stream: true });

    expect(calls[1].url).toBe(
      `${VERTEX_HOST}/v1/projects/${account.json.project_id}/locations/us-central1/publishers/google/models/${GEMINI}:streamGenerateContent?alt=sse`,
    );
    expect(headerOf(calls[1].init, "accept")).toBe("text/event-stream");
  });

  it("keeps the minted token cache isolated per service account", async () => {
    const first = newServiceAccount("cache-a");
    const second = newServiceAccount("cache-b");
    const calls = closedTransport();

    await dispatch({ apiKey: JSON.stringify(first.json) });
    await dispatch({ apiKey: JSON.stringify(second.json) });
    await dispatch({ apiKey: JSON.stringify(first.json) });

    const mints = calls.filter((call) => call.url === TOKEN_URL);
    expect(mints).toHaveLength(2);
    expect(headerOf(calls[1].init, "authorization")).toBe("Bearer ya29.synthetic-1");
    expect(headerOf(calls[3].init, "authorization")).toBe("Bearer ya29.synthetic-2");
    // The first account keeps its own token instead of the second account's.
    expect(headerOf(calls[4].init, "authorization")).toBe("Bearer ya29.synthetic-1");
    expect(calls[1].url).toContain(first.json.project_id);
    expect(calls[3].url).toContain(second.json.project_id);
    expect(calls[4].url).toContain(first.json.project_id);
  });
});

describe("Vertex ADC and raw API key credentials", () => {
  it("refreshes an imported authorized_user ADC credential on the Google token endpoint", async () => {
    const adc = newAdcCredential("adc");
    const calls = closedTransport();

    await dispatch({ apiKey: JSON.stringify(adc) });

    const form = bodyOf(calls[0].init);
    expect(calls[0].url).toBe(TOKEN_URL);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe(adc.refresh_token);
    expect(form.get("client_id")).toBe(adc.client_id);
    expect(form.get("client_secret")).toBe(adc.client_secret);

    expect(calls[1].url).toBe(
      `${VERTEX_HOST}/v1/projects/${adc.quota_project_id}/locations/us-central1/publishers/google/models/${GEMINI}:generateContent`,
    );
    expect(headerOf(calls[1].init, "authorization")).toBe(`Bearer ya29.adc-${adc.refresh_token}`);
  });

  it("keeps a raw API key on the project-less publisher endpoint", async () => {
    const calls = closedTransport();

    await dispatch({ apiKey: "vertex-express-key" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${VERTEX_HOST}/v1/publishers/google/models/${GEMINI}:generateContent?key=vertex-express-key`,
    );
    expect(headerOf(calls[0].init, "authorization")).toBeNull();
  });
});

describe("Vertex credential boundaries", () => {
  it("keeps the vertex-partner service-account route project-scoped on the global endpoint", async () => {
    const account = newServiceAccount("partner-sa");
    const calls = closedTransport();
    const executor = new VertexExecutor("vertex-partner");

    const result = await executor.execute({
      model: "deepseek-ai/deepseek-v3.2-maas",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: false,
      credentials: { apiKey: JSON.stringify(account.json) },
      proxyOptions: { disableEnvProxy: true },
    });

    expect(calls[0].url).toBe(TOKEN_URL);
    expect(calls[1].url).toBe(
      `${VERTEX_HOST}/v1/projects/${account.json.project_id}/locations/global/endpoints/openapi/chat/completions`,
    );
    expect(headerOf(calls[1].init, "authorization")).toMatch(/^Bearer ya29\./);
    expect(result.url).toBe(calls[1].url);
  });

  it("keeps a vertex-partner raw API key on the global openapi endpoint", async () => {
    const calls = closedTransport();
    const executor = new VertexExecutor("vertex-partner");

    await executor.execute({
      model: "deepseek-ai/deepseek-v3.2-maas",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: false,
      credentials: {
        apiKey: "vertex-partner-key",
        providerSpecificData: { projectId: "partner-project" },
      },
      proxyOptions: { disableEnvProxy: true },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${VERTEX_HOST}/v1/projects/partner-project/locations/global/endpoints/openapi/chat/completions?key=vertex-partner-key`,
    );
    expect(headerOf(calls[0].init, "authorization")).toBeNull();
  });

  it("rejects an unusable Google credential JSON instead of sending it as a raw API key", async () => {
    const calls = closedTransport();
    const incompleteServiceAccount = {
      type: "service_account",
      client_email: "boundary@example.test",
      private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
    };

    await expect(dispatch({ apiKey: JSON.stringify(incompleteServiceAccount) })).rejects.toThrow(
      "Vertex: service account JSON is missing project_id",
    );
    await expect(dispatch({
      apiKey: JSON.stringify({ web: { client_id: "oauth.apps.googleusercontent.com", client_secret: "boundary-secret" } }),
    })).rejects.toThrow("Vertex: OAuth client JSON is not a Service Account key.");
    await expect(dispatch({
      apiKey: JSON.stringify({ type: "authorized_user", client_id: "boundary-client" }),
    })).rejects.toThrow("Vertex: ADC authorized_user JSON is missing client_secret, refresh_token");

    // No credential material reaches the wire.
    expect(calls).toHaveLength(0);
  });

  it("does not leak token material when the upstream rejects the request", async () => {
    const account = newServiceAccount("reject");
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const calls = closedTransport({
      upstream: () => new Response("upstream rejected the credential", { status: 401 }),
    });

    const result = await dispatch(
      { apiKey: JSON.stringify(account.json) },
      { log },
    );

    expect(result.response.status).toBe(401);
    const logged = JSON.stringify([
      log.debug.mock.calls,
      log.info.mock.calls,
      log.warn.mock.calls,
      log.error.mock.calls,
    ]);
    expect(logged).not.toContain(account.json.private_key);
    expect(logged).not.toContain("ya29.synthetic");
    expect(logged).not.toContain("BEGIN PRIVATE KEY");
  });
});

describe("Vertex connections through the protected gateway route", () => {
  let directory;
  let db;
  let adapter;
  let chat;
  let createProvider;
  let caller;
  let first;
  let second;

  const geminiReply = {
    candidates: [{
      role: "model",
      content: { role: "model", parts: [{ text: "vertex reply" }] },
      finishReason: "STOP",
    }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
  };

  const providerRequest = (body = {}, headers = {}) => new Request("https://gateway.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ model: `vertex/${GEMINI}`, messages: [{ role: "user", content: "hello" }], ...body }),
  });

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-vertex-import-"));
    vi.stubEnv("DATA_DIR", directory);
    vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
    db = await import("@/lib/localDb");
    adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    await db.updateSettings({ requireApiKey: true });
    ({ POST: createProvider } = await import("../../src/app/api/providers/route.js"));
    ({ POST: chat } = await import("../../src/app/api/v1/chat/completions/route.js"));
  }, 30_000);

  afterAll(async () => {
    await adapter?.close?.();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  it("imports two synthetic service-account connections without returning their key material", async () => {
    const accounts = [newServiceAccount("route-a"), newServiceAccount("route-b")];

    for (const [index, account] of accounts.entries()) {
      const response = await createProvider(new Request("https://gateway.test/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "vertex",
          name: `Vertex route ${index}`,
          apiKey: JSON.stringify(account.json),
          providerSpecificData: { location: "us-central1" },
        }),
      }));
      expect(response.status).toBe(201);
      const text = await response.text();
      expect(text).not.toContain("BEGIN PRIVATE KEY");
      expect(text).not.toContain(account.json.private_key);
    }

    const connections = await db.getProviderConnections();
    const vertexConnections = connections.filter((connection) => connection.provider === "vertex");
    expect(vertexConnections).toHaveLength(2);
    first = vertexConnections.find((connection) => connection.name === "Vertex route 0");
    second = vertexConnections.find((connection) => connection.name === "Vertex route 1");
    expect(first.apiKey).not.toBe(second.apiKey);
  });

  it("dispatches the pinned connection on its own project-scoped route", async () => {
    const calls = closedTransport({ upstream: () => Response.json(geminiReply) });
    const firstAccount = JSON.parse(first.apiKey);
    const secondAccount = JSON.parse(second.apiKey);
    const scoped = await db.createApiKey("Vertex fixture client", "synthetic-machine", [], null, null, {
      providerConnectionIds: [first.id],
    });
    caller = scoped;

    const response = await chat(providerRequest({}, { authorization: `Bearer ${scoped.key}` }));
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.content).toBe("vertex reply");

    const mint = calls.find((call) => call.url === TOKEN_URL);
    const dispatch = calls.find((call) => call.url.startsWith(`${VERTEX_HOST}/v1/`));
    expect(mint).toBeTruthy();
    expect(dispatch.url).toContain(`/projects/${firstAccount.project_id}/locations/us-central1/`);
    expect(headerOf(dispatch.init, "authorization")).toMatch(/^Bearer ya29\./);

    // The pinned account never sees the other imported account's project.
    expect(calls.some((call) => call.url.includes(secondAccount.project_id))).toBe(false);
  });

  it("keeps an upstream authorization failure free of token material", async () => {
    const calls = closedTransport({
      upstream: () => new Response("upstream rejected the credential", { status: 401 }),
    });
    const account = newServiceAccount("route-reject");
    const connection = await db.createProviderConnection({
      provider: "vertex",
      authType: "apikey",
      name: "Vertex rejected",
      apiKey: JSON.stringify(account.json),
      providerSpecificData: { location: "us-central1" },
      isActive: true,
    });
    const scoped = await db.createApiKey("Vertex reject client", "synthetic-machine", [], null, null, {
      providerConnectionIds: [connection.id],
    });

    const response = await chat(providerRequest({}, { authorization: `Bearer ${scoped.key}` }));
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).not.toContain("ya29.");
    expect(text).not.toContain("BEGIN PRIVATE KEY");
    expect(text).not.toContain(account.json.private_key);
    expect(calls.some((call) => call.url === TOKEN_URL)).toBe(true);
  });
});

describe("Vertex isolation", () => {
  it("rejects malformed credentials at both entry points without dispatch", async () => {
    const { POST } = await import("../../src/app/api/providers/validate/route.js");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      for (const apiKey of ['{"type":"authorized_user","client_secret":"fixture-secret"', '{"type":"authorized_user"}', '[{"secret":"fixture-secret"}]']) {
        for (const provider of ["vertex", "vertex-partner"]) {
          await expect(new VertexExecutor(provider).execute({ model: GEMINI, body: {}, credentials: { apiKey } })).rejects.toThrow();
          const response = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey }) }));
          const result = await response.text();
          expect(result).not.toContain("fixture-secret");
          expect(JSON.parse(result).valid).toBe(false);
        }
      }
      expect(wire).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it("isolates rotated keys and routes while reusing a valid token", async () => {
    const first = newServiceAccount("rotate").json;
    const second = { ...first, private_key: newServiceAccount("rotated").json.private_key };
    const calls = closedTransport();
    const executor = new VertexExecutor("vertex");
    const run = (account, proxyOptions) => executor.execute({ model: GEMINI, body: {}, credentials: { apiKey: JSON.stringify(account) }, proxyOptions });
    const direct = { disableEnvProxy: true };
    await run(first, direct); await run(first, direct); await run(second, direct);
    await run(first, { strictProxy: true, enabled: true, url: "http://proxy.test" });
    expect(calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(3);
    expect(calls.filter((call) => call.url !== TOKEN_URL).map((call) => headerOf(call.init, "authorization"))).toEqual(["Bearer ya29.synthetic-1", "Bearer ya29.synthetic-1", "Bearer ya29.synthetic-2", "Bearer ya29.synthetic-3"]);
  });

  it("routes discovery and chat through the selected transport with an encoded key", async () => {
    const route = { enabled: true, strictProxy: true, url: "http://proxy.test" };
    const signal = new AbortController().signal;
    const calls = [];
    wire.mockImplementation(async (url, init, proxy) => {
      calls.push({ url: String(url), init, proxy });
      return calls.length === 1 ? Response.json({ error: { message: "projects/partner-project/locations/global" } }, { status: 404 }) : Response.json({});
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await new VertexExecutor("vertex-partner").execute({ model: "partner-model", body: {}, credentials: { apiKey: "opaque+key&fixture" }, proxyOptions: route, signal });
      expect(calls).toHaveLength(2);
      for (const [index, call] of calls.entries()) {
        expect(call.proxy).toBe(route);
        expect(call.init.signal).toBeInstanceOf(AbortSignal);
        if (index === 0) expect(call.init.signal).toBe(signal);
        else expect(call.init.signal).not.toBe(signal);
        expect(new URL(call.url).searchParams.get("key")).toBe("opaque+key&fixture");
      }
      expect(calls[1].url).toContain("/projects/partner-project/");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it("refreshes a near-expiry token and discovers over a direct route", async () => {
    const account = newServiceAccount("expiry").json;
    let mints = 0;
    wire.mockImplementation(async (url) => {
      if (String(url) === TOKEN_URL) return Response.json({ access_token: `short-${++mints}`, expires_in: 60 });
      if (String(url).includes("__probe__")) return Response.json({ error: { message: "projects/direct-project/locations/global" } });
      return Response.json({});
    });
    const direct = { disableEnvProxy: true };
    const executor = new VertexExecutor("vertex");
    const args = { model: GEMINI, body: {}, credentials: { apiKey: JSON.stringify(account) }, proxyOptions: direct };
    await executor.execute(args);
    await executor.execute(args);
    expect(mints).toBe(2);
    await new VertexExecutor("vertex-partner").execute({ model: "partner", body: {}, credentials: { apiKey: "direct-fixture-key" }, proxyOptions: direct });
    expect(wire.mock.calls.slice(-2).every((call) => call[2] === direct)).toBe(true);
  });

  it("fails closed on discovery errors and invalid project metadata", async () => {
    const executor = new VertexExecutor("vertex-partner");
    const run = (apiKey) => executor.execute({ model: "partner-model", body: {}, credentials: { apiKey }, proxyOptions: { strictProxy: true } });
    wire.mockRejectedValueOnce(new Error("fixture-secret in URL"));
    await expect(run("fixture-secret")).rejects.toThrow("Vertex: project discovery request failed");
    wire.mockResolvedValueOnce(Response.json({ error: { message: "projects/../../evil/" } }));
    await expect(run("other-fixture-key")).rejects.toThrow("could not resolve project_id");
    expect(wire).toHaveBeenCalledTimes(2);
  });
});
