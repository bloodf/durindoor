import { beforeEach, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));

import { GithubExecutor } from "../../open-sse/executors/github.js";
import { GheCopilotExecutor } from "../../open-sse/executors/ghe-copilot.js";
import { buildCopilotEndpointContract } from "../../open-sse/services/copilotEndpointContract.js";

const model = "gpt-test-account";
const body = { model, messages: [{ role: "user", content: "Hello" }] };
const contract = (endpoint) => buildCopilotEndpointContract([{ id: model, supported_endpoints: [endpoint] }]);
const account = (id, endpoint, host) => ({
  connectionId: id,
  accessToken: "fixture",
  providerSpecificData: {
    ...(endpoint ? { copilotEndpointContract: contract(endpoint) } : {}),
    ...(host ? { copilotApiUrl: `https://${host}` } : {}),
  },
});
const dispatch = (executor, credentials) => executor.execute({ model, body, stream: true, credentials });
const calls = () => fetchMock.mock.calls.map(([url, options]) => ({
  host: new URL(url).host,
  path: new URL(url).pathname,
  body: JSON.parse(options.body),
}));

beforeEach(() => fetchMock.mockReset());

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

it("does not share learned routes between enterprise hosts or anonymous calls", async () => {
  fetchMock.mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  const executor = new GheCopilotExecutor();
  await dispatch(executor, account("a", null, "one.example"));
  await dispatch(executor, account("a", null, "two.example"));
  expect(calls().map(({ host, path }) => [host, path])).toEqual([
    ["one.example", "/chat/completions"], ["one.example", "/responses"], ["two.example", "/chat/completions"],
  ]);
  fetchMock.mockReset().mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
    .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  const github = new GithubExecutor();
  await dispatch(github, { accessToken: "fixture" });
  await dispatch(github, { accessToken: "fixture" });
  expect(calls().map(({ path }) => path)).toEqual(["/chat/completions", "/responses", "/chat/completions"]);
});
