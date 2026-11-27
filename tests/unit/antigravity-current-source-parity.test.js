/**
 * Antigravity current-source parity (#2034): model aliases and executor
 * response/error contracts pinned against public sources.
 *
 * Sources:
 * - OmniRoute 9671192011beb2d7f83979f40be488c5da8772b9
 *   open-sse/config/antigravityModelAliases.ts (ANTIGRAVITY_MODEL_ALIASES)
 * - CLIProxyAPI 47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e
 *   internal/runtime/executor/antigravity_executor_finish_reason_test.go
 *   (antigravityNoFinishReasonSSE, TestAntigravityStreamSurfacesTrailingBackendError)
 *   internal/runtime/executor/antigravity_executor_execute.go and
 *   antigravity_executor_stream.go (HTTP 2xx in-band `error` handling),
 *   antigravity_executor_credits.go (antigravityInBandErrorStatusCode)
 *
 * Real: sqlite DB, handleChat, account selection, the executor and translators.
 * Synthetic: every token and outbound byte. Sockets are refused, so no live
 * provider traffic is possible.
 */
import "../translator/registerAll.js";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";
import { getModelUpstreamId, getModelUpstreamThinkingIntent } from "../../open-sse/config/providerModels.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-antigravity-machine-id" }));
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({ ...(await importOriginal()), appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), saveRequestDetail: vi.fn(() => Promise.resolve()), saveRequestUsage: vi.fn(() => Promise.resolve()) }));
const wire = vi.hoisted(() => ({ send: null }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (url, init) => wire.send(url, init),
}));

const PROVIDERS = ["antigravity", "ag", "agy"];

// OmniRoute ANTIGRAVITY_MODEL_ALIASES entries this checkout now maps (absent before).
const ADDED_ALIASES = {
  "gpt-oss-120b": "gpt-oss-120b-medium",
  "gemini-claude-sonnet-4-5": "claude-sonnet-4-6",
  "gemini-claude-sonnet-4-5-thinking": "claude-sonnet-4-6",
  "gemini-claude-opus-4-5-thinking": "claude-opus-4-6-thinking",
};

// OmniRoute aliases already mapped identically before this change.
const PRESENT_ALIASES = {
  "gemini-3.7-flash-high": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-medium": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-low": "gemini-3.7-flash-tiered",
  "gemini-4-hydrogen": "gemini-4-hydrogen-high",
  "gemini-3.1-pro-high": "gemini-pro-agent",
};

// Existing local defaults that differ from OmniRoute. Preserved deliberately;
// changing a bare-id default tier is a behavior change outside this unit.
const PRESERVED_DIFFERENT_DEFAULTS = {
  "gemini-3.8-flash": { local: "gemini-3.8-flash-medium", omniroute: "gemini-3.8-flash-high" },
  "gemini-4-argon": { local: "gemini-4-argon-high", omniroute: "gemini-4-argon-medium" },
  "gemini-4-carbon": { local: "gemini-4-carbon-high", omniroute: "gemini-4-carbon-medium" },
};

describe("OmniRoute 9671192 alias table", () => {
  it.each(PROVIDERS)("%s resolves every added legacy/tier alias to the current upstream id", (provider) => {
    for (const [alias, upstream] of Object.entries(ADDED_ALIASES)) {
      expect(getModelUpstreamId(provider, alias), alias).toBe(upstream);
    }
  });

  it("adds no thinking preset to the legacy Claude or GPT-OSS aliases", () => {
    expect(getModelUpstreamThinkingIntent("antigravity", "gemini-claude-opus-4-5-thinking")).toBeFalsy();
    expect(getModelUpstreamThinkingIntent("antigravity", "gpt-oss-120b")).toBeFalsy();
  });

  it.each(PROVIDERS)("%s keeps already-present aliases and local bare-id defaults", (provider) => {
    for (const [alias, upstream] of Object.entries(PRESENT_ALIASES)) {
      expect(getModelUpstreamId(provider, alias), alias).toBe(upstream);
    }
    for (const [alias, { local }] of Object.entries(PRESERVED_DIFFERENT_DEFAULTS)) {
      expect(getModelUpstreamId(provider, alias), alias).toBe(local);
    }
  });

  // gemini-3.8-flash-tiered: OmniRoute aliases it to -high, while CLIProxyAPI
  // models.json lists and sends it verbatim. Conflicting sources: kept verbatim.
  it("does not alias ids the sources leave verbatim, contest, or treat as non-chat", () => {
    for (const id of ["gemini-3.8-flash-tiered", "gemini-3.1-pro-low", "claude-sonnet-4-6", "gemini-3.7-flash-tiered", "gemini-3.1-flash-lite", "gemini-3-pro-image-preview"]) {
      expect(getModelUpstreamId("antigravity", id), id).toBe(id);
    }
  });
});

const TOKEN_A = "synthetic-antigravity-token-a";
const TOKEN_B = "synthetic-agy-token-b";
const accountOf = { [`Bearer ${TOKEN_A}`]: "A", [`Bearer ${TOKEN_B}`]: "B" };

let root, db, handleChat;
let sent = [];
let reply = null;
let dialled = [];

