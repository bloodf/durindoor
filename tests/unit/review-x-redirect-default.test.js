import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";

// Provider registry files that may set quirks.allowRedirects, each with the
// reason its credentialed send has to follow a redirect. None does today.
const OPT_OUTS = {};

const requests = [];
let server;
let origin;

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.url);
    req.resume();
    if (req.url.startsWith("/start")) res.writeHead(307, { Location: "/final" }).end();
    else res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

function executor({ path = "/start", headers = {}, quirks } = {}) {
  return new BaseExecutor("redirect-fixture", {
    baseUrl: `${origin}${path}`,
    headers,
    quirks,
    retry: { 502: { attempts: 0 } }
  });
}

async function send(target, credentials = {}) {
  requests.length = 0;
  return target.execute({ model: "m", body: {}, stream: false, credentials, proxyOptions: { disableEnvProxy: true } });
}

describe("BaseExecutor redirect default", () => {
  it.each([
    ["API key", {}, { apiKey: "synthetic-key" }],
    ["bearer token", {}, { accessToken: "synthetic-token" }],
    ["cookie header", { headers: { Cookie: "session=synthetic" } }, {}],
    ["key header", { headers: { "x-goog-api-key": "synthetic-key" } }, {}],
    ["key in the query", { path: "/start?key=synthetic-key" }, {}]
  ])("refuses a redirect for a send with an %s", async (_name, options, credentials) => {
    await expect(send(executor(options), credentials)).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(/^\/start/);
  });

  it("passes redirect:'error' to the transport of a credentialed send", async () => {
    const directFetch = vi.fn(async () => new Response("{}"));
    await executor().execute({ model: "m", body: {}, stream: false, credentials: { apiKey: "synthetic-key" }, proxyOptions: { disableEnvProxy: true }, directFetch });
    expect(directFetch.mock.calls[0][1].redirect).toBe("error");
  });

  it.each([
    ["no credential", {}],
    ["the public placeholder", { accessToken: "public" }]
  ])("follows a redirect for a send with %s", async (_name, credentials) => {
    const { response } = await send(executor(), credentials);
    expect(response.status).toBe(200);
    expect(requests).toEqual(["/start", "/final"]);
  });

  it("follows a redirect for a provider that opted out", async () => {
    const { response } = await send(executor({ quirks: { allowRedirects: true } }), { apiKey: "synthetic-key" });
    expect(response.status).toBe(200);
    expect(requests).toEqual(["/start", "/final"]);
  });
});

describe("allowRedirects opt-outs", () => {
  const directory = new URL("../../open-sse/providers/registry/", import.meta.url);
  const optedOut = readdirSync(directory)
    .map((file) => [file, readFileSync(new URL(file, directory), "utf8").split("\n")])
    .filter(([, lines]) => lines.some((line) => line.includes("allowRedirects")));

  it("lists every opt-out with a reason", () => {
    expect(optedOut.map(([file]) => file).sort()).toEqual(Object.keys(OPT_OUTS).sort());
    for (const reason of Object.values(OPT_OUTS)) expect(reason.trim()).not.toBe("");
  });

  it("explains each opt-out in a comment above the quirk", () => {
    for (const [file, lines] of optedOut) {
      lines.forEach((line, index) => {
        if (line.includes("allowRedirects")) expect(lines[index - 1]?.trim(), file).toMatch(/^\/\/ \S/);
      });
    }
  });
});
