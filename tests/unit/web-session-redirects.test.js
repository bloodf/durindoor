import { afterEach, expect, it, vi } from "vitest";

const { wire } = vi.hoisted(() => ({ wire: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: wire,
}));

import { chromium } from "playwright";
import { BlackboxWebExecutor } from "../../open-sse/executors/blackbox-web.js";
import { ChatPlaygroundExecutor, discoverChatPlaygroundModels, validateChatPlaygroundCookie } from "../../open-sse/executors/chatplayground.js";
import { ClaudeWebExecutor } from "../../open-sse/executors/claude-web.js";
import { ConolWebExecutor } from "../../open-sse/executors/conol-web.js";
import { DeepSeekWebExecutor } from "../../open-sse/executors/deepseek-web.js";
import { deepSeekHashV1 } from "../../open-sse/executors/deepseek-web/deepseek-pow-hash.js";
import { DoubaoWebExecutor } from "../../open-sse/executors/doubao-web.js";
import { GeminiWebExecutor, resetGeminiBrowserLeaseForTests } from "../../open-sse/executors/gemini-web.js";
import { validateLmarenaSession } from "../../open-sse/executors/lmarena.js";
import { MaxaiExecutor } from "../../open-sse/executors/maxai.js";
import { NotionWebExecutor } from "../../open-sse/executors/notion-web.js";
import { NotrackWebExecutor } from "../../open-sse/executors/notrack-web.js";
import { TencentAIStudioWebExecutor } from "../../open-sse/executors/tencent-aistudio-web.js";
import { TinyCmsExecutor } from "../../open-sse/executors/tinycms-web.js";
import { ZaiWebExecutor } from "../../open-sse/executors/zai-web.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { POST as validateProvider } from "../../src/app/api/providers/validate/route.js";

