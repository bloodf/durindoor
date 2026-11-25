import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const clientPath = fileURLToPath(new URL("../../cli/src/cli/api/client.js", import.meta.url));
const execFileAsync = promisify(execFile);
let server;
let dataDir;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-api-response-"));
  fs.writeFileSync(path.join(dataDir, "machine-id"), "test-machine");
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function request(handler) {
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const script = `
    const client = require(process.argv[1]);
    client.configure({ host: "127.0.0.1", port: Number(process.argv[2]) });
    const deadline = setTimeout(() => {
      console.error("API request did not settle after the response closed");
      process.exit(2);
    }, 5000);
    client.getProviders().then((result) => {
      clearTimeout(deadline);
      console.log(JSON.stringify(result));
      process.exit(0);
    });
  `;
  const { stdout } = await execFileAsync(process.execPath, ["-e", script, clientPath, String(server.address().port)], {
    env: { ...process.env, DATA_DIR: dataDir },
    timeout: 8000,
  });
  return JSON.parse(stdout);
}

describe("port(upstream) #4834: CLI API responses", { timeout: 10000 }, () => {
  it.each(["", '{"connections":'])("reports a response disconnected after %j", async (body) => {
    const result = await request((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "100" });
      res.flushHeaders();
      if (body) res.write(body);
      setTimeout(() => res.destroy(), 50);
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Network error:/);
  });

  it("preserves successful JSON responses", async () => {
    const result = await request((req, res) => res.end('{"connections":[]}'));
    expect(result).toEqual({ success: true, data: { connections: [] }, statusCode: 200 });
  });

  it("preserves HTTP error responses", async () => {
    const result = await request((req, res) => {
      res.writeHead(503);
      res.end('{"error":"Unavailable"}');
    });
    expect(result).toEqual({ success: false, error: "Unavailable", statusCode: 503 });
  });

  it("preserves failures before response headers arrive", async () => {
    const result = await request((req) => req.socket.destroy());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Network error:/);
  });
});
