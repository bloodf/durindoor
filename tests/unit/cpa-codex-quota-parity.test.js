// #2034: real routing and SQLite, synthetic credentials and upstream bytes only.
import "../translator/registerAll.js";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-codex-machine-id" }));
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({ ...(await importOriginal()), appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn(() => "synthetic-session"), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), saveRequestDetail: vi.fn(() => Promise.resolve()), saveRequestUsage: vi.fn(() => Promise.resolve()) }));
const wire = vi.hoisted(() => ({ send: null }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (url, init) => wire.send(url, init),
}));

const MODEL = "gpt-5.4";
const TOKEN_A = "synthetic-codex-key-a";
const TOKEN_B = "synthetic-codex-oauth-b";
const frame = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const sse = (text) => new Response(text, { headers: { "content-type": "text/event-stream" } });
const completed = frame("response.output_text.delta", { delta: "sibling answer" }) + frame("response.completed", { response: { id: "resp_b", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "sibling answer" }] }], usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } });
let root, db, handleChat, usage;
let sent = [];
let replies = {};
let dialled = [];

async function upstream(url, init = {}) {
  const auth = new Headers(init.headers).get("authorization");
  const account = auth === `Bearer ${TOKEN_A}` ? "A" : auth === `Bearer ${TOKEN_B}` ? "B" : "unknown";
  sent.push({ account, url: String(url), body: JSON.parse(init.body) });
  return account === "A" ? replies.A() : sse(completed);
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cpa-quota-2034-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  vi.clearAllMocks();
  sent = [];
  dialled = [];
  wire.send = upstream;
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function refuse(...args) {
    dialled.push(JSON.stringify(args[0]?.host ?? args[0]?.[0]?.host ?? args[1] ?? "unknown"));
    process.nextTick(() => this.destroy(new Error("offline test: outbound connection refused")));
    return this;
  });
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  db = await import("../../src/lib/db/repos/connectionsRepo.js");
  usage = await import("@/lib/usageDb.js");
  const settings = await import("../../src/lib/db/repos/settingsRepo.js");
  await settings.updateSettings({ requireApiKey: false });
  vi.stubGlobal("fetch", vi.fn(upstream));
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


import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";
import { MODEL_LOCK_ALL } from "../../open-sse/services/accountFallback.js";
import { codexBillingQuotaCode } from "../../open-sse/shared/codexQuotaWindow.js";

