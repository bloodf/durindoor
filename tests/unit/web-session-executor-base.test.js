/**
 * #2311: WebSessionExecutor owns the web-session transport. Offline: every
 * outbound send is a mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn(), settle: vi.fn(async () => {}), transfer: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: mocks.proxyAwareFetch }));
vi.mock("../../open-sse/services/providerAttemptContext.js", async (importOriginal) => ({
  ...(await importOriginal()),
  settleProviderAttemptDispatch: mocks.settle,
  transferProviderAttemptDispatch: mocks.transfer,
}));

import { WebSessionExecutor } from "../../open-sse/executors/web-session-executor.js";
import { BlackboxWebExecutor } from "../../open-sse/executors/blackbox-web.js";
import { ConolWebExecutor } from "../../open-sse/executors/conol-web.js";
import { DoubaoWebExecutor } from "../../open-sse/executors/doubao-web.js";
import { NotrackWebExecutor } from "../../open-sse/executors/notrack-web.js";
import { TencentAIStudioWebExecutor } from "../../open-sse/executors/tencent-aistudio-web.js";

const URL = "https://session.invalid/chat";
// strictProxy forbids a direct retry, should a send ever escape the mocks.
const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080", strictProxy: true };
const messages = [{ role: "user", content: "hi" }];

class ProbeExecutor extends WebSessionExecutor {
  constructor(run) { super("probe-web", { id: "probe-web", baseUrl: URL }, { observePatchedFetch: false }); this.run = run; }
  runSession(input, transport) { return this.run(input, transport, this); }
}

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  // Importing proxyFetch patches the global fetch, which some executors send through. Replace it
  // so that every send reaches the mocked proxyAwareFetch and nothing can reach the network.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network is closed in this test"); }));
  mocks.proxyAwareFetch.mockImplementation(async () => new Response("ok"));
});

describe("WebSessionExecutor", () => {
  it("sends setup and billable requests through the connection proxy with a manual redirect and the caller's signal", async () => {
    const controller = new AbortController();
    const executor = new ProbeExecutor(async (_input, { send, sendBillable }) => {
      await send(`${URL}/setup`);
      return { response: await sendBillable(URL, { method: "POST" }) };
    });
    await executor.execute({ proxyOptions, signal: controller.signal });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    for (const [, init, proxy] of mocks.proxyAwareFetch.mock.calls) {
      expect(proxy).toBe(proxyOptions);
      expect(init.redirect).toBe("manual");
    }
    controller.abort();
    for (const [, init] of mocks.proxyAwareFetch.mock.calls) expect(init.signal.aborted).toBe(true);
  });

  it("sends nothing for an already aborted request", async () => {
    const run = vi.fn();
    await expect(new ProbeExecutor(run).execute({ signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(run).not.toHaveBeenCalled();
  });

  it("moves the billable ticket onto the returned response", async () => {
    const upstream = new Response("upstream");
    mocks.proxyAwareFetch.mockResolvedValue(upstream);
    const reply = new Response("reply");
    const result = await new ProbeExecutor(async (_input, { sendBillable }) => {
      await sendBillable(URL);
      return { response: reply };
    }).execute({});
    expect(mocks.transfer).toHaveBeenCalledWith(upstream, reply);
    expect(result.attemptStartedAt).toBeGreaterThan(0);
  });

  it("settles the billable ticket when the session throws after the send", async () => {
    const upstream = new Response("upstream");
    mocks.proxyAwareFetch.mockResolvedValue(upstream);
    await expect(new ProbeExecutor(async (_input, { sendBillable }) => {
      await sendBillable(URL);
      throw new Error("body read failed");
    }).execute({})).rejects.toThrow("body read failed");
    expect(mocks.settle).toHaveBeenCalledWith(upstream, { reason: "transport_error" });
  });

  it("settles the Blackbox ticket when the chat body cannot be read", async () => {
    const chat = new Response(new ReadableStream({ pull(c) { c.error(new Error("socket closed")); } }));
    mocks.proxyAwareFetch.mockImplementation(async (url) => String(url).endsWith("/api/chat") ? chat : Response.json({}));
    await expect(new BlackboxWebExecutor().execute({ model: "gpt-4", body: { messages }, credentials: { apiKey: "token" }, proxyOptions }))
      .rejects.toThrow("socket closed");
    expect(mocks.settle).toHaveBeenCalledWith(chat, { reason: "transport_error" });
  });

  it("redacts credentials in error replies", async () => {
    mocks.proxyAwareFetch.mockRejectedValue(new Error("refused for Bearer synthetic-secret-value"));
    const result = await new NotrackWebExecutor().execute({ body: { messages }, credentials: { apiKey: "session=1" }, proxyOptions });
    expect(result.response.status).toBe(502);
    const body = await result.response.json();
    expect(body.error).toMatchObject({ type: "upstream_error", code: "HTTP_502" });
    expect(body.error.message).toContain("Notrack connection failed");
    expect(body.error.message).not.toContain("synthetic-secret-value");
  });

  it.each([
    [BlackboxWebExecutor, "next-auth.session-token"],
    [ConolWebExecutor, "__Secure-better-auth.session_token"],
  ])("%o drops a pasted Cookie: prefix and names a bare token", async (Executor, name) => {
    mocks.proxyAwareFetch.mockImplementation(async () => new Response("", { status: 401 }));
    for (const [apiKey, sent] of [["Cookie: a=1; b=2", "a=1; b=2"], ["  bare-token ", `${name}=bare-token`]]) {
      mocks.proxyAwareFetch.mockClear();
      await new Executor().execute({ model: "m", body: { messages }, credentials: { apiKey }, proxyOptions });
      expect(mocks.proxyAwareFetch.mock.calls[0][1].headers.Cookie).toBe(sent);
    }
  });

  it.each([BlackboxWebExecutor, ConolWebExecutor, DoubaoWebExecutor, NotrackWebExecutor, TencentAIStudioWebExecutor])(
    "%o leaves execute() to the base",
    (Executor) => {
      expect(Executor.prototype).toBeInstanceOf(WebSessionExecutor);
      expect(Object.hasOwn(Executor.prototype, "execute")).toBe(false);
    },
  );
});
