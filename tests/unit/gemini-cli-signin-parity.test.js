import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Configure the existing confidential client before provider modules initialize.
const previousClient = vi.hoisted(() => {
  const previous = { id: process.env.GEMINI_OAUTH_CLIENT_ID, secret: process.env.GEMINI_OAUTH_CLIENT_SECRET };
  process.env.GEMINI_OAUTH_CLIENT_ID = "synthetic-gemini-client";
  process.env.GEMINI_OAUTH_CLIENT_SECRET = "synthetic-gemini-secret";
  return previous;
});
afterAll(() => {
  if (previousClient.id === undefined) delete process.env.GEMINI_OAUTH_CLIENT_ID;
  else process.env.GEMINI_OAUTH_CLIENT_ID = previousClient.id;
  if (previousClient.secret === undefined) delete process.env.GEMINI_OAUTH_CLIENT_SECRET;
  else process.env.GEMINI_OAUTH_CLIENT_SECRET = previousClient.secret;
});

import { exchangeTokens, generateAuthData } from "../../src/lib/oauth/providers.js";

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...await importOriginal(),
  proxyAwareFetch: (url, options) => globalThis.fetch(url, options),
}));

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async (url) => { throw new Error(`Unexpected outbound request: ${url}`); })));

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("Gemini CLI dashboard sign-in", () => {
  it("does not save an invalid project object that would suppress later discovery", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      calls.push([String(url), options]);
      if (String(url).includes("oauth2.googleapis.com/token")) {
        expect(options.body.get("grant_type")).toBe("authorization_code");
        expect(options.body.get("code")).toBe("fake-code");
        expect(options.body.get("redirect_uri")).toBe("http://localhost:12345/callback");
        return reply({ access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 3600 });
      }
      if (String(url).includes("userinfo")) return reply({ email: "fake@example.test" });
      if (String(url).endsWith(":loadCodeAssist")) return reply({ cloudaicompanionProject: {} });
      throw new Error(`Unexpected outbound request: ${url}`);
    }));
    const redirect = "http://localhost:12345/callback";
    const auth = await generateAuthData("gemini-cli", redirect);
    expect(new URL(auth.authUrl).searchParams.get("state")).toBe(auth.state);
    const result = await exchangeTokens("gemini-cli", "fake-code", redirect, auth.codeVerifier, auth.state);
    expect(result.projectId).toBe("");
    expect(result.email).toBe("fake@example.test");
    expect(result.refreshToken).toBe("fake-refresh");
    expect(calls).toHaveLength(3);
  });
});

import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { GeminiCLIExecutor } from "../../open-sse/executors/gemini-cli.js";
import geminiCLI from "../../open-sse/providers/registry/gemini-cli.js";
import gemini from "../../open-sse/providers/registry/gemini.js";
import vertex from "../../open-sse/providers/registry/vertex.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";

it.each([
  ["string", " project-one ", "project-one"],
  ["object", { id: " project-two " }, "project-two"],
  ["invalid ID", { id: 42 }, ""],
])("normalizes the %s project response", async (_name, project, expected) => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).includes("userinfo")) return reply({ email: "fake@example.test" });
    if (String(url).endsWith(":loadCodeAssist")) return reply({ cloudaicompanionProject: project });
    throw new Error(`Unexpected outbound request: ${url}`);
  }));
  const result = await (await import("../../src/lib/oauth/providers.js")).getProvider("gemini-cli").postExchange({ access_token: "fake-access" });
  expect(result.projectId).toBe(expected);
});

it("keeps the CLI catalog and transport distinct from Google sibling providers", () => {
  expect(new Set([geminiCLI.id, gemini.id, vertex.id, antigravity.id]).size).toBe(4);
  expect(geminiCLI.transport.baseUrl).toContain("cloudcode-pa.googleapis.com");
  expect(gemini.transport.auth.apiKey.header).toBe("x-goog-api-key");
  expect(vertex.transport.baseUrl).toContain("aiplatform.googleapis.com");
  expect(geminiCLI.models.some((model) => model.id === "gemini-2.5-flash")).toBe(true);
});

