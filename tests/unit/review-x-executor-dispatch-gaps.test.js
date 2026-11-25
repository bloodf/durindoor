// #2308 follow-up: sends the "calls the shared sender somewhere" contract could not see.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import {
  runWithProviderAttemptContext,
  settleProviderAttemptDispatch
} from "../../open-sse/services/providerAttemptContext.js";
import { QuotaDispatchUnavailableError } from "../../open-sse/services/quota/dispatch.js";
import { PoeExecutor } from "../../open-sse/executors/poe.js";
import { PromptQlExecutor } from "../../open-sse/executors/promptql.js";
import { LmarenaExecutor } from "../../open-sse/executors/lmarena.js";
import {
  CloudflarePlaygroundExecutor,
  PlaywrightCloudflareTransport
} from "../../open-sse/executors/cloudflare-playground.js";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { GigaChatExecutor } from "../../open-sse/executors/gigachat.js";
import { AuggieExecutor } from "../../open-sse/executors/auggie.js";
import { DevinCliExecutor } from "../../open-sse/executors/devin-cli.js";
import { ZcodeExecutor } from "../../open-sse/executors/zcode.js";
import { __setTlsFetchOverrideForTesting as setLmarenaTls, tlsFetchLMArena } from "../../open-sse/services/lmarenaTlsClient.js";

const PROXY = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.test:8080" };
const DIRECT = { disableEnvProxy: true };
const messages = [{ role: "user", content: "hi" }];

let network;
let restoreFetch;
beforeEach(() => {
  network = vi.fn(async () => { throw new Error("unexpected network send"); });
  restoreFetch = __setOriginalFetchForTesting(network);
});
afterEach(() => {
  restoreFetch();
  setLmarenaTls(null);
});

const ticket = () => ({ tracked: true, settle: vi.fn().mockResolvedValue({ changed: true }), release: vi.fn() });
const tracked = (run, beginQuotaDispatch) =>
  runWithProviderAttemptContext(() => 1, run, { beginQuotaDispatch });

describe("Poe Messages branch", () => {
  const input = {
    model: "claude-opus-4.8",
    body: { messages },
    stream: false,
    credentials: { apiKey: "synthetic-key" },
    proxyOptions: DIRECT
  };

  it.each([200, 429])("charges the send once and carries its ticket on a %i", async (status) => {
    network.mockImplementation(async () => Response.json({}, { status }));
    const dispatch = ticket();
    const begin = vi.fn().mockResolvedValue(dispatch);

    const result = await tracked(() => new PoeExecutor().execute(input), begin);

    expect(begin).toHaveBeenCalledOnce();
    expect(result.attemptStartedAt).toBe(1);
    await settleProviderAttemptDispatch(result.response, { success: status === 200 });
    expect(dispatch.settle).toHaveBeenCalledOnce();
  });

  it("refuses redirects outside a quota context too", async () => {
    network.mockImplementation(async () => Response.json({}));
    await new PoeExecutor().execute(input);
    expect(network.mock.calls[0][1].redirect).toBe("error");
  });

  it("propagates a caller abort and a refused quota reservation instead of a 502", async () => {
    await expect(new PoeExecutor().execute({ ...input, signal: AbortSignal.abort() }))
      .rejects.toMatchObject({ name: "AbortError" });
    const error = new QuotaDispatchUnavailableError("reservation_error");
    await expect(tracked(() => new PoeExecutor().execute(input), vi.fn().mockRejectedValue(error)))
      .rejects.toBe(error);
    expect(network).not.toHaveBeenCalled();
  });
});

