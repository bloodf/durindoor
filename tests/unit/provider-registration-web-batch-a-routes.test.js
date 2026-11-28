/**
 * Registration batch A (#2034), route level. Every provider registered by the batch is driven through
 * the real `/v1/chat/completions` and `/v1/messages` route modules (JSON and streamed), against the
 * production registry, executor map and a temporary SQLite store.
 *
 * Closed mocks only: the upstream site is a scripted global `fetch` (or, for Gemini Web, a scripted
 * Playwright; for ChatGPT Web Codex, a scripted TLS client). Credentials are synthetic placeholders.
 * Nothing here reaches a provider, a browser or the network; a request to any host outside the
 * provider's own origin fails the test.
 */
import { deepSeekHashV1 } from "../../open-sse/executors/deepseek-web/deepseek-pow-hash.js";
const deepSeekCalls = [];
const sourceChallenge = { algorithm: "DeepSeekHashV1", salt: "fixture-2034", expire_at: 1900000000,
  difficulty: 8, signature: "synthetic-signature", challenge: deepSeekHashV1("fixture-2034_1900000000_3") };
const assertSourceProof = (calls) => {
  expect(calls.map(([url]) => new URL(url).pathname)).toEqual([
    "/api/v0/users/current", "/api/v0/chat_session/create", "/api/v0/chat/create_pow_challenge", "/api/v0/chat/completion",
  ]);
  expect(JSON.parse(calls[2][1].body)).toEqual({ target_path: "/api/v0/chat/completion" });
  expect(JSON.parse(Buffer.from(calls[3][1].headers["X-Ds-Pow-Response"], "base64"))).toEqual({
    algorithm: sourceChallenge.algorithm, challenge: sourceChallenge.challenge, salt: sourceChallenge.salt,
    answer: 3, signature: sourceChallenge.signature, target_path: "/api/v0/chat/completion",
  });
};
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", async (importOriginal) => ({
  ...(await importOriginal()),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  finishPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

