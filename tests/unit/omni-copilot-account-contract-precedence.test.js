import { beforeEach, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));

const operatorOverride = vi.hoisted(() => ({ targetFormat: null }));
vi.mock("../../open-sse/config/providerModels.js", async (importOriginal) => ({
  ...await importOriginal(),
  getModelTargetFormat: () => operatorOverride.targetFormat,
}));

import { GithubExecutor } from "../../open-sse/executors/github.js";
import { GheCopilotExecutor } from "../../open-sse/executors/ghe-copilot.js";
import {
  COPILOT_ROUTE_GENERATION_ABSENT,
  buildCopilotEndpointContract,
  computeCopilotRouteGeneration,
} from "../../open-sse/services/copilotEndpointContract.js";
import {
  COPILOT_LEARNED_ROUTE_MAX_ACCOUNTS,
  CopilotLearnedRoutes,
} from "../../open-sse/services/copilotLearnedRoutes.js";

const model = "gpt-test-account";
const body = { model, messages: [{ role: "user", content: "Hello" }] };
const contract = (endpoint) => buildCopilotEndpointContract([{ id: model, supported_endpoints: [endpoint] }]);
/** A contract that states the route of some other model, so it says nothing about `model`. */
const foreignContract = (endpoint, id = "gpt-test-other") =>
  buildCopilotEndpointContract([{ id, supported_endpoints: [endpoint] }]);
/**
 * Enterprise hosts belong to a GHE connection. register-auth-02 (#2034) refuses
 * an operator-stored API URL that has no OAuth issuer, so enterprise fixtures
 * name their issuer (`gheUrl`) and carry a scoped session credential; the
 * long-lived OAuth credential is never the dispatch credential.
 */
const enterprise = (host) => host ? {
  gheUrl: `https://${host}`,
  copilotApiUrl: `https://${host}`,
  copilotToken: `session-${host}`,
  copilotTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
} : {};
const account = (id, endpoint, host) => ({
  connectionId: id,
  accessToken: "fixture",
  providerSpecificData: {
    ...(endpoint ? { copilotEndpointContract: contract(endpoint) } : {}),
    ...enterprise(host),
  },
});
/** An account whose routing metadata is the given contract, if any. */
const accountWith = (id, endpointContract, host) => ({
  connectionId: id,
  accessToken: "fixture",
  providerSpecificData: {
    ...(endpointContract ? { copilotEndpointContract: endpointContract } : {}),
    ...(host ? { copilotApiUrl: `https://${host}` } : {}),
  },
});
const dispatch = (executor, credentials) => executor.execute({ model, body, stream: true, credentials });
const calls = () => fetchMock.mock.calls.map(([url, options]) => ({
  host: new URL(url).host,
  path: new URL(url).pathname,
  body: JSON.parse(options.body),
}));

beforeEach(() => {
  fetchMock.mockReset();
  operatorOverride.targetFormat = null;
});

it.each([GithubExecutor, GheCopilotExecutor])("honors another account's chat contract after escalation (%s)", async (Executor) => {
  fetchMock.mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  const executor = new Executor();
  const host = Executor === GheCopilotExecutor ? "enterprise.example" : undefined;
  await dispatch(executor, account("a", null, host));
  const result = await dispatch(executor, account("b", "/chat/completions", host));
  expect(result.response.status).toBe(200);
  expect(calls().map(({ path }) => path)).toEqual(["/chat/completions", "/responses", "/chat/completions"]);
  expect(calls().map(({ body: sent }) => ["messages" in sent, "input" in sent])).toEqual([[true, false], [false, true], [true, false]]);
});

it("reuses a same-account escalation, isolates other accounts, and honors refreshed metadata", async () => {
  fetchMock.mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  const executor = new GithubExecutor();
  await dispatch(executor, account("a"));
  await dispatch(executor, account("a"));
  await dispatch(executor, account("b"));
  await dispatch(executor, account("a", "/chat/completions"));
  await dispatch(executor, account("b", "/responses"));
  expect(calls().map(({ path }) => path)).toEqual(["/chat/completions", "/responses", "/responses", "/chat/completions", "/chat/completions", "/responses"]);
});

it("refuses an enterprise account with only an operator-stored API URL before any request", async () => {
  const legacy = { connectionId: "a", accessToken: "fixture", providerSpecificData: { copilotApiUrl: "https://one.example" } };
  await expect(dispatch(new GheCopilotExecutor(), legacy)).rejects.toThrow(/reauthentication needed/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not share learned routes between enterprise hosts or anonymous calls", async () => {
  fetchMock.mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  const executor = new GheCopilotExecutor();
  await dispatch(executor, account("a", null, "one.example"));
  await dispatch(executor, account("a", null, "two.example"));
  expect(calls().map(({ host, path }) => [host, path])).toEqual([
    ["one.example", "/chat/completions"], ["one.example", "/responses"], ["two.example", "/chat/completions"],
  ]);
  expect(fetchMock.mock.calls.map(([url, options]) => [new URL(url).host, new Headers(options.headers).get("authorization")])).toEqual([
    ["one.example", "Bearer session-one.example"], ["one.example", "Bearer session-one.example"], ["two.example", "Bearer session-two.example"],
  ]);
  fetchMock.mockReset().mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  const github = new GithubExecutor();
  await dispatch(github, { accessToken: "fixture" });
  await dispatch(github, { accessToken: "fixture" });
  expect(calls().map(({ path }) => path)).toEqual(["/chat/completions", "/responses", "/chat/completions"]);
});

it("expires a learned route when the account's routing metadata is refreshed", async () => {
  // The pre-refresh catalog says nothing about this model, so the route is
  // learned from Copilot's own error. The refreshed catalog states other
  // routes, so the learned one describes a catalog that is gone.
  const before = foreignContract("/chat/completions");
  const after = foreignContract("/responses");
  fetchMock
    .mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    .mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));
  const executor = new GithubExecutor();
  await dispatch(executor, accountWith("a", before));
  await dispatch(executor, accountWith("a", after));
  await dispatch(executor, accountWith("a", after));
  expect(calls().map(({ path }) => path)).toEqual([
    "/chat/completions", "/responses", // before the refresh: probe, escalate, learn
    "/chat/completions", "/responses", // after the refresh: the stale route is gone, probe again
    "/responses", // same generation: the learned route is fast again
  ]);
});