describe("PromptQL thread dispatch", () => {
  const token = `h.${Buffer.from(JSON.stringify({ aud: "promptql.hasura.io", projectId: "p" })).toString("base64url")}.s`;
  const input = (extra) => ({
    model: "",
    body: { messages },
    stream: false,
    credentials: { apiKey: token, providerSpecificData: { projectId: "p" } },
    proxyOptions: DIRECT,
    ...extra
  });
  const answer = { thread_events: [{ thread_event_id: 1, event_data: { type: "AgentMessage", content: "pong", final_response_sent: true } }] };

  function playground(overrides = {}) {
    const sends = [];
    const replies = {
      FetchLlmConfigs: () => Response.json({ data: { llm_config: [{ id: "cfg", model_id: "wanted" }] } }),
      StartThreadWithModel: () => Response.json({ data: { start_thread: { thread_id: "t" } } }),
      StartThreadRoomless: () => Response.json({ data: { start_thread: { thread_id: "t" } } }),
      SendThreadMessage: () => Response.json({ data: { send_thread_message: { thread_event_id: 0 } } }),
      QueryThreadEvents: () => Response.json({ data: answer }),
      ...overrides
    };
    const fetch = async (_url, init) => {
      const { operationName } = JSON.parse(init.body);
      sends.push({ operationName, redirect: init.redirect });
      return replies[operationName]();
    };
    return { sends, executor: new PromptQlExecutor({ fetch }) };
  }

  it.each([
    ["a new thread", {}, "StartThreadRoomless"],
    ["a follow-up", { body: { messages, promptql_thread_id: "t" } }, "SendThreadMessage"]
  ])("charges only the message send of %s", async (_name, extra, mutation) => {
    const { sends, executor } = playground();
    const dispatch = ticket();
    const begin = vi.fn().mockResolvedValue(dispatch);

    const result = await tracked(() => executor.execute(input(extra)), begin);

    expect(result.response.status).toBe(200);
    expect(begin).toHaveBeenCalledOnce();
    expect(sends).toEqual([
      { operationName: mutation, redirect: "error" },
      { operationName: "QueryThreadEvents", redirect: "manual" }
    ]);
    await settleProviderAttemptDispatch(result.response, { success: true });
    expect(dispatch.settle).toHaveBeenCalledWith({ success: true, reason: "success" });
  });

  it("settles a rejected model start before charging the default start", async () => {
    const { executor } = playground({ StartThreadWithModel: () => Response.json({ errors: [{ message: "bad model" }] }, { status: 400 }) });
    const first = ticket();
    const second = ticket();
    const begin = vi.fn().mockResolvedValueOnce(first).mockImplementationOnce(async () => {
      expect(first.settle).toHaveBeenCalledWith({ success: false, reason: "fallback" });
      return second;
    });

    const result = await tracked(() => executor.execute(input({ model: "wanted" })), begin);

    expect(begin).toHaveBeenCalledTimes(2);
    await settleProviderAttemptDispatch(result.response, { success: true });
    expect(second.settle).toHaveBeenCalledOnce();
  });

  it("reports a refused redirect on the message send as an expired session", async () => {
    const { executor } = playground({ StartThreadRoomless: () => { throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") }); } });
    const result = await tracked(() => executor.execute(input()), vi.fn().mockResolvedValue(ticket()));
    expect(result.response.status).toBe(401);
  });

  it("propagates a refused quota reservation without sending", async () => {
    const { sends, executor } = playground();
    const error = new QuotaDispatchUnavailableError("reservation_error");

    await expect(tracked(() => executor.execute(input({ model: "wanted" })), vi.fn().mockRejectedValue(error))).rejects.toBe(error);
    expect(sends.map((send) => send.operationName)).toEqual(["FetchLlmConfigs"]);
  });
});

describe("connection proxy outside fetch", () => {
  it.each([false, true])("routes the LMArena TLS send through it (stream=%s)", async (stream) => {
    const tls = vi.fn(async () => ({ status: 200, text: "data: {\"text\":\"hi\"}\n\n", body: null }));
    setLmarenaTls(tls);
    await new LmarenaExecutor().execute({ model: "m", body: { messages }, stream, credentials: { cookie: "a=b" }, proxyOptions: PROXY });
    expect(tls.mock.calls[0][1].proxyUrl).toBe(PROXY.connectionProxyUrl);
  });

  it("fails an LMArena send closed when a strict proxy has no route", async () => {
    const tls = vi.fn();
    setLmarenaTls(tls);
    await expect(new LmarenaExecutor().execute({ model: "m", body: { messages }, stream: true, credentials: { cookie: "a=b" }, proxyOptions: { strictProxy: true, disableEnvProxy: true } }))
      .rejects.toThrow(/strictProxy/);
    expect(tls).not.toHaveBeenCalled();
  });

  it("hands the connection route to the Cloudflare Playground transport", async () => {
    const start = vi.fn(async () => ({ ok: false, status: 502, message: "stop" }));
    await new CloudflarePlaygroundExecutor(() => ({ start, close: async () => {} }))
      .execute({ model: "m", body: { messages }, stream: false, credentials: {}, proxyOptions: PROXY });
    expect(start.mock.calls[0][0].proxyOptions).toBe(PROXY);
  });

  function fakeChromium() {
    const page = { goto: async () => {}, exposeFunction: async () => {}, evaluate: async () => {} };
    const newContext = vi.fn(async () => ({ newPage: async () => page }));
    const launch = vi.fn(async () => ({ newContext, close: async () => {} }));
    return { chromium: { launch }, launch, newContext };
  }

  it("gives the Cloudflare Playground browser context the connection proxy", async () => {
    const { chromium, newContext } = fakeChromium();
    const transport = new PlaywrightCloudflareTransport("c", { chromium });
    await expect(transport.start({ model: "m", messages, proxyOptions: PROXY })).resolves.toEqual({ ok: true });
    expect(newContext.mock.calls[0][0].proxy).toEqual({ server: "http://proxy.test:8080" });
    await transport.close();
  });

  it("opens no Cloudflare Playground browser when a strict proxy has no route", async () => {
    const { chromium, launch } = fakeChromium();
    const transport = new PlaywrightCloudflareTransport("c", { chromium });
    await expect(transport.start({ model: "m", messages, proxyOptions: { strictProxy: true, disableEnvProxy: true } }))
      .resolves.toMatchObject({ ok: false, status: 502 });
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("subprocess executors cannot honour a connection route", () => {
  // zcode takes its spawner by injection; the other two must refuse before spawning.
  const spawn = vi.fn(() => { throw new Error("spawned"); });
  const executors = [
    ["auggie", () => new AuggieExecutor(), {}],
    ["devin-cli", () => new DevinCliExecutor(), { apiKey: "synthetic-key" }],
    ["zcode", () => new ZcodeExecutor({ spawnProcess: spawn }), { providerSpecificData: { enableSessionDispatch: true } }]
  ];

  const routes = [
    ["a connection proxy", PROXY],
    ["a strict proxy", { strictProxy: true }],
    ["a bound pool", { proxyPoolId: "pool" }],
    ["a relay", { vercelRelayUrl: "https://relay.test" }]
  ];

  it.each(executors.flatMap(([name, create, credentials]) =>
    routes.map(([route, proxyOptions]) => [name, route, proxyOptions, create, credentials])
  ))("%s refuses %s without dispatching", async (_name, _route, proxyOptions, create, credentials) => {
    const begin = vi.fn();
    const result = await tracked(() => create().execute({ model: "claude-sonnet-4.5", body: { messages }, stream: false, credentials, proxyOptions }), begin);
    expect(result.response.status).toBe(400);
    expect((await result.response.json()).error.message).toMatch(/proxy or relay/);
    expect(begin).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("redirect guard on credentialed override sends", () => {
  const redirect = () => ({ status: 302, headers: new Headers({ location: "https://elsewhere.test/" }), text: "", body: null });

  it.each(["Cookie", "Authorization"])("keeps a TLS-client send with %s on its origin by default", async (header) => {
    const tls = vi.fn(async () => redirect());
    setLmarenaTls(tls);
    const result = await tlsFetchLMArena("https://arena.ai/x", { headers: { [header]: "synthetic" } });
    expect(result.status).toBe(401);
    expect(tls).toHaveBeenCalledOnce();
    expect(tls.mock.calls[0][1]).toMatchObject({ sameOriginRedirects: true, redirect: "manual" });
  });

  it.each([
    ["without a credential", { headers: {} }],
    ["that opted out", { headers: { Cookie: "synthetic" }, sameOriginRedirects: false }]
  ])("leaves a TLS-client send %s to follow redirects", async (_name, options) => {
    const tls = vi.fn(async () => redirect());
    setLmarenaTls(tls);
    expect((await tlsFetchLMArena("https://arena.ai/x", options)).status).toBe(302);
    expect(tls.mock.calls[0][1].sameOriginRedirects).toBe(options.sameOriginRedirects);
  });

  const credentials = { accessToken: "synthetic-token", copilotToken: "synthetic-token", providerSpecificData: {} };
  const redirectsSent = () => network.mock.calls.map(([, init]) => init.redirect);

  it("covers GitHub's token preflight, Messages and Responses sends", async () => {
    network.mockImplementation(async () => Response.json({ input_tokens: 1 }));
    const github = new GithubExecutor();
    github.config = { ...github.config, countTokensPreflightRatio: 0 };
    const input = { model: "claude-sonnet-4.5", body: { messages }, stream: false, credentials, proxyOptions: DIRECT };

    await github.executeWithMessagesEndpoint(input);
    await github.executeWithResponsesEndpoint({ ...input, model: "gpt-5-codex" });

    expect(redirectsSent()).toEqual(["error", "error", "error"]);
  });

  it("covers Kiro's CreateResponse send", async () => {
    network.mockImplementation(async () => Response.json({}, { status: 400 }));
    await new KiroExecutor().executeCreateResponse({ model: "m", body: { input: "hi" }, credentials, proxyOptions: DIRECT });
    expect(redirectsSent()).toEqual(["error"]);
  });

  it("covers GigaChat's API key exchange", async () => {
    network.mockImplementation(async () => Response.json({ access_token: "synthetic-token" }));
    await new GigaChatExecutor().exchangeApiKeyForAccessToken("synthetic-key", DIRECT);
    expect(redirectsSent()).toEqual(["error"]);
  });
});