const target = "https://redirect.invalid/collect";
const redirect = () => new Response(null, { status: 302, headers: { location: target } });
const jwt = (payload) => `fixture.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
const playgroundCookie = `__client=fixture; __session=${jwt({ sid: "sid-fixture" })}`;
const model = "fixture-model";
const body = { model, messages: [{ role: "user", content: "hello" }], stream: false };
const catalog = [{ botId: model, modelName: model }];
const signing = { maxaiSigningConstants: { hmacKey: "a".repeat(40), aesKey: "b".repeat(40), ctxKey: "c".repeat(40), appVersion: "webpage_1.2.3" } };
const ip = ["api64.ipify.org", { ip: "192.0.2.1" }];
const deepSeekChallenge = { algorithm: "DeepSeekHashV1", salt: "fixture-2034", expire_at: 1900000000,
  difficulty: 8, signature: "synthetic-signature", challenge: deepSeekHashV1("fixture-2034_1900000000_3") };

function stubRequests(steps) {
  wire.mockImplementation(async () => {
    const [, result] = steps[wire.mock.calls.length - 1] ?? [];
    return result === undefined ? redirect() : Response.json(result);
  });
  vi.stubGlobal("fetch", wire);
}

function expectRequests(steps) {
  expect(wire).toHaveBeenCalledTimes(steps.length);
  for (const [index, [url, options]] of wire.mock.calls.entries()) {
    const [expected, , credentialed = expected !== ip[0]] = steps[index];
    expect(String(url)).not.toBe(target);
    expect(expected).toBeDefined();
    expect(String(url)).toContain(expected);
    if (credentialed) {
      expect(options.redirect).toBe("manual");
    }
  }
}

async function expectSessionError(response) {
  expect(response.status).toBe(401);
  const result = await response.json();
  expect(result.error?.message ?? result.error).toMatch(/session|cookie|uuid|token|auth/i);
}

afterEach(async () => {
  await resetGeminiBrowserLeaseForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  wire.mockReset();
});

const fetchProviders = [
  { id: "tinycms-web", Executor: TinyCmsExecutor, apiKey: "R-synthetic", validate: "/api/challenge", chat: [
    ip, ["/api/challenge", { challengeId: "fixture", challenge: "fixture", difficulty: 0 }], ["/chat/completions"],
  ] },
  { id: "claude-web", Executor: ClaudeWebExecutor, apiKey: "sessionKey=fixture", validate: "/organizations", chat: [
    ["/organizations", [{ uuid: "org-fixture" }]], ["/completion"],
  ] },
  { id: "deepseek-web", Executor: DeepSeekWebExecutor, apiKey: "fixture", validate: "/v0/users/current", genericValidation: true, chat: [
    ["/v0/users/current", { data: { biz_data: { token: "fixture-access" } } }],
    ["/v0/chat_session/create", { data: { biz_data: { chat_session: { id: "fixture" } } } }],
    // Mandatory source proof (#2034): a deterministic challenge the real solver answers with nonce 3.
    // Its redirect contract (502, never followed, no completion) is pinned by deepseek-web-source-parity-2034.
    ["/v0/chat/create_pow_challenge", { data: { biz_data: { challenge: deepSeekChallenge } } }, false],
    ["/v0/chat/completion"],
  ] },
  { id: "doubao-web", Executor: DoubaoWebExecutor, apiKey: "sessionid=fixture; ttwid=fixture; s_v_web_id=fixture", chat: [["/chat/"]] },
  // Synthetic opaque CAPTCHA proof so the executor dispatches; without one it refuses before any POST.
  { id: "zai-web", Executor: ZaiWebExecutor, apiKey: `token=${jwt({ id: "fixture" })}`, providerSpecificData: { captchaVerifyParam: "synthetic-proof-redirect" }, chat: [
    ["/api/v1/chats/new", { id: "fixture" }], ["/completions"],
  ] },
  { id: "notion-web", Executor: NotionWebExecutor, apiKey: "token_v2=fixture", validate: "getSpaces", chat: [
    ["getSpaces", { fixture: { space: { "fixture-space": {} } } }],
    ["getAvailableModels", { models: [] }],
    ["runInferenceTranscript"],
  ] },
  { id: "notrack-web", Executor: NotrackWebExecutor, apiKey: "uid=fixture; si_usr_id=fixture; si_ses_id=fixture", chat: [["notrack.ai/"]] },
  { id: "tencent-aistudio-web", Executor: TencentAIStudioWebExecutor, apiKey: "sessionid=fixture", validate: "/api/user/info", chat: [["aistudio.tencent.ai/"]] },
  { id: "blackbox-web", Executor: BlackboxWebExecutor, apiKey: "next-auth.session-token=fixture", chat: [
    ["/api/auth/session", { user: { email: "fixture@example.invalid" } }],
    ["/api/check-subscription", {}], ["/api/chat"],
  ] },
  { id: "conol-web", Executor: ConolWebExecutor, apiKey: "__Secure-better-auth.session_token=fixture", chat: [
    ["/api/sessions", { sessionId: "fixture" }],
    ...Array.from({ length: 3 }, () => ["/model", {}]),
    ["/messages", {}], ["?logDeltas=1"],
  ] },
  { id: "chatplayground", Executor: ChatPlaygroundExecutor, apiKey: playgroundCookie, chat: [
    ["/tokens", { jwt: "fixture-access" }], ["/api/me", {}], ["/api/models", catalog], ["web.chatplayground.ai/api/chat"],
  ] },
  { id: "maxai", Executor: MaxaiExecutor, apiKey: "access_token=fixture; device_id=fixture; user_id=fixture", providerSpecificData: signing, validate: "/models/get_config", chat: [["api.maxai.me/"]] },
];

for (const { id, Executor, apiKey, providerSpecificData, validate, genericValidation, chat } of fetchProviders) {
  if (validate) {
    it(`${id} stops on a validation redirect`, async () => {
      stubRequests([[validate]]);
      const result = await probeRegistryProvider(id, apiKey, wire, providerSpecificData);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(genericValidation ? /HTTP 302/ : /session|cookie|uuid|token/i);
      expectRequests([[validate]]);
    });
  } else if (["doubao-web", "zai-web", "notrack-web"].includes(id)) {
    it(`${id} validates without requesting a conversation`, async () => {
      stubRequests([]);
      const request = new Request("http://gateway.invalid/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, apiKey }),
      });
      expect(await (await validateProvider(request)).json()).toMatchObject({ skipped: true });
      expect(wire).not.toHaveBeenCalled();
    });
  }

  for (const [index, [path, , credentialed = path !== ip[0]]] of chat.entries()) {
    if (!credentialed) continue;
    it(`${id} stops on chat request ${index + 1} (${path}) redirect`, async () => {
      const steps = [...chat.slice(0, index), [path]];
      stubRequests(steps);
      const result = await new Executor().execute({
        body, model, stream: false, credentials: { apiKey, providerSpecificData },
        proxyOptions: { fixture: index },
      });
      await expectSessionError(result.response);
      expectRequests(steps);
    });
  }
}

it("ChatPlayground stops on a Clerk validation redirect", async () => {
  const steps = [["/tokens"]];
  stubRequests(steps);
  await expect(validateChatPlaygroundCookie(playgroundCookie, wire)).resolves.toMatchObject({ valid: false, status: 302, error: expect.stringMatching(/session/i) });
  expectRequests(steps);
});

it("ChatPlayground stops on a credentialed model discovery redirect", async () => {
  const steps = [["/tokens", { jwt: "fixture-access" }], ["/api/models"]];
  stubRequests(steps);
  await expect(discoverChatPlaygroundModels({ apiKey: playgroundCookie }, wire)).resolves.toMatchObject({ status: 401, error: expect.stringMatching(/session/i) });
  expectRequests(steps);
});

it.each([target, "https://accounts.google.com/signin", "https://www.google.com/"])(
  "Gemini validation rejects a redirect to %s",
  async (location) => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
    const result = await probeRegistryProvider("gemini-web", "__Secure-1PSID=fixture", fetcher);
    expect(result).toMatchObject({ valid: false, status: 302, error: expect.stringMatching(/session|cookie/i) });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://gemini.google.com/app",
      expect.objectContaining({ redirect: "manual" }),
    );
  }
);

it("ChatPlayground stops on a user validation redirect", async () => {
  const steps = [["/tokens", { jwt: "fixture-access" }], ["/api/me"]];
  stubRequests(steps);
  await expect(validateChatPlaygroundCookie(playgroundCookie, wire))
    .resolves.toMatchObject({ valid: false, status: 302, error: expect.stringMatching(/session/i) });
  expectRequests(steps);
});

it("Gemini converts a browser chat redirect to a credential error before Chromium can follow it", async () => {
  let onPaused;
  let onResponse;
  const send = vi.fn(async (method, options) => {
    if (method === "Fetch.fulfillRequest") {
      await onResponse({ url: () => "https://gemini.google.com/StreamGenerate", status: () => options.responseCode });
    }
  });
  const page = {
    goto: async () => undefined,
    on: (_event, handler) => { onResponse = handler; },
    waitForSelector: async () => ({ click: async () => {} }),
    waitForTimeout: async () => {},
    keyboard: {
      insertText: async () => {},
      press: async () => {
        await onPaused({ request: { url: "https://gemini.google.com/StreamGenerate" }, requestId: "chat", responseStatusCode: 302, responseHeaders: [{ name: "location", value: target }] });
      },
    },
  };
  vi.spyOn(chromium, "launch").mockResolvedValue({
    isConnected: () => true,
    close: async () => {},
    newContext: async () => ({
      addCookies: async () => {},
      newPage: async () => page,
      newCDPSession: async () => ({ on: (_event, handler) => { onPaused = handler; }, send }),
      close: async () => {},
    }),
  });
  stubRequests([]);
  const { response } = await new GeminiWebExecutor().execute({
    body, stream: false, credentials: { apiKey: "__Secure-1PSID=fixture" },
  });
  await expectSessionError(response);
  expect(send.mock.calls).toEqual([
    ["Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Response" }] }],
    ["Fetch.fulfillRequest", { requestId: "chat", responseCode: 401, responseHeaders: [], body: "" }],
  ]);
  expect(wire).not.toHaveBeenCalled();
});

it("LMArena stops on a redirect from the injected validation fetch", async () => {
  const steps = [["/create-evaluation"]];
  stubRequests(steps);
  await expect(validateLmarenaSession({ apiKey: "arena-auth-prod-v1=fixture" }, wire))
    .resolves.toMatchObject({ valid: false, status: 302, error: expect.stringMatching(/session/i) });
  expectRequests(steps);
});