it("keeps a learned route while the routing metadata is unchanged", async () => {
  const metadata = foreignContract("/chat/completions");
  fetchMock.mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  const executor = new GithubExecutor();
  await dispatch(executor, accountWith("a", metadata));
  await dispatch(executor, accountWith("a", metadata));
  expect(calls().map(({ path }) => path)).toEqual(["/chat/completions", "/responses", "/responses"]);
});

it("lets refreshed route metadata win over a learned route", async () => {
  fetchMock.mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  const executor = new GithubExecutor();
  await dispatch(executor, accountWith("a", foreignContract("/chat/completions")));
  await dispatch(executor, accountWith("a", contract("/chat/completions")));
  expect(calls().map(({ path }) => path)).toEqual(["/chat/completions", "/responses", "/chat/completions"]);
});

it("keeps another account's learned route when one account's metadata is refreshed", async () => {
  const metadata = foreignContract("/chat/completions");
  const refreshed = foreignContract("/responses");
  fetchMock.mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  const executor = new GithubExecutor();
  await dispatch(executor, accountWith("b", metadata));
  await dispatch(executor, accountWith("b", metadata));
  await dispatch(executor, accountWith("a", refreshed));
  await dispatch(executor, accountWith("b", metadata));
  expect(calls().map(({ path }) => path)).toEqual([
    "/chat/completions", "/responses", "/responses", "/chat/completions", "/responses",
  ]);
});

it("bounds the learned route state", async () => {
  fetchMock.mockImplementation((url) => Promise.resolve(
    String(url).includes("/chat/completions")
      ? new Response("not accessible via the /chat/completions endpoint", { status: 400 })
      : new Response("{}", { status: 200 }),
  ));
  const executor = new GithubExecutor();
  for (let index = 0; index < COPILOT_LEARNED_ROUTE_MAX_ACCOUNTS + 6; index += 1) {
    await dispatch(executor, accountWith(`account-${index}`, foreignContract("/chat/completions", `model-${index}`)));
  }
  expect(executor.knownCodexModels.size).toBeLessThanOrEqual(COPILOT_LEARNED_ROUTE_MAX_ACCOUNTS);
});

it("expires a learned route when the routing metadata cannot be trusted", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));
  const executor = new GithubExecutor();
  await dispatch(executor, accountWith("a", foreignContract("/chat/completions")));
  await dispatch(executor, accountWith("a", { models: "not-a-model-list" }));
  expect(calls().map(({ path }) => path)).toEqual(["/chat/completions", "/responses", "/chat/completions"]);
});

it("keeps learned routes inside one account and host, and forgets them on a new generation", () => {
  const routes = new CopilotLearnedRoutes({ maxAccounts: 2, maxModels: 2 });
  routes.learn("account-a", "model-1", "generation-1");
  routes.learn("account-a", "model-2", "generation-1");
  routes.learn("account-a", "model-3", "generation-1");
  expect(routes.has("account-a", "model-1", "generation-1")).toBe(false);
  expect(routes.has("account-a", "model-3", "generation-1")).toBe(true);
  expect(routes.has("account-a", "model-3", "generation-2")).toBe(false);
  expect(routes.generationOf("account-a")).toBe(null);
  routes.learn("account-b", "model-1", "generation-1");
  routes.learn("account-c", "model-1", "generation-1");
  expect(routes.size).toBe(2);
});

it("keeps an operator override ahead of a learned route", async () => {
  fetchMock.mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  const executor = new GithubExecutor();
  await dispatch(executor, accountWith("a", foreignContract("/chat/completions")));
  operatorOverride.targetFormat = "openai";
  await dispatch(executor, accountWith("a", foreignContract("/chat/completions")));
  expect(calls().map(({ path }) => path)).toEqual(["/chat/completions", "/responses", "/chat/completions"]);
});

it("derives the routing generation from the discovered contract alone", () => {
  const rows = [
    { id: "gpt-test-other", supported_endpoints: ["/chat/completions"] },
    { id: "gpt-test-third", supported_endpoints: ["/responses"] },
  ];
  const ordered = buildCopilotEndpointContract(rows);
  const reordered = buildCopilotEndpointContract([...rows].reverse());
  const changed = buildCopilotEndpointContract([{ id: "gpt-test-other", supported_endpoints: ["/responses"] }]);

  expect(computeCopilotRouteGeneration(ordered)).toBe(computeCopilotRouteGeneration(reordered));
  expect(computeCopilotRouteGeneration(ordered)).not.toBe(computeCopilotRouteGeneration(changed));
  expect(computeCopilotRouteGeneration(undefined)).toBe(COPILOT_ROUTE_GENERATION_ABSENT);
  expect(computeCopilotRouteGeneration(null)).toBe(COPILOT_ROUTE_GENERATION_ABSENT);
  expect(computeCopilotRouteGeneration({ models: "not-a-model-list" })).toBe(null);
  expect(computeCopilotRouteGeneration({ models: [] })).not.toBe(COPILOT_ROUTE_GENERATION_ABSENT);
});