const sse = (text) => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });

// CLIProxyAPI antigravityNoFinishReasonSSE: a complete functionCall, usage and no finishReason.
const NO_FINISH_TOOL_CALL = `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"CqcECqQEARFNMg8iZ3xVniKaulgBlzhJJDlc","functionCall":{"name":"bash","args":{"command":"ls -la .."},"id":"call_524881"}}],"role":"model"}}],"modelVersion":"gemini-3.7-flash","responseId":"resp-nofr","usageMetadata":{"promptTokenCount":153609,"candidatesTokenCount":17,"totalTokenCount":153720}}}\n\n`;

// CLIProxyAPI TestAntigravityStreamSurfacesTrailingBackendError body.
const TRAILING_BACKEND_ERROR = `data: {"response":{"candidates":[{"content":{"parts":[{"text":"partial"}]}}],"modelVersion":"gemini-3.7-flash"}}

{
  "error": {
    "code": 503,
    "message": "backend capacity exhausted",
    "status": "UNAVAILABLE"
  }
}
`;

// HTTP 200 SSE carrying an in-band `data: {"error":...}` frame after output
// (antigravity_executor_stream.go mid-stream error branch).
const MID_STREAM_ERROR_FRAME = `data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"partial"}]}}]}}\n\ndata: {"error":{"code":403,"message":"synthetic permission denied","status":"PERMISSION_DENIED"}}\n\n`;

const TEXT_ANSWER = `data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"OK"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1,"totalTokenCount":4}}}\n\n`;

async function upstream(url, init = {}) {
  const target = String(url);
  if (!target.includes(":streamGenerateContent") && !target.includes(":generateContent")) {
    return new Response("{}", { status: 404 });
  }
  const account = accountOf[new Headers(init.headers).get("authorization")];
  sent.push({ account, url: target, body: JSON.parse(init.body) });
  return reply();
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ag-current-parity-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  sent = [];
  dialled = [];
  reply = () => sse(TEXT_ANSWER);
  wire.send = upstream;
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function refuse(...args) {
    dialled.push(JSON.stringify(args[0]?.host ?? args[0]?.[0]?.host ?? args[1] ?? "unknown"));
    process.nextTick(() => this.destroy(new Error("offline test: outbound connection refused")));
    return this;
  });
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  db = await import("../../src/lib/db/repos/connectionsRepo.js");
  const settings = await import("../../src/lib/db/repos/settingsRepo.js");
  await settings.updateSettings({ requireApiKey: false });
  vi.stubGlobal("fetch", vi.fn(upstream));
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
  await db.createProviderConnection({ provider: "antigravity", authType: "oauth", name: "a", email: "a@example.test", accessToken: TOKEN_A, refreshToken: "refresh-a", expiresAt, projectId: "project-a", isActive: true });
  await db.createProviderConnection({ provider: "agy", authType: "oauth", name: "b", email: "b@example.test", accessToken: TOKEN_B, refreshToken: "refresh-b", expiresAt, projectId: "project-b", isActive: true });
}, 60000);

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  expect(dialled).toEqual([]);
});