it.each([
  [FORMATS.OPENAI, { messages: [{ role: "user", content: "hello" }] }],
  [FORMATS.CLAUDE, { messages: [{ role: "user", content: "hello" }], max_tokens: 128 }],
])("translates a %s request and provider response through the CLI executor", async (source, body) => {
  const model = "gemini-2.5-flash";
  const credentials = { accessToken: "fake-access", projectId: "project-one" };
  const translated = translateRequest(source, FORMATS.GEMINI_CLI, model, body, true, credentials, "gemini-cli");
  const executor = new GeminiCLIExecutor();
  const outbound = vi.fn(async (url, options) => {
    expect(String(url)).toBe("https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse");
    expect(options.headers.Authorization).toBe("Bearer fake-access");
    const sent = JSON.parse(options.body);
    expect(sent.project).toBe("project-one");
    expect(sent.model).toBe(model);
    expect(sent.request.contents[0].parts[0].text).toBe("hello");
    return reply({ response: { candidates: [{ content: { role: "model", parts: [{ text: "mock answer" }] } }] } });
  });
  vi.stubGlobal("fetch", outbound);
  const result = await executor.execute({ model, body: translated, stream: true, credentials });
  const providerResponse = await result.response.json();
  const chunks = translateResponse(FORMATS.GEMINI_CLI, source, providerResponse, initState(source));
  expect(JSON.stringify(chunks)).toContain("mock answer");
  expect(outbound).toHaveBeenCalledOnce();
});

it("refreshes the CLI token with its own fake refresh credential", async () => {
  const { getAccessToken } = await import("../../open-sse/services/tokenRefresh.js");
  const mock = vi.fn(async (url, options) => {
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    expect(options.body.get("grant_type")).toBe("refresh_token");
    expect(options.body.get("refresh_token")).toBe("fake-refresh-cli");
    return reply({ access_token: "fake-refreshed", expires_in: 3600 });
  });
  vi.stubGlobal("fetch", mock);
  const token = await getAccessToken("gemini-cli", { refreshToken: "fake-refresh-cli" });
  expect(token).toMatchObject({ accessToken: "fake-refreshed", refreshToken: "fake-refresh-cli" });
  expect(mock).toHaveBeenCalledOnce();
});

it("discovers and caches projects per connection, including onboarding", async () => {
  const { getProjectIdForConnection, removeConnection } = await import("../../open-sse/services/projectId.js");
  const mock = vi.fn(async (url, options) => {
    const token = options.headers.Authorization;
    if (String(url).endsWith(":loadCodeAssist")) {
      if (token === "Bearer fake-first") return reply({ allowedTiers: [{ id: "free", isDefault: true }] });
      if (token === "Bearer fake-second") return reply({ cloudaicompanionProject: { id: "second-project" } });
    }
    if (String(url).endsWith(":onboardUser") && token === "Bearer fake-first") {
      expect(JSON.parse(options.body).tierId).toBe("free");
      return reply({ done: true, response: { cloudaicompanionProject: { id: "first-project" } } });
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  try {
    expect(await getProjectIdForConnection("fake-connection-1", "fake-first", null, null, "gemini-cli")).toBe("first-project");
    expect(await getProjectIdForConnection("fake-connection-2", "fake-second", null, null, "gemini-cli")).toBe("second-project");
    expect(await getProjectIdForConnection("fake-connection-1", "fake-first", null, null, "gemini-cli")).toBe("first-project");
    expect(mock).toHaveBeenCalledTimes(3);
  } finally {
    removeConnection("fake-connection-1");
    removeConnection("fake-connection-2");
  }
});

it("discovers the selected CLI account's catalog without leaking internal models", async () => {
  const { PROVIDER_MODELS_CONFIG } = await import("../../src/app/api/providers/[id]/models/modelsConfig.js");
  const mock = vi.fn(async (url, options) => {
    expect(String(url)).toBe("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels");
    expect(options.headers.Authorization).toBe("Bearer fake-catalog-token");
    expect(JSON.parse(options.body)).toEqual({ project: "catalog-project" });
    return reply({ models: { "gemini-2.5-flash": { displayName: "Flash" }, hidden: { isInternal: true } } });
  });
  vi.stubGlobal("fetch", mock);
  const result = await PROVIDER_MODELS_CONFIG["gemini-cli"].customResolver({ id: "fake-catalog", accessToken: "fake-catalog-token", projectId: "catalog-project" });
  expect(result.models).toEqual([{ id: "gemini-2.5-flash", name: "Flash" }]);
  expect(mock).toHaveBeenCalledOnce();
});