async function accounts() {
  const a = await db.createProviderConnection({ provider: "codex", authType: "apikey", name: "a", apiKey: TOKEN_A, priority: 1, isActive: true });
  const b = await db.createProviderConnection({ provider: "codex", authType: "oauth", name: "b", accessToken: TOKEN_B, priority: 2, expiresAt: new Date(Date.now() + 3600000).toISOString(), isActive: true });
  return { a, b };
}
async function call(route, stream = true, signal) {
  const body = { model: `codex/${MODEL}`, stream, messages: [{ role: "user", content: "ping" }] };
  if (route === "messages") body.max_tokens = 64;
  if (route === "responses") { body.input = "ping"; delete body.messages; }
  const response = await handleChat(new Request(`http://localhost/v1/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }));
  return { response, text: await response.text() };
}

for (const code of ["insufficient_quota", "credit_balance_exhausted"]) {
  describe(code, () => {
    it.each(["error", "body", "response", "root"])("recognizes structured %s envelopes without trusting message text", (shape) => {
      const error = { code: ` ${code.toUpperCase()} ` };
      const payload = shape === "root" ? error : shape === "error" ? { error } : { [shape]: { error } };
      expect(codexBillingQuotaCode(payload)).toBe(code);
      expect(codexBillingQuotaCode({ error: { message: code } })).toBeNull();
    });
    it("preserves a safe billing identity through HTTP error parsing", async () => {
      const parsed = await parseUpstreamError(Response.json({ error: { code, message: TOKEN_A } }, { status: 400 }), new CodexExecutor());
      expect(parsed.statusCode).toBe(429);
      expect(parsed.errorBody.error.code).toBe(code);
      expect(JSON.stringify(parsed)).not.toContain(TOKEN_A);
    });
    for (const route of ["chat/completions", "messages", "responses"]) {
      it.each([["http", true], ["sse", true], ["http", false], ["sse", false]])(`${route} %s stream=%s selects OAuth after zero-output API-key exhaustion`, async (transport, stream) => {
        const { a, b } = await accounts();
        replies.A = () => transport === "http" ? Response.json({ error: { code } }, { status: 400 }) : sse(frame("response.created") + frame("response.failed", { response: { error: { code } } }));
        const { text } = await call(route, stream);
        expect(sent.map(x => x.account)).toEqual(["A", "B"]);
        expect(text).toContain("sibling answer");
        expect(sent[1].body.model).toBe(MODEL);
        expect(sent[1].body.input).toBeDefined();
        const failed = await db.getProviderConnectionById(a.id);
        expect(new Date(failed[MODEL_LOCK_ALL]).getTime()).toBeGreaterThan(Date.now());
        const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
        const siblingModel = await getProviderCredentials("codex", null, "gpt-5.5", { quotaSnapshotsLoader: async () => [] });
        expect(siblingModel.connectionId).toBe(b.id);
        await new Promise(resolve => setImmediate(resolve));
        expect(usage.saveRequestUsage).toHaveBeenCalledTimes(1);
        expect(usage.saveRequestUsage.mock.calls[0][0].connectionId).toBe(b.id);
      });
      it.each(["response.output_text.delta", "response.function_call_arguments.delta", "response.reasoning_summary_text.delta"].flatMap(type => [[type, true], [type, false]]))(`${route} never replays after %s in the same chunk, stream=%s`, async (type, stream) => {
        await accounts();
        replies.A = () => sse(frame(type, { delta: "first" }) + frame("response.failed", { response: { error: { code, message: "quota exhausted" } } }));
        const { text } = await call(route, stream);
        expect(sent.map(x => x.account)).toEqual(["A"]);
        expect(text).not.toContain("sibling answer");
        expect(text).toMatch(/error|failed/);
        expect(text).not.toContain('"finish_reason":"stop"');
        expect(usage.saveRequestUsage).not.toHaveBeenCalled();
      });
    }
  });
}

it("rejects malformed and text-only quota data without rotating", async () => {
  const raw = 'event: error\ndata: insufficient_quota\n\n';
  const peek = await new CodexExecutor()._peekSseTransientError(sse(raw));
  expect(peek.matched).toBeNull();
  expect(await new Response(peek.replacementBody).text()).toBe(raw);
});
it("cancels a pending bootstrap and releases the source reader", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }));
  const controller = new AbortController();
  const pending = new CodexExecutor()._peekSseTransientError(response, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalled();
  expect(response.body.locked).toBe(false);
});

it("does not bootstrap across unknown hosted tool traffic", async () => {
  const raw = frame("response.shell_call_output_content.delta", { delta: "executed" }) + frame("response.failed", { response: { error: { code: "insufficient_quota" } } });
  const peek = await new CodexExecutor()._peekSseTransientError(sse(raw));
  expect(peek.matched).toBeNull();
  expect(await new Response(peek.replacementBody).text()).toBe(raw);
});

it.each(["chat/completions", "messages", "responses"])("%s cancellation during bootstrap never selects a sibling", async (route) => {
  await accounts();
  const controller = new AbortController();
  const cancelled = vi.fn();
  replies.A = () => {
    queueMicrotask(() => controller.abort());
    return new Response(new ReadableStream({ cancel: cancelled }), { headers: { "content-type": "text/event-stream" } });
  };
  const { response } = await call(route, true, controller.signal);
  expect(response.status).toBe(499);
  expect(sent.map(x => x.account)).toEqual(["A"]);
  expect(cancelled).toHaveBeenCalled();
  expect(usage.saveRequestUsage).not.toHaveBeenCalled();
});
it("holds empty text, tool and thought announcements until quota rejection", async () => {
  const raw = frame("response.output_item.added", { item: { type: "function_call", name: "lookup", arguments: "" } }) +
    frame("response.output_text.delta", { delta: "" }) + frame("response.reasoning_summary_text.delta", { delta: "" }) +
    frame("response.failed", { response: { error: { code: "credit_balance_exhausted" } } });
  expect(await new CodexExecutor()._peekSseTransientError(sse(raw))).toMatchObject({ billingQuota: true, replacementBody: null });
});

it("does not let overload text recovery replay a later billing failure", async () => {
  const raw = frame("response.output_text.delta", { delta: "Our servers are currently overloaded. Please try again later." }) + frame("response.failed", { response: { error: { code: "insufficient_quota" } } });
  const peek = await new CodexExecutor()._peekSseTransientError(sse(raw));
  expect(peek.matched).toBeNull();
  expect(await new Response(peek.replacementBody).text()).toBe(raw);
});

it.each(["chat/completions", "messages", "responses"])("%s does not infer credential exhaustion from malformed HTTP data", async (route) => {
  await accounts();
  replies.A = () => new Response('{"error":{"code":', { status: 400, headers: { "content-type": "application/json" } });
  const { response } = await call(route);
  expect(response.status).toBe(400);
  expect(sent.map(x => x.account)).toEqual(["A"]);
  expect(usage.saveRequestUsage).not.toHaveBeenCalled();
});