const post = (endpoint, body) => handleChat(new Request(`http://localhost/v1/${endpoint}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));
const openai = (model, stream) => post("chat/completions", { model, stream, messages: [{ role: "user", content: "ping" }] });
const anthropic = (model, stream) => post("messages", { model, stream, max_tokens: 256, messages: [{ role: "user", content: "ping" }] });

const dataFrames = (text) => text.split("\n").filter((line) => line.startsWith("data: ") && line !== "data: [DONE]").map((line) => JSON.parse(line.slice(6)));

describe("aliases reach the wire with the selected account", () => {
  it.each([
    ["antigravity/gemini-claude-sonnet-4-5-thinking", "A", "project-a", "claude-sonnet-4-6"],
    ["agy/gemini-claude-opus-4-5-thinking", "B", "project-b", "claude-opus-4-6-thinking"],
    ["agy/gpt-oss-120b", "B", "project-b", "gpt-oss-120b-medium"],
    ["ag/gemini-3.8-flash-tiered", "A", "project-a", "gemini-3.8-flash-tiered"],
  ])("%s dispatches as the current upstream id", async (model, account, project, upstreamId) => {
    const response = await openai(model, true);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("OK");
    expect(sent).toHaveLength(1);
    expect(sent[0].account).toBe(account);
    expect(sent[0].body.project).toBe(project);
    expect(sent[0].body.model).toBe(upstreamId);
  }, 60000);
});


// CLIProxyAPI synthesizes a successful terminal (OpenAI `tool_calls`, Gemini
// `STOP`) when the stream ends without a finishReason. DurinDoor deliberately
// fails closed instead: the client receives every tool-call delta, then an
// in-band incomplete-stream error and never a successful finish.
describe("CLIProxyAPI no-finishReason tool call (local fail-closed contract)", () => {
  it("streams the complete tool call to OpenAI, then an error instead of a finish", async () => {
    reply = () => sse(NO_FINISH_TOOL_CALL);
    const response = await openai("antigravity/gemini-3.7-flash-high", true);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
    const frames = dataFrames(text);
    expect(frames.some((frame) => frame.choices?.[0]?.finish_reason)).toBe(false);
    const calls = frames.flatMap((frame) => frame.choices?.[0]?.delta?.tool_calls || []);
    expect(calls[0].function.name).toBe("bash");
    expect(JSON.parse(calls.map((call) => call.function.arguments || "").join(""))).toEqual({ command: "ls -la .." });
    expect(frames.at(-1).error).toMatchObject({ code: "incomplete_upstream_stream" });
  }, 60000);

  it("streams the tool_use block to Anthropic, then an error instead of message_stop", async () => {
    reply = () => sse(NO_FINISH_TOOL_CALL);
    const response = await anthropic("antigravity/gemini-3.7-flash-high", true);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("message_stop");
    expect(text).not.toContain("message_delta");
    const events = dataFrames(text);
    const toolStart = events.find((event) => event.type === "content_block_start" && event.content_block?.type === "tool_use");
    expect(toolStart.content_block.name.toLowerCase()).toBe("bash");
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "incomplete_upstream_stream" } });
  }, 60000);

  it.each([["OpenAI", openai], ["Anthropic", anthropic]])("rejects the non-stream %s request with 502", async (_name, call) => {
    reply = () => sse(NO_FINISH_TOOL_CALL);
    const response = await call("antigravity/gemini-3.7-flash-high", false);
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain('"finish_reason"');
    expect(text).not.toContain('"stop_reason"');
  }, 60000);
});

describe("CLIProxyAPI in-band backend errors after output", () => {
  const notSuccessful = (text) => {
    expect(text).toContain("partial");
    expect(text).not.toContain('"finish_reason":"stop"');
    expect(text).not.toContain("message_stop");
    expect(text).not.toContain("message_delta");
  };

  it.each([["OpenAI", openai], ["Anthropic", anthropic]])("surfaces a mid-stream data error frame to %s with its message", async (name, call) => {
    reply = () => sse(MID_STREAM_ERROR_FRAME);
    const response = await call("antigravity/gemini-3.7-flash-high", true);
    const text = await response.text();
    notSuccessful(text);
    const last = dataFrames(text).at(-1);
    if (name === "Anthropic") expect(last.type).toBe("error");
    expect(last.error).toMatchObject({ message: "synthetic permission denied", code: "403" });
  }, 60000);

  // CPA trailing JSON preserves the backend error across both real client routes.
  it.each(["antigravity", "agy"].flatMap((provider) => [true, false].flatMap((stream) =>
    [["OpenAI", openai], ["Anthropic", anthropic]].flatMap(([name, call]) => [false, true].map((split) => [provider, stream, name, call, split])))))(
    "%s stream=%s preserves the trailing backend error for %s", async (provider, stream, _name, call, split) => {
      reply = () => split ? new Response(new ReadableStream({ start(controller) {
        for (const byte of new TextEncoder().encode(TRAILING_BACKEND_ERROR)) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      } }), { headers: { "content-type": "text/event-stream" } }) : sse(TRAILING_BACKEND_ERROR);
      const response = await call(`${provider}/gemini-3.7-flash-high`, stream);
      const text = await response.text();
      if (stream) {
        notSuccessful(text);
        expect(dataFrames(text).at(-1).error).toMatchObject({ message: "backend capacity exhausted", code: "503" });
      } else {
        expect(response.status).toBe(503);
        expect(JSON.parse(text).error.message).toContain("backend capacity exhausted");
      }
      expect(text).not.toContain("incomplete_upstream_stream");
      expect(sent).toHaveLength(1);
      expect(sent[0].account).toBe(provider === "agy" ? "B" : "A");
      expect(sent[0].body.project).toBe(provider === "agy" ? "project-b" : "project-a");
    }, 60000);

});

describe("trailing error credential redaction", () => {
  it.each([true, false])("redacts selected credentials stream=%s", async (stream) => {
    reply = () => sse(TRAILING_BACKEND_ERROR.replace("backend capacity exhausted", `backend capacity exhausted ${TOKEN_B}`));
    const response = await openai("agy/gemini-3.7-flash-high", stream);
    const text = await response.text();
    expect(text).toContain("backend capacity exhausted");
    expect(text).not.toContain(TOKEN_B);
    expect(sent).toHaveLength(1);
  }, 60000);
});

describe("CLIProxyAPI HTTP 200 in-band JSON error status", () => {
  // antigravityInBandErrorStatusCode: error.code when 400..599, otherwise 502.
  it.each([
    [403, 403],
    [400, 400],
    [0, 502],
  ])("maps a JSON body error code %i to status %i for OpenAI and Anthropic on the agy account", async (code, status) => {
    reply = () => Response.json({ error: { code, message: "synthetic in-band failure" } });
    for (const call of [openai, anthropic]) {
      const response = await call("agy/gemini-3.7-flash-high", false);
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.error).toBeTruthy();
      expect(body.choices).toBeUndefined();
      expect(body.content).toBeUndefined();
    }
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every(({ account, body }) => account === "B" && body.project === "project-b")).toBe(true);
  }, 60000);
});