// A scripted Playwright for Gemini Web: the page answers StreamGenerate with the text in `gemini.answer`.
const gemini = vi.hoisted(() => ({ answer: "", pages: 0, streamUrl: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=x" }));
vi.mock("playwright", () => {
  const frame = (text) => JSON.stringify([["wrb.fr", null, JSON.stringify([null, null, null, null, [["c_1", [text]]]])]]);
  const launch = vi.fn(async () => ({
    isConnected: () => true,
    close: vi.fn(async () => {}),
    newContext: vi.fn(async () => ({
      addCookies: vi.fn(async () => {}),
      cookies: vi.fn(async () => []),
      close: vi.fn(async () => {}),
      newPage: vi.fn(async () => {
        gemini.pages += 1;
        let onResponse = null;
        let url = "about:blank";
        return {
          on: (event, handler) => { if (event === "response") onResponse = handler; },
          url: () => url,
          goto: vi.fn(async (target) => { url = target; }),
          waitForSelector: vi.fn(async () => ({ click: vi.fn(async () => {}), textContent: vi.fn(async () => "Gemini 3.7 Flash") })),
          keyboard: {
            insertText: vi.fn(async () => {}),
            press: vi.fn(async (key) => {
              if (key !== "Enter") return;
              const text = gemini.answer;
              const half = text.slice(0, Math.ceil(text.length / 2));
              setTimeout(() => onResponse?.({
                url: () => gemini.streamUrl,
                status: () => 200,
                text: async () => `)]}'\n\n10\n${frame(half)}\n20\n${frame(text)}\n`,
              }), 0);
            }),
          },
          waitForTimeout: (ms) => new Promise((resolve) => setTimeout(resolve, ms >= 1000 ? 60 : 0)),
        };
      }),
    })),
  }));
  return { chromium: { launch }, default: { chromium: { launch } } };
});

const sse = (...frames) => `${frames.map((frameValue) => `data: ${JSON.stringify(frameValue)}\n\n`).join("")}data: [DONE]\n\n`;
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const eventStream = (text) => new Response(text, { headers: { "Content-Type": "text/event-stream" } });
const jwt = (id) => `header.${Buffer.from(JSON.stringify({ id })).toString("base64url")}.signature`;

/**
 * One scripted upstream per provider. `origin` is the only host the provider may contact; `handle`
 * answers the site's own requests with `answer` and returns undefined for anything unexpected.
 */
const PROVIDERS = [
  {
    id: "claude-web", model: "claude-sonnet-4-6", answer: "pong from claude web",
    credential: "sessionKey=synthetic-claude-session", origin: "https://claude.ai",
    handle: (url, init, answer) => {
      if (url.endsWith("/api/organizations")) return jsonResponse([{ uuid: "org-synthetic" }]);
      if (url.endsWith("/completion")) {
        return eventStream(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: answer } })}\n\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}\n\n`);
      }
      return undefined;
    },
  },
  {
    id: "gemini-web", model: "gemini-3.1-pro", answer: "pong from gemini web",
    credential: "__Secure-1PSID=synthetic-psid; __Secure-1PSIDTS=synthetic-psidts", origin: "https://gemini.google.com",
    // The browser is scripted; no site request is made through fetch.
    handle: () => undefined,
    scriptBrowser: (answer) => { gemini.answer = answer; },
  },
  {
    id: "deepseek-web", model: "deepseek-chat", answer: "pong from deepseek web",
    credential: "synthetic-deepseek-usertoken", origin: "https://chat.deepseek.com",
    handle: (url, init, answer) => {
      if (url.endsWith("/v0/users/current")) deepSeekCalls.length = 0;
      deepSeekCalls.push([url, init]);
      if (url.endsWith("/v0/users/current")) return jsonResponse({ data: { biz_data: { token: "synthetic-access-token" } } });
      if (url.endsWith("/v0/chat_session/create")) return jsonResponse({ data: { biz_data: { chat_session: { id: "session-synthetic" } } } });
      if (url.endsWith("/v0/chat/create_pow_challenge")) return jsonResponse({ data: { biz_data: { challenge: sourceChallenge } } });
      if (url.endsWith("/v0/chat/completion")) {
        assertSourceProof(deepSeekCalls);
        expect(JSON.parse(Buffer.from(init.headers["X-Ds-Pow-Response"], "base64"))).toMatchObject({ answer: 3, challenge: sourceChallenge.challenge });
        return eventStream(sse({ choices: [{ delta: { content: answer }, finish_reason: "stop" }] }));
      }
      return undefined;
    },
  },
  {
    id: "doubao-web", model: "dola-speed", answer: "pong from doubao web",
    credential: "sessionid=synthetic-session; s_v_web_id=verify_synthetic", origin: "https://www.dola.com",
    handle: (url, init, answer) => {
      if (!url.startsWith("https://www.dola.com/chat/completion")) return undefined;
      const block = { content: { content_block: [{ content: { text_block: { text: answer } } }] } };
      return eventStream(`event: MESSAGE_DELTA\ndata: ${JSON.stringify(block)}\n\n`);
    },
  },
  {
    id: "zai-web", model: "glm-5.3", answer: "pong from zai web",
    credential: `token=${jwt("synthetic-user")}`, origin: "https://chat.z.ai",
    handle: (url, init, answer) => {
      if (url === "https://chat.z.ai/api/v1/chats/new") return jsonResponse({ id: "chat-synthetic" });
      if (url.startsWith("https://chat.z.ai/api/v2/chat/completions?")) {
        return eventStream(`data: ${JSON.stringify({ data: { phase: "answer", delta_content: answer } })}\n\ndata: [DONE]\n\n`);
      }
      return undefined;
    },
  },
  {
    id: "chatgpt-web-codex", model: "think", answer: "pong from chatgpt web codex",
    credential: "__Secure-next-auth.session-token=synthetic-chatgpt-session", origin: "https://chatgpt.com",
    providerSpecificData: { transport: "http" },
    // The HTTP transport speaks through the TLS client, which the test replaces.
    handle: () => undefined,
    scriptTls: (answer, tls) => tls((url) => {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (url.includes("/api/auth/session")) return { status: 200, headers, body: null, text: JSON.stringify({ accessToken: "synthetic-jwt", user: { id: "u1" } }) };
      if (url.includes("/sentinel/chat-requirements")) return { status: 200, headers, body: null, text: JSON.stringify({ token: "t", proofofwork: { required: false } }) };
      if (url.includes("/backend-api/f/conversation") || url.endsWith("/backend-api/conversation")) {
        const message = (status) => ({ conversation_id: "c1", message: { id: "m1", author: { role: "assistant" }, content: { content_type: "text", parts: [answer] }, status } });
        const body = `${[message("in_progress"), message("finished_successfully")].map((entry) => `data: ${JSON.stringify(entry)}\r\n\r\n`).join("")}data: [DONE]\r\n\r\n`;
        return { status: 200, headers: new Headers({ "Content-Type": "text/event-stream" }), body: null, text: body };
      }
      return { status: 200, headers, body: null, text: "<html></html>" };
    }),
  },
];

let root;
let routes;
let seen;
let tlsUrls;

const gatewayRequest = (url, body) => new Request(`http://gateway.invalid${url}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "web-batch-a-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  seen = [];
  tlsUrls = [];
  gemini.answer = "";
  gemini.pages = 0;
  routes = {
    providers: await import("../../src/app/api/providers/route.js"),
    chat: await import("../../src/app/api/v1/chat/completions/route.js"),
    messages: await import("../../src/app/api/v1/messages/route.js"),
  };
}, 60000);

afterEach(async () => {
  const { resetGeminiBrowserLeaseForTests } = await import("../../open-sse/executors/gemini-web.js");
  await resetGeminiBrowserLeaseForTests();
  const { __setTlsFetchOverrideForTesting } = await import("../../open-sse/services/chatgptTlsClient.js");
  __setTlsFetchOverrideForTesting(null);
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

/** Install the scripted upstream for one provider and save its connection through the providers route. */
async function arm(provider) {
  const { __setTlsFetchOverrideForTesting } = await import("../../open-sse/services/chatgptTlsClient.js");
  // One stable dispatcher: some executors keep the `fetch` they saw when they were constructed.
  vi.stubGlobal("fetch", async (input, init = {}) => {
    const url = String(input);
    seen.push(url);
    if (!url.startsWith(provider.origin)) throw new Error(`closed mock: unexpected host ${url}`);
    const reply = provider.handle(url, init, provider.answer);
    if (!reply) throw new Error(`closed mock: unexpected request ${url}`);
    return reply;
  });
  provider.scriptBrowser?.(provider.answer);
  provider.scriptTls?.(provider.answer, (script) => __setTlsFetchOverrideForTesting(async (url, options) => {
    tlsUrls.push(String(url));
    if (!String(url).startsWith(provider.origin)) throw new Error(`closed mock: unexpected TLS host ${url}`);
    return script(String(url), options);
  }));
  const saved = await routes.providers.POST(gatewayRequest("/api/providers", {
    provider: provider.id, name: `${provider.id}-synthetic`, apiKey: provider.credential,
    ...(provider.providerSpecificData ? { providerSpecificData: provider.providerSpecificData } : null),
  }));
  expect(saved.status).toBe(201);
  const { connection } = await saved.json();
  expect(connection.provider).toBe(provider.id);
}

const openAiBody = (provider, stream) => ({
  model: `${provider.id}/${provider.model}`, stream, messages: [{ role: "user", content: "ping" }],
});
const anthropicBody = (provider, stream) => ({
  model: `${provider.id}/${provider.model}`, max_tokens: 64, stream, messages: [{ role: "user", content: "ping" }],
});

describe.each(PROVIDERS)("route-level chat for $id (closed mock)", (provider) => {
  beforeEach(async () => { await arm(provider); });

  const reachedOnlyItsOwnOrigin = () => {
    // The scripted upstream was really reached: by fetch, by the TLS client, or by the scripted page.
    expect(seen.length + tlsUrls.length + gemini.pages).toBeGreaterThan(0);
    for (const url of [...seen, ...tlsUrls]) expect(url.startsWith(provider.origin), url).toBe(true);
  };

  it("answers /v1/chat/completions as JSON", async () => {
    const response = await routes.chat.POST(gatewayRequest("/v1/chat/completions", openAiBody(provider, false)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toContain(provider.answer);
    expect(body.choices[0].finish_reason).toBeTruthy();
    reachedOnlyItsOwnOrigin();
  });

  it("answers /v1/chat/completions as a stream", async () => {
    const response = await routes.chat.POST(gatewayRequest("/v1/chat/completions", openAiBody(provider, true)));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    const streamed = text.split("\n").filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map((line) => JSON.parse(line.slice(6))).map((chunk) => chunk.choices?.[0]?.delta?.content ?? "").join("");
    expect(streamed).toContain(provider.answer);
    expect(text).toContain("data: [DONE]");
    reachedOnlyItsOwnOrigin();
  });

  it("answers /v1/messages as JSON", async () => {
    const response = await routes.messages.POST(gatewayRequest("/v1/messages", anthropicBody(provider, false)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.content.map((block) => block.text ?? "").join("")).toContain(provider.answer);
    reachedOnlyItsOwnOrigin();
  });

  it("answers /v1/messages as a stream", async () => {
    const response = await routes.messages.POST(gatewayRequest("/v1/messages", anthropicBody(provider, true)));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("event: message_stop");
    const streamed = text.split("\n").filter((line) => line.startsWith("data: "))
      .map((line) => { try { return JSON.parse(line.slice(6)); } catch { return {}; } })
      .filter((event) => event.type === "content_block_delta").map((event) => event.delta?.text ?? "").join("");
    expect(streamed).toContain(provider.answer);
    reachedOnlyItsOwnOrigin();
  });
});
