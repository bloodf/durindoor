import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { Agent } from "undici";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/tls");
const fixtureCert = fs.readFileSync(path.join(fixtureDir, "antigravity-probe-fixture.crt"));
const fixtureKey = fs.readFileSync(path.join(fixtureDir, "antigravity-probe-fixture.key"));
const servers = new Set();
const dispatchers = new Set();

afterEach(async () => {
  await Promise.all([...dispatchers].map((dispatcher) => dispatcher.close()));
  dispatchers.clear();
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))));
  servers.clear();
});

it("records ALPN offered separately from negotiated for the account-probe transport", async () => {
  let offeredProtocols;
  let negotiatedProtocol;
  const server = https.createServer({
    key: fixtureKey,
    cert: fixtureCert,
    ALPNCallback({ protocols }) {
      offeredProtocols = protocols;
      // Prefer h2 if offered so a client offer cannot be mistaken for the
      // protocol the handshake actually selected.
      if (protocols.includes("h2")) return "h2";
      if (protocols.includes("http/1.1")) return "http/1.1";
      return undefined;
    },
  }, async (request, response) => {
    let requestBody = "";
    for await (const chunk of request) requestBody += chunk.toString();
    server.requestBody = requestBody;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ fixture: true, method: request.method }));
  });
  server.on("secureConnection", (socket) => {
    negotiatedProtocol = socket.alpnProtocol || null;
  });
  servers.add(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  // The fixture certificate is the only trust anchor supplied to this
  // dispatcher. Verification remains enabled and the URL hostname is checked.
  const dispatcher = new Agent({ connect: { ca: fixtureCert, rejectUnauthorized: true } });
  dispatchers.add(dispatcher);
  const response = await proxyAwareFetch(`https://localhost:${server.address().port}/v1internal:fetchAvailableModels`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer synthetic-fixture-token" },
    body: JSON.stringify({ project: "synthetic-fixture-project" }),
    dispatcher,
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ fixture: true, method: "POST" });
  expect(server.requestBody).toContain('"project":"synthetic-fixture-project"');
  expect(offeredProtocols).toEqual(["http/1.1"]);
  expect(negotiatedProtocol).toBe("http/1.1");
});
