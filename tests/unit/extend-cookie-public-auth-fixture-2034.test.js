import { afterEach, expect, it, vi } from "vitest";
import { cookiePublicFlow2034 } from "./helpers/cookiePublicFlow2034.js";

const provider = "tencent-aistudio-web";
const model = `${provider}/hy3-g`;
const origin = "https://aistudio.tencent.ai";
let flow;
afterEach(async () => { await flow?.close(); flow = undefined; });

async function setup() {
  flow = await cookiePublicFlow2034(provider);
  const rows = [];
  for (const label of ["a", "b"]) {
    const row = await flow.imported({ action: "create", name: label }, { origin, cookies: [{ name: "sessionid", value: `synthetic-${label}` }] });
    const dispatcher = await flow.bind(row.id, label);
    const key = await flow.db.createApiKey(label, "synthetic-machine", [], null, null, { providerConnectionIds: [row.id] });
    rows.push({ row, key, dispatcher });
  }
  await flow.db.updateSettings({ requireApiKey: true });
  flow.network.mockImplementation(() => Response.json({ id: "fixture", object: "chat.completion", model: "hy3-g", choices: [{ index: 0, message: { role: "assistant", content: "fixture answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
  return rows;
}

it.each([false, true])("enforces stored connection scopes on the public route anthropic=%s", async (anthropic) => {
  const [a, b] = await setup();
  for (const entry of [a, b]) {
    const response = await flow.dispatch({ model, anthropic, id: entry.row.id, headers: { authorization: `Bearer ${entry.key.key}` }, body: { messages: [{ role: "user", content: `question-${entry.row.name}` }] } });
    expect(response.status, await response.text()).toBe(200);
    const [, init] = flow.network.mock.calls.at(-1);
    expect(init.dispatcher).toBe(entry.dispatcher);
    expect(init.headers.cookie).toBe(`sessionid=synthetic-${entry.row.name}`);
    expect(JSON.parse(init.body).messages[0].content).toBe(`question-${entry.row.name}`);
  }
  flow.network.mockClear();
  for (const headers of [{ authorization: `Bearer ${b.key.key}` }, { authorization: "Bearer synthetic-invalid" }, {}]) {
    const response = await flow.dispatch({ model, anthropic, id: a.row.id, headers });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(flow.network).not.toHaveBeenCalled();
  }
});

it("passes body overrides through the parser without carrying headers or body to the next call", async () => {
  const [a] = await setup();
  const headers = { authorization: `Bearer ${a.key.key}` };
  const forged = { billingEpoch: "forged-epoch", apiKeyId: "forged-owner", retryCount: 999, messages: [{ role: "user", content: "override" }] };
  const response = await flow.dispatch({ model, id: a.row.id, headers, body: forged });
  expect(response.status, await response.text()).toBe(200);
  expect(JSON.parse(flow.network.mock.calls[0][1].body).messages[0].content).toBe("override");
  expect(flow.usage).toHaveBeenCalled();
  expect(flow.usage.mock.calls[0][0]).toMatchObject({ apiKeyId: a.key.id });
  expect(flow.usage.mock.calls[0][0].billingEpoch).not.toBe("forged-epoch");
  expect(flow.network).toHaveBeenCalledTimes(1);
  flow.network.mockClear();
  expect((await flow.dispatch({ model, id: a.row.id })).status).toBeGreaterThanOrEqual(400);
  expect(flow.network).not.toHaveBeenCalled();
  const next = await flow.dispatch({ model, id: a.row.id, headers });
  expect(next.status, await next.text()).toBe(200);
  expect(JSON.parse(flow.network.mock.calls[0][1].body).messages[0].content).toBe("synthetic question");
});

it("does not let a forged retry count suppress an authorized account fallback", async () => {
  const [a, b] = await setup();
  await flow.db.updateProviderConnection(a.row.id, { priority: 1 });
  await flow.db.updateProviderConnection(b.row.id, { priority: 2 });
  const key = await flow.db.createApiKey("both", "synthetic-machine", [], null, null, { providerConnectionIds: [a.row.id, b.row.id] });
  const success = flow.network.getMockImplementation();
  flow.network.mockResolvedValueOnce(Response.json({ error: "expired" }, { status: 401 })).mockImplementation(success);
  const response = await flow.dispatch({ model, headers: { authorization: `Bearer ${key.key}` }, body: { retryCount: 999, billingEpoch: "forged-epoch", apiKeyId: "forged-owner" } });
  expect(response.status, await response.text()).toBe(200);
  expect(flow.network.mock.calls.map(([, init]) => init.dispatcher)).toEqual([a.dispatcher, b.dispatcher]);
  expect(flow.usage.mock.calls.at(-1)[0]).toMatchObject({ apiKeyId: key.id });
  expect(flow.usage.mock.calls.at(-1)[0].billingEpoch).not.toBe("forged-epoch");
});

it("passes cancellation to the public request without replay", async () => {
  const [a] = await setup();
  const controller = new AbortController();
  flow.network.mockImplementation(async (_url, init) => { controller.abort(); throw init.signal.reason; });
  const response = await flow.dispatch({ model, id: a.row.id, headers: { authorization: `Bearer ${a.key.key}` }, signal: controller.signal });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(flow.network).toHaveBeenCalledTimes(1);
});

// Fixture state is process-global, so instances are exercised consecutively with cleanup.
it("closes one fixture before creating an isolated second fixture", async () => {
  const [first] = await setup();
  const firstKey = first.key.key;
  await flow.close();
  flow = undefined;
  const [second] = await setup();
  expect((await flow.dispatch({ model, id: second.row.id, headers: { authorization: `Bearer ${firstKey}` } })).status).toBeGreaterThanOrEqual(400);
  expect(flow.network).not.toHaveBeenCalled();
  const response = await flow.dispatch({ model, id: second.row.id, headers: { authorization: `Bearer ${second.key.key}` } });
  expect(response.status, await response.text()).toBe(200);
});
