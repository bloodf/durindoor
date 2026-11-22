/**
 * Registration batch C (#2034), route level. The providers whose staged tests drove only the executor or
 * handleChatCore (PromptQL, Notion AI Web, NoTrack Web, Blackbox Web and Conol Web) are driven through the
 * real `/v1/chat/completions` and `/v1/messages` route modules (JSON and streamed), against the production
 * registry, executor map and a temporary SQLite store. Tencent AI Studio Web and TinyCMS Web already have
 * route-level coverage in their own provider tests.
 *
 * Closed mocks only: the upstream site is a scripted global `fetch` and every credential is a synthetic
 * placeholder. A request to any host outside the provider's own origins fails the test.
 */
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

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const readBody = (init) => { try { return JSON.parse(init.body); } catch { return {}; } };

/**
 * One scripted upstream per provider. `origins` are the only hosts the provider may contact; `handle`
 * answers the site's own requests with `answer` and returns undefined for anything unexpected.
 */
const PROVIDERS = [
  {
    id: "promptql", model: "gemini-3.7-flash", answer: "pong from promptql",
    credential: "next-auth.session-token=synthetic-promptql-session",
    providerSpecificData: { token: "synthetic.promptql.jwt", projectId: "synthetic-project" },
    origins: ["https://data.prompt.ql.app/"],
    handle: (url, init, answer) => {
      if (url !== "https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql") return undefined;
      if (init.headers.authorization !== "Bearer synthetic.promptql.jwt") return jsonResponse({}, 401);
      const { operationName } = readBody(init);
      if (operationName === "FetchLlmConfigs") return jsonResponse({ data: { llm_config: [{ id: "cfg-synthetic", model_reference: "gemini-3.7-flash", display_label: "Gemini 3.7 Flash" }] } });
      if (operationName === "StartThreadWithModel") return jsonResponse({ data: { start_thread: { thread_id: "thread-synthetic", thread_events: [] } } });
      if (operationName === "QueryThreadEvents") {
        return jsonResponse({ data: { thread_events: [{ thread_event_id: 1, event_data: { type: "AgentMessage", content: answer, final_response_sent: true } }] } });
      }
      return undefined;
    },
  },
  {
    id: "notion-web", model: "notion-ai", answer: "pong from notion web",
    credential: "token_v2=synthetic-notion-token; space_id=space-synthetic; notion_user_id=user-synthetic",
    origins: ["https://app.notion.com/"],
    handle: (url, init, answer) => {
      if (!String(init.headers.cookie || "").includes("token_v2=synthetic-notion-token")) return jsonResponse({}, 401);
      if (url === "https://app.notion.com/api/v3/getAvailableModels") return jsonResponse({ models: [{ model: "codename", modelMessage: "Notion AI" }] });
      if (url === "https://app.notion.com/api/v3/runInferenceTranscript") return new Response(`${JSON.stringify({ value: { text: answer } })}\n`);
      return undefined;
    },
  },
  {
    id: "notrack-web", model: "notrack-c", answer: "pong from notrack web",
    credential: "uid=uid-synthetic; si_usr_id=user-synthetic; si_ses_id=session-synthetic",
    origins: ["https://notrack.ai/"],
    handle: (url, init, answer) => {
      if (url !== "https://notrack.ai/api/dispatch" || init.method !== "POST") return undefined;
      const half = Math.ceil(answer.length / 2);
      const frames = [{ type: "delta", chunk: answer.slice(0, half) }, { type: "delta", chunk: answer.slice(half) }, { type: "done" }];
      return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    },
  },
  {
    id: "blackbox-web", model: "gpt-4", answer: "pong from blackbox web",
    credential: "next-auth.session-token=synthetic-blackbox-session",
    origins: ["https://app.blackbox.ai/"],
    handle: (url, init, answer) => {
      if (url === "https://app.blackbox.ai/api/auth/session") return jsonResponse({ user: { email: "synthetic@example.invalid" } });
      if (url === "https://app.blackbox.ai/api/check-subscription") return jsonResponse({ hasActiveSubscription: true });
      if (url === "https://app.blackbox.ai/api/chat") return new Response(answer, { headers: { "Content-Type": "text/plain" } });
      return undefined;
    },
  },
  {
    id: "conol-web", model: "claude-sonnet-5", answer: "pong from conol web",
    credential: "__Secure-better-auth.session_token=synthetic-conol-session",
    origins: ["https://conol.ai/"],
    handle: (url, init, answer) => {
      if (url === "https://conol.ai/api/sessions" && init.method === "POST") return jsonResponse({ sessionId: "session-synthetic" });
      if (url === "https://conol.ai/api/sessions/session-synthetic/model") return jsonResponse({ ok: true });
      if (url === "https://conol.ai/api/sessions/session-synthetic/messages" && init.method === "POST") return jsonResponse({ ok: true });
      if (url === "https://conol.ai/api/sessions/session-synthetic/messages?logDeltas=1") {
        const delta = { type: "history_delta", stages: [{ logs: [{ role: "assistant", content: [{ type: "text", text: answer }] }] }] };
        return new Response(`${JSON.stringify(delta)}\n${JSON.stringify({ type: "done" })}\n`, { headers: { "Content-Type": "application/x-ndjson" } });
      }
      return undefined;
    },
  },
];

let root;
let routes;
let seen;

const gatewayRequest = (url, body) => new Request(`http://gateway.invalid${url}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "web-batch-c-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  seen = [];
  routes = {
    providers: await import("../../src/app/api/providers/route.js"),
    chat: await import("../../src/app/api/v1/chat/completions/route.js"),
    messages: await import("../../src/app/api/v1/messages/route.js"),
  };
}, 60000);

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

/** Install the scripted upstream for one provider and save its connection through the providers route. */
async function arm(provider) {
  vi.stubGlobal("fetch", async (input, init = {}) => {
    const url = String(input);
    seen.push(url);
    if (!provider.origins.some((origin) => url.startsWith(origin))) throw new Error(`closed mock: unexpected host ${url}`);
    const reply = provider.handle(url, { ...init, headers: Object.fromEntries(new Headers(init.headers).entries()) }, provider.answer);
    if (!reply) throw new Error(`closed mock: unexpected request ${init.method ?? "GET"} ${url}`);
    return reply;
  });
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
    expect(seen.length).toBeGreaterThan(0);
    for (const url of seen) expect(provider.origins.some((origin) => url.startsWith(origin)), url).toBe(true);
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
