// Gemini Web (https://gemini.google.com) runs on the user's own signed-in Google
// session, supplied as cookies.
//
// Every browser, page, response and HTTP call in this file is a local mock: no
// Google account, cookie, Chromium or network request is involved. The cookies
// are synthetic placeholders and were never issued by Google.
//
// The provider module (open-sse/providers/registry/gemini-web.js) and its executor
// come from the production registry and executor map; only the browser, the
// network and the usage database are mocked.
//
// Port source: OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/gemini/web/index.ts and
// open-sse/executors/gemini-web.ts.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import "../translator/registerAll.js";

const STREAM_URL =
  "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=x";

// A scripted Playwright. `world.answer(cookieHeader)` decides, per context, what
// the page's StreamGenerate request answers; `world.contexts` records every
// context that was opened so isolation can be asserted.
const world = {
  contexts: [],
  launches: 0,
  redirectToSignIn: (_cookie) => false,
  indicatorText: "Gemini 3.7 Flash",
  answer: (_cookie) => ({ status: 200, text: "" }),
};

// Stub the shared launch method before tests run. Vitest's manual module
// mock can fall through to the real module during overlapping dynamic imports.
const launch = vi.spyOn(chromium, "launch").mockImplementation(async () => {
  world.launches += 1;
  return {
    isConnected: () => true,
    close: vi.fn(async () => {}),
    newContext: vi.fn(async (options) => {
      const context = { options, cookies: [], prompts: [], pages: 0, closed: false };
      world.contexts.push(context);
      const header = () => context.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      return {
        addCookies: vi.fn(async (cookies) => { context.cookies.push(...cookies); }),
        cookies: vi.fn(async () => context.cookies),
        close: vi.fn(async () => { context.closed = true; }),
        newPage: vi.fn(async () => {
          context.pages += 1;
          let onResponse = null;
          let url = "about:blank";
          return {
            on: (event, handler) => { if (event === "response") onResponse = handler; },
            url: () => url,
            goto: vi.fn(async (target) => {
              url = world.redirectToSignIn(header()) ? "https://accounts.google.com/v3/signin/identifier" : target;
            }),
            waitForSelector: vi.fn(async () => ({
              click: vi.fn(async () => {}),
              textContent: vi.fn(async () => world.indicatorText),
            })),
            keyboard: {
              insertText: vi.fn(async (text) => { context.prompts.push(text); }),
              press: vi.fn(async (key) => {
                if (key !== "Enter") return;
                const { status, text, body } = world.answer(header());
                // Deliver this context's cookie-keyed response before the mock timeout can fire.
                await onResponse?.({
                  url: () => STREAM_URL,
                  status: () => status,
                  text: async () => body ?? frameBody(text),
                });
              }),
            },
            // The long response wait collapses to a short real delay so a missing answer finishes fast.
            waitForTimeout: (ms) => new Promise((resolve) => setTimeout(resolve, ms >= 1000 ? 60 : 0)),
          };
        }),
      };
    }),
  };
});

vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
vi.mock("../../open-sse/utils/requestLogger.js", async (original) => ({
  ...(await original()),
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import geminiWebProvider, {
  GEMINI_WEB_MODELS,
  geminiWebCookieProfile,
} from "../../open-sse/providers/registry/gemini-web.js";
import {
  GeminiWebExecutor,
  buildGeminiPrompt,
  buildGeminiToolPrompt,
  mergeRotatedGeminiCookies,
  normalizeGeminiCookieInput,
  parseStreamResponse,
  resetGeminiBrowserLeaseForTests,
  validateGeminiWebSession,
} from "../../open-sse/executors/gemini-web.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { buildImportedCookieHeader, getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";

// Synthetic placeholders, not Google credentials.
const COOKIE_A = "__Secure-1PSID=psid-alpha; __Secure-1PSIDTS=ts-alpha";
const COOKIE_B = "__Secure-1PSID=psid-beta; __Secure-1PSIDTS=ts-beta";
const MODEL = "gemini-3.1-pro";

/** A StreamGenerate body: two cumulative snapshots of the answer, so only the last may be kept. */
function frameBody(text) {
  const frame = (answer) => JSON.stringify([["wrb.fr", null, JSON.stringify([null, null, null, null, [["c_1", [answer]]]])]]);
  const half = text.slice(0, Math.ceil(text.length / 2));
  return `)]}'\n\n${10}\n${frame(half)}\n${20}\n${frame(text)}\n`;
}

const sessionPage = (token = true) =>
  `<html><script>window.WIZ_global_data={"cfb2h":"x"${token ? ',"SNlM0e":"AEtoken:123"' : ""}}</script></html>`;

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function chat(endpoint, body, credentials = { apiKey: COOKIE_A, id: "conn-a" }) {
  return handleChatCore({
    body,
    modelInfo: { provider: "gemini-web", model: body.model },
    credentials,
    clientRawRequest: { endpoint, body, headers: {} },
    // The route resolves the client format from the endpoint; the core receives it as an override.
    sourceFormatOverride: endpoint === "/v1/messages" ? FORMATS.CLAUDE : FORMATS.OPENAI,
    connectionId: credentials.id,
    log,
    rtkEnabled: false,
    headroomEnabled: false,
    compressionEnabled: false,
  });
}

const direct = (body, credentials = { apiKey: COOKIE_A }) =>
  new GeminiWebExecutor().execute({ model: body.model, body, stream: false, credentials, log });

const openAiBody = (stream, extra = {}) => ({
  model: MODEL,
  messages: [{ role: "user", content: "hello" }],
  stream,
  ...extra,
});
const anthropicBody = (stream) => ({
  model: MODEL,
  max_tokens: 64,
  messages: [{ role: "user", content: "hello" }],
  stream,
});

beforeEach(() => {
  world.contexts.length = 0;
  world.launches = 0;
  world.redirectToSignIn = () => false;
  world.indicatorText = "Gemini 3.7 Flash";
  world.answer = (cookie) => ({ status: 200, text: `reply for ${cookie.match(/__Secure-1PSID=([^;]+)/)?.[1]}` });
});

afterEach(async () => {
  await resetGeminiBrowserLeaseForTests();
  vi.clearAllMocks();
});

afterAll(() => {
  launch.mockRestore();
});

describe("Gemini Web registration (composed)", () => {
  it("adds a cookie-auth provider with the gemini-web executor and the OpenAI-format transport", () => {
    const entry = REGISTRY.find((candidate) => candidate.id === "gemini-web");
    expect(entry).toBe(geminiWebProvider);
    expect(entry).toMatchObject({ alias: "gweb", category: "webCookie", authType: "cookie", serviceKinds: ["llm"] });
    expect(PROVIDERS["gemini-web"]).toMatchObject({
      baseUrl: "https://gemini.google.com/app",
      format: "openai",
      executor: "gemini-web",
      authType: "cookie",
    });
    expect(getExecutor("gemini-web")).toBeInstanceOf(GeminiWebExecutor);
  });

  it("discovers the curated catalog without a request, reasoning and native tools off", () => {
    const models = getProviderModels("gemini-web");
    expect(models.map((model) => model.id)).toEqual(GEMINI_WEB_MODELS.map((model) => model.id));
    expect(models.map((model) => model.id)).toEqual(["gemini-3.1-pro", "gemini-3.7-flash", "gemini-3.1-flash-lite"]);
    expect(PROVIDER_MODELS.gweb).toHaveLength(3);
    for (const model of GEMINI_WEB_MODELS) {
      expect(model).toMatchObject({ toolCalling: false, supportsReasoning: false });
    }
    expect(geminiWebProvider.models).not.toContain(GEMINI_WEB_MODELS[0]);
  });

  it("publishes a cookie import contract the dashboard and extension can use", () => {
    const contract = getCookieImportContract("gemini-web");
    expect(contract).toMatchObject({ origin: geminiWebCookieProfile.origin, host: "gemini.google.com" });
    expect([...contract.cookieNames]).toEqual([...geminiWebCookieProfile.cookieNames]);

    const imported = buildImportedCookieHeader(contract, [
      { name: "__Secure-1PSID", value: "psid-alpha", domain: ".google.com", secure: true },
      { name: "__Secure-1PSIDTS", value: "ts-alpha", domain: ".google.com", secure: true },
    ]);
    expect(imported.ok).toBe(true);
    expect(imported.header).toContain("__Secure-1PSID=psid-alpha");
    expect(imported.header).toContain("__Secure-1PSIDTS=ts-alpha");

    // The timestamp cookie is required, and unrelated Google cookies are not approved.
    expect(buildImportedCookieHeader(contract, [{ name: "__Secure-1PSID", value: "psid-alpha" }]).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [
      { name: "__Secure-1PSID", value: "psid-alpha" },
      { name: "__Secure-1PSIDTS", value: "ts-alpha" },
      { name: "NID", value: "tracking" },
    ]).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [
      { name: "__Secure-1PSID", value: "psid-alpha", domain: ".evil.example" },
      { name: "__Secure-1PSIDTS", value: "ts-alpha" },
    ]).ok).toBe(false);
  });
});

describe("Gemini Web credential validation", () => {
  const page = (body, status = 200, headers = {}) => vi.fn(async () => new Response(body, { status, headers }));

  it("accepts a session whose page carries the signed-in token and sends only the pasted cookie", async () => {
    const fetcher = page(sessionPage());
    await expect(validateGeminiWebSession({ apiKey: COOKIE_A, fetcher })).resolves.toMatchObject({ valid: true, status: 200 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://gemini.google.com/app");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.headers.Cookie).toBe(COOKIE_A);
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("accepts a bare __Secure-1PSID value and a pasted Cookie header prefix", async () => {
    const bare = page(sessionPage());
    await validateGeminiWebSession({ apiKey: "psid-alpha", fetcher: bare });
    expect(bare.mock.calls[0][1].headers.Cookie).toBe("__Secure-1PSID=psid-alpha");

    const prefixed = page(sessionPage());
    await validateGeminiWebSession({ apiKey: `Cookie: ${COOKIE_A}`, fetcher: prefixed });
    expect(prefixed.mock.calls[0][1].headers.Cookie).toBe(COOKIE_A);
  });

  it("rejects a signed-out landing page that answers 200 for any cookie", async () => {
    const result = await validateGeminiWebSession({ apiKey: COOKIE_A, fetcher: page(sessionPage(false)) });
    expect(result).toMatchObject({ valid: false, status: 200 });
    expect(result.error).toMatch(/not signed in/i);
  });

  it.each([401, 403])("rejects HTTP %i as an expired credential", async (status) => {
    const result = await validateGeminiWebSession({ apiKey: COOKIE_A, fetcher: page("", status) });
    expect(result).toMatchObject({ valid: false, status });
    expect(result.unavailable).toBeUndefined();
  });

  it("treats a ServiceLogin redirect as a dead session and other Google redirects as accepted", async () => {
    const expired = page("", 302, { location: "https://accounts.google.com/ServiceLogin?continue=x" });
    expect(await validateGeminiWebSession({ apiKey: COOKIE_A, fetcher: expired })).toMatchObject({ valid: false, status: 302 });
    const accepted = page("", 302, { location: "https://gemini.google.com/app/u/0" });
    expect(await validateGeminiWebSession({ apiKey: COOKIE_A, fetcher: accepted })).toMatchObject({ valid: true });
    const foreign = page("", 302, { location: "https://example.com/" });
    expect(await validateGeminiWebSession({ apiKey: COOKIE_A, fetcher: foreign })).toMatchObject({ valid: false });
  });

  it("rejects a credential with no __Secure-1PSID before any network call", async () => {
    const fetcher = page(sessionPage());
    expect(await validateGeminiWebSession({ apiKey: "", fetcher })).toMatchObject({ valid: false });
    expect(await validateGeminiWebSession({ apiKey: "NID=tracking", fetcher })).toMatchObject({ valid: false });
    expect(await validateGeminiWebSession({ apiKey: "__Secure-1PSID=", fetcher })).toMatchObject({ valid: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports quota, outage and network failure as unavailable, not as a bad credential", async () => {
    expect(await validateGeminiWebSession({ apiKey: COOKIE_A, fetcher: page("", 429) })).toMatchObject({ valid: false, status: 429, unavailable: true });
    expect(await validateGeminiWebSession({ apiKey: COOKIE_A, fetcher: page("", 503) })).toMatchObject({ valid: false, status: 503, unavailable: true });
    const down = vi.fn(async () => { throw new Error("socket hang up"); });
    expect(await validateGeminiWebSession({ apiKey: COOKIE_A, fetcher: down })).toMatchObject({ valid: false, unavailable: true });
  });

  it("checks format only in testConnection, with no browser launch", async () => {
    const executor = new GeminiWebExecutor();
    expect(await executor.testConnection({ apiKey: COOKIE_A })).toBe(true);
    expect(await executor.testConnection({ providerSpecificData: { "__Secure-1PSID": "psid-alpha" } })).toBe(true);
    expect(await executor.testConnection({ apiKey: "  " })).toBe(false);
    expect(world.launches).toBe(0);
  });
});

describe("Gemini Web chat through the OpenAI chat route", () => {
  it("returns a JSON completion with the page's last cumulative snapshot", async () => {
    const result = await chat("/v1/chat/completions", openAiBody(false));
    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.object).toBe("chat.completion");
    expect(payload.model).toBe(MODEL);
    expect(payload.choices[0]).toMatchObject({ finish_reason: "stop", message: { role: "assistant", content: "reply for psid-alpha" } });

    const [context] = world.contexts;
    expect(context.prompts).toEqual(["hello"]);
    expect(context.options.userAgent).toMatch(/Chrome/);
    expect(context.cookies).toEqual([
      { name: "__Secure-1PSID", value: "psid-alpha", domain: ".google.com", path: "/", secure: true },
      { name: "__Secure-1PSIDTS", value: "ts-alpha", domain: ".google.com", path: "/", secure: true },
    ]);
    expect(context.closed).toBe(true);
  });

  it("returns an SSE stream of chunks that ends with a stop chunk and [DONE]", async () => {
    const result = await chat("/v1/chat/completions", openAiBody(true));
    expect(result.success).toBe(true);
    const text = await result.response.text();
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("reply for psid-alpha");
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("applies the requested model mode and rejects one it cannot confirm", async () => {
    const flash = await chat("/v1/chat/completions", openAiBody(false, { model: "gemini-3.7-flash" }));
    expect(flash.success).toBe(true);
    expect((await flash.response.json()).model).toBe("gemini-3.7-flash");

    world.indicatorText = "Gemini 3.1 Pro";
    const mismatch = await chat("/v1/chat/completions", openAiBody(false, { model: "gemini-3.7-flash" }));
    expect(mismatch.response.status).toBe(400);
    const own = await direct(openAiBody(false, { model: "gemini-3.7-flash" }));
    expect(own.response.status).toBe(400);
    const ownBody = await own.response.json();
    expect(ownBody.error).toMatchObject({ code: "unsupported_control_for_provider" });
    expect(ownBody.error.message).toMatch(/could not verify.*gemini-3\.7-flash/);

    const unknown = await chat("/v1/chat/completions", openAiBody(false, { model: "gemini-9" }));
    expect(unknown.response.status).toBe(400);
  });

  it("rejects a forced tool_choice before launching a browser", async () => {
    const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }];
    const result = await chat("/v1/chat/completions", openAiBody(false, { tools, tool_choice: "required" }));
    expect(result.response.status).toBe(400);
    const own = await direct(openAiBody(false, { tools, tool_choice: "required" }));
    const ownBody = await own.response.json();
    expect(ownBody.error).toMatchObject({ code: "unsupported_control_for_provider" });
    expect(ownBody.error.message).toMatch(/cannot guarantee a forced tool call/);
    expect(world.launches).toBe(0);
  });

  it("parses an emulated tool call out of the page's answer", async () => {
    world.answer = () => ({ status: 200, text: '<tool>{"name":"lookup","arguments":{"q":"berlin"}}</tool>' });
    const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: { q: { type: "string" } } } } }];
    const result = await chat("/v1/chat/completions", openAiBody(false, { tools }));
    const payload = await result.response.json();
    expect(payload.choices[0].message.tool_calls[0].function.name).toBe("lookup");
    expect(JSON.parse(payload.choices[0].message.tool_calls[0].function.arguments)).toEqual({ q: "berlin" });
  });
});

describe("Gemini Web chat through the Anthropic messages route", () => {
  it("translates a Messages request and returns an Anthropic message", async () => {
    const result = await chat("/v1/messages", anthropicBody(false));
    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload).toMatchObject({ type: "message", role: "assistant", stop_reason: "end_turn" });
    expect(payload.content).toEqual([{ type: "text", text: "reply for psid-alpha" }]);
    expect(world.contexts[0].prompts).toEqual(["hello"]);
  });

  it("translates the OpenAI chunks into Anthropic stream events", async () => {
    const result = await chat("/v1/messages", anthropicBody(true));
    expect(result.success).toBe(true);
    const text = await result.response.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("reply for psid-alpha");
    expect(text).toContain("event: message_stop");
  });
});

describe("Gemini Web error mapping", () => {
  it("maps a redirect to the Google sign-in page to a 401 credential error", async () => {
    world.redirectToSignIn = () => true;
    const result = await chat("/v1/chat/completions", openAiBody(false));
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(401);
    const payload = await result.response.json();
    expect(payload.error.message).toMatch(/session expired or not signed in/i);
    expect(world.contexts[0].prompts).toEqual([]);
    expect(world.contexts[0].closed).toBe(true);
  });

  it.each([401, 403])("maps StreamGenerate HTTP %i to a credential error", async (status) => {
    world.answer = () => ({ status, text: "" });
    const result = await chat("/v1/chat/completions", openAiBody(false));
    expect(result.response.status).toBe(status);
    expect((await result.response.json()).error.message).toMatch(/session expired or not signed in/i);
  });

  it("maps StreamGenerate HTTP 429 to a quota error", async () => {
    world.answer = () => ({ status: 429, text: "" });
    const result = await chat("/v1/chat/completions", openAiBody(false));
    expect(result.response.status).toBe(429);
    const payload = await result.response.json();
    expect(payload.error).toMatchObject({ type: "rate_limit_error" });
    expect(payload.choices).toBeUndefined();
    const own = await direct(openAiBody(false));
    const ownBody = await own.response.json();
    expect(own.response.status).toBe(429);
    expect(ownBody.error).toMatchObject({ type: "rate_limit_error", code: "gemini_web_quota_exceeded" });
    expect(ownBody.error.message).toMatch(/usage limit reached/i);
  });

  it("maps an Anthropic-route credential failure to an authentication error", async () => {
    world.redirectToSignIn = () => true;
    const result = await chat("/v1/messages", anthropicBody(false));
    expect(result.response.status).toBe(401);
    const payload = await result.response.json();
    expect(payload.error.type).toBe("authentication_error");
    expect(payload.error.message).toMatch(/session expired or not signed in/i);
  });

  it("answers 502 when StreamGenerate never answers or answers an unreadable body", async () => {
    world.answer = () => ({ status: 200, text: "", body: "not a frame" });
    const unreadable = await chat("/v1/chat/completions", openAiBody(false));
    expect(unreadable.response.status).toBe(502);
    expect((await unreadable.response.json()).error.message ?? "").not.toMatch(/psid/i);
  });

  it("rejects a connection with no cookie before launching a browser", async () => {
    const executor = new GeminiWebExecutor();
    const { response } = await executor.execute({ model: MODEL, body: openAiBody(false), stream: false, credentials: { apiKey: " " }, log });
    expect(response.status).toBe(401);
    expect(world.launches).toBe(0);
  });

  it("reports a missing Chromium as a host problem, not an upstream fault", async () => {
    launch.mockRejectedValueOnce(new Error("browserType.launch: Executable doesn't exist at /x"));
    const result = await chat("/v1/chat/completions", openAiBody(false));
    expect(result.response.status).toBe(503);
    expect((await result.response.json()).error.message).toMatch(/playwright install chromium/);
  });
});

describe("Gemini Web connection isolation", () => {
  it("keeps two connections with different cookies in separate contexts and answers", async () => {
    const [first, second] = await Promise.all([
      chat("/v1/chat/completions", openAiBody(false), { apiKey: COOKIE_A, id: "conn-a" }),
      chat("/v1/chat/completions", openAiBody(false), { apiKey: COOKIE_B, id: "conn-b" }),
    ]);
    const [firstPayload, secondPayload] = await Promise.all([
      first.response.json(),
      second.response.json(),
    ]);
    expect(first.response.status, JSON.stringify(firstPayload)).toBe(200);
    expect(second.response.status, JSON.stringify(secondPayload)).toBe(200);
    expect(firstPayload.choices[0].message.content).toBe("reply for psid-alpha");
    expect(secondPayload.choices[0].message.content).toBe("reply for psid-beta");

    expect(world.contexts).toHaveLength(2);
    const seen = world.contexts.map((context) => context.cookies.map((cookie) => cookie.value).sort());
    expect(seen).toContainEqual(["psid-alpha", "ts-alpha"]);
    expect(seen).toContainEqual(["psid-beta", "ts-beta"]);
    for (const context of world.contexts) {
      const values = context.cookies.map((cookie) => cookie.value).join(",");
      expect(values.includes("alpha") && values.includes("beta")).toBe(false);
      expect(context.closed).toBe(true);
    }
    // One warm Chromium serves both, a fresh context per request.
    expect(world.launches).toBe(1);
  });

  it("never reuses a context across sequential requests", async () => {
    await (await chat("/v1/chat/completions", openAiBody(false), { apiKey: COOKIE_A, id: "conn-a" })).response.text();
    await (await chat("/v1/chat/completions", openAiBody(false), { apiKey: COOKIE_B, id: "conn-b" })).response.text();
    expect(world.contexts.map((context) => context.cookies.map((cookie) => cookie.value).join(","))).toEqual([
      "psid-alpha,ts-alpha",
      "psid-beta,ts-beta",
    ]);
  });

  it("writes only a rotated __Secure-1PSID* cookie back to the connection that rotated it", async () => {
    const onCredentialsRefreshed = vi.fn(async () => {});
    const executor = new GeminiWebExecutor();
    const browser = await launch();
    browser.newContext.mockImplementationOnce(async () => ({
      addCookies: async () => {},
      cookies: async () => [
        { name: "__Secure-1PSIDTS", value: "ts-rotated" },
        { name: "NID", value: "tracking" },
      ],
      close: async () => {},
      newPage: async () => ({
        on: (_event, handler) => { world.rotatedHandler = handler; },
        url: () => "https://gemini.google.com/app",
        goto: async () => {},
        waitForSelector: async () => ({ click: async () => {} }),
        keyboard: {
          insertText: async () => {},
          press: async () => setTimeout(() => world.rotatedHandler({ url: () => STREAM_URL, status: () => 200, text: async () => frameBody("ok") }), 0),
        },
        waitForTimeout: (ms) => new Promise((resolve) => setTimeout(resolve, ms >= 1000 ? 60 : 0)),
      }),
    }));
    launch.mockResolvedValueOnce(browser);
    await resetGeminiBrowserLeaseForTests();

    const { response } = await executor.execute({
      model: MODEL, body: openAiBody(false), stream: false,
      credentials: { apiKey: COOKIE_A }, log, onCredentialsRefreshed,
    });
    expect(response.status).toBe(200);
    expect(onCredentialsRefreshed).toHaveBeenCalledTimes(1);
    const refreshed = onCredentialsRefreshed.mock.calls[0][0].apiKey;
    expect(refreshed).toContain("__Secure-1PSIDTS=ts-rotated");
    expect(refreshed).toContain("__Secure-1PSID=psid-alpha");
    expect(refreshed).not.toContain("NID");
  });
});

describe("Gemini Web helpers", () => {
  it("normalizes a pasted header, a bare value and browser-export JSON", () => {
    expect(normalizeGeminiCookieInput("psid-alpha")).toBe("__Secure-1PSID=psid-alpha");
    expect(normalizeGeminiCookieInput(COOKIE_A)).toBe(COOKIE_A);
    expect(normalizeGeminiCookieInput(JSON.stringify({ cookies: { "__Secure-1PSID": "a", "__Secure-1PSIDTS": "b" } })))
      .toBe("__Secure-1PSID=a; __Secure-1PSIDTS=b");
    expect(normalizeGeminiCookieInput("   ")).toBe("");
  });

  it("keeps the last cumulative snapshot instead of concatenating frames", () => {
    expect(parseStreamResponse(frameBody("hello world"))).toBe("hello world");
    expect(parseStreamResponse(")]}'\n\n12\nnot json wrb.fr\n")).toBe("");
  });

  it("flattens history without dropping the system message", () => {
    expect(buildGeminiPrompt([{ role: "user", content: "hi" }])).toBe("hi");
    expect(buildGeminiPrompt([{ role: "system", content: "be brief" }, { role: "user", content: "hi" }]))
      .toBe("System:\nbe brief\n\nhi");
    const multi = buildGeminiPrompt([
      { role: "user", content: "I am in Berlin" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "What should I wear?" },
    ]);
    expect(multi).toContain("User: I am in Berlin");
    expect(multi).toContain("Current user message:\nWhat should I wear?");
  });

  it("renders completed tool rounds so the model does not repeat the call", () => {
    const prompt = buildGeminiToolPrompt([
      { role: "system", content: "tool contract" },
      { role: "user", content: "weather?" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "lookup", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "sunny" },
    ]);
    expect(prompt).toContain("Assistant requested tool [c1]: lookup({})");
    expect(prompt).toContain("Tool result [c1]: sunny");
    expect(prompt).toContain("Current user message:\nweather?");
  });

  it("merges only the long-lived auth cookies from the live jar", () => {
    const merged = mergeRotatedGeminiCookies(COOKIE_A, [
      { name: "__Secure-1PSIDTS", value: "ts-new" },
      { name: "__Secure-1PSIDCC", value: "cc-new" },
      { name: "NID", value: "tracking" },
    ]);
    expect(merged).toBe("__Secure-1PSID=psid-alpha; __Secure-1PSIDTS=ts-new; __Secure-1PSIDCC=cc-new");
  });
});
