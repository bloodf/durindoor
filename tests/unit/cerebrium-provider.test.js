import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { getExecutor } from "../../open-sse/executors/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { cerebriumBaseUrl } from "../../open-sse/config/cerebrium.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

let server, origin;
const requests = [];
beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, authorization: req.headers.authorization, body: body && JSON.parse(body) });
    if (req.url.startsWith("/redirect/")) {
      res.writeHead(307, { location: `${origin}/stolen/run/chat/completions` });
      return res.end();
    }
    if (req.url.endsWith("/models")) {
      res.writeHead(req.url.includes("missing") ? 404 : 200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "deployed-model" }] }));
    }
    if (body && JSON.parse(body).stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      return res.end('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n');
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const connection = (url, key = "synthetic-key") => ({ provider: "cerebrium", apiKey: key, providerSpecificData: { baseUrl: url, disableEnvProxy: true } });

describe("Cerebrium deployments", () => {
  it("registers an empty passthrough catalog and validates deployment URLs", () => {
    expect(REGISTRY.find((entry) => entry.id === "cerebrium")).toMatchObject({ models: [], passthroughModels: true });
    expect(cerebriumBaseUrl("https://example.test/v4/project/app/run/")).toBe("https://example.test/v4/project/app/run");
    for (const value of ["", "https://user:pass@example.test/run", "https://example.test/run?x=1", "https://example.test/v4", "http://example.test/run"]) expect(cerebriumBaseUrl(value)).toBeNull();
  });
  it("discovers each deployment and reports unsupported discovery", async () => {
    expect(await fetchConnectionModels(connection(`${origin}/a/run`))).toEqual({ models: [{ id: "deployed-model" }] });
    expect(await fetchConnectionModels(connection(`${origin}/missing/run`))).toMatchObject({ status: 404 });
    expect(await fetchConnectionModels(connection("", ""))).toMatchObject({ status: 400 });
    expect(requests.at(-2)).toMatchObject({ url: "/a/run/models", authorization: "Bearer synthetic-key" });
  });
  it("routes JSON and SSE to separate deployments using their keys", async () => {
    const executor = getExecutor("cerebrium");
    for (const [deployment, stream] of [["a", false], ["b", true]]) {
      const result = await executor.execute({ model: "deployed-model", body: { model: "deployed-model", messages: [{ role: "user", content: "hi" }], stream }, stream, credentials: connection(`${origin}/${deployment}/run`, `key-${deployment}`), proxyOptions: { disableEnvProxy: true } });
      expect(result.response.status).toBe(200);
      if (stream) expect(await result.response.text()).toContain("data: [DONE]");
      else expect((await result.response.json()).choices[0].message.content).toBe("hello");
      expect(requests.at(-1)).toMatchObject({ url: `/${deployment}/run/chat/completions`, authorization: `Bearer key-${deployment}`, body: { model: "deployed-model", stream } });
    }
  });
  it("does not follow discovery or inference redirects", async () => {
    const before = requests.length;
    expect(await fetchConnectionModels(connection(`${origin}/redirect/run`))).toMatchObject({ status: 307 });
    try { await getExecutor("cerebrium").execute({ model: "m", body: { messages: [] }, credentials: connection(`${origin}/redirect/run`), proxyOptions: { disableEnvProxy: true } }); } catch {}
    expect(requests.slice(before).every((request) => !request.url.startsWith("/stolen/"))).toBe(true);
  });
  it("fails closed before dispatch when settings are missing", async () => {
    const count = requests.length;
    for (const credentials of [connection(""), connection(`${origin}/a/run`, "")]) {
      expect((await getExecutor("cerebrium").execute({ model: "m", body: {}, credentials })).response.status).toBe(400);
    }
    expect(requests).toHaveLength(count);
  });
});
