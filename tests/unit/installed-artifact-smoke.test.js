import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { validateArtifact, verifyEndpoints } from "../../scripts/smoke-installed-artifact.mjs";
import { verifyStaticAssets } from "../../scripts/verify-static-assets.mjs";

const cleanup = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function artifact() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "installed-smoke-test-"));
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, "custom-server.js");
  fs.writeFileSync(entry, "throw new Error('server must not run before dependency probe');");
  return { root, entry };
}

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function dashboardServer(handler, { bypass, ignoreLoginSetting = false } = {}) {
  let requireLogin = false;
  return serve(async (req, res) => {
    const reply = (status, body, headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/health") return reply(200, { ok: true });
    if (req.url === "/api/auth/login") {
      let body = "";
      for await (const chunk of req) body += chunk;
      if (JSON.parse(body).password !== "isolated-password") return reply(401, { error: "Invalid password" });
      return reply(200, { success: true, mustChangePassword: false }, { "Set-Cookie": "auth_token=session; Path=/; HttpOnly" });
    }
    if (req.url === "/api/settings" && req.method === "PATCH") {
      if (req.headers.cookie !== "auth_token=session") return reply(401, { error: "Unauthorized" });
      let body = "";
      for await (const chunk of req) body += chunk;
      if (!ignoreLoginSetting) requireLogin = JSON.parse(body).requireLogin;
      return reply(200, { requireLogin });
    }
    if (requireLogin && req.headers.cookie !== "auth_token=session" && !bypass?.(req)) {
      if (req.url === "/dashboard") {
        res.writeHead(307, { Location: "/login" });
        return res.end();
      }
      return reply(401, { error: "Unauthorized" });
    }
    if (req.url === "/api/providers") return reply(200, { connections: [] });
    handler(req, res);
  });
}

const script = fileURLToPath(new URL("../../scripts/smoke-installed-artifact.mjs", import.meta.url));
function run(entry) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, entry], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    child.once("error", reject);
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
  });
}

describe("installed artifact smoke failures", () => {
  it.each([false, true])("exits nonzero for a missing packaged worker without source fallback (parent exists: %s)", async (parentExists) => {
    const { root, entry } = artifact();
    if (parentExists) fs.mkdirSync(path.join(root, "src/lib/db/adapters"), { recursive: true });
    const result = await run(entry);
    expect(result.code).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.output).toContain(
      'Cannot resolve packaged runtime: ' + JSON.stringify(path.join("src", "lib", "db", "adapters", "pgSyncWorker.cjs"))
    );
    expect(result.output).toContain("Optional runtime probe failed");
    expect(result.output).not.toContain("server must not run");
  });

  it("rejects dependency links outside the artifact", () => {
    const { root, entry } = artifact();
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.symlinkSync(os.tmpdir(), path.join(root, "node_modules", "outside"));
    expect(() => validateArtifact(entry)).toThrow("external or absolute symlink");
  });

  it("exits nonzero when the worker exists but pg is not packaged", async () => {
    const { root, entry } = artifact();
    const adapters = path.join(root, "src/lib/db/adapters");
    fs.mkdirSync(adapters, { recursive: true });
    fs.writeFileSync(path.join(adapters, "pgSyncWorker.cjs"), "require('pg');");
    const result = await run(entry);
    expect(result.code).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.output).toContain("Cannot find module 'pg'");
    expect(result.output).toContain("Optional runtime probe failed");
  });

  it("rejects a resolvable packaged pg-query-stream with missing pg-cursor", async () => {
    const { root, entry } = artifact();
    const adapters = path.join(root, "src/lib/db/adapters");
    fs.mkdirSync(adapters, { recursive: true });
    fs.writeFileSync(path.join(adapters, "pgSyncWorker.cjs"), "");
    const pg = path.join(root, "node_modules/pg");
    fs.mkdirSync(pg, { recursive: true });
    fs.writeFileSync(path.join(pg, "index.js"), "module.exports = {};");
    const require = createRequire(import.meta.url);
    const streamRoot = path.dirname(path.dirname(require.resolve("pg-query-stream")));
    fs.cpSync(streamRoot, path.join(root, "node_modules/pg-query-stream"), { recursive: true });
    const result = await run(entry);
    expect(result.code).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.output).toContain("Cannot find module 'pg-cursor'");
    expect(result.output).toContain("Optional runtime probe failed");
    expect(result.output).not.toContain("server must not run");
  });

  it.each([
    ["export const chromium = { launch() {} };", "worker reached after ESM import"],
    ["export const chromium = {};", "Invalid playwright runtime"],
    ["import 'missing-playwright-runtime';", "Cannot find package 'missing-playwright-runtime'"],
  ])("uses packaged ESM exports and validates Chromium: %s", async (esm, expected) => {
    const { root, entry } = artifact();
    const adapters = path.join(root, "src/lib/db/adapters");
    fs.mkdirSync(adapters, { recursive: true });
    fs.writeFileSync(path.join(adapters, "pgSyncWorker.cjs"), "throw new Error('worker reached after ESM import');");
    const services = path.join(root, "open-sse/services");
    fs.mkdirSync(services, { recursive: true });
    fs.writeFileSync(path.join(services, "browserPool.js"), "");
    for (const name of ["pg", "pg-query-stream", "playwright"]) {
      const dir = path.join(root, "node_modules", name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "index.js"), "throw new Error('CJS entry must not be imported');");
    }
    fs.writeFileSync(path.join(root, "node_modules/pg-query-stream/index.js"),
      "module.exports = class QueryStream { read() {} submit() {} };");
    const playwright = path.join(root, "node_modules/playwright");
    fs.writeFileSync(path.join(playwright, "package.json"), JSON.stringify({
      name: "playwright", exports: { import: "./index.mjs", require: "./index.js" },
    }));
    fs.writeFileSync(path.join(playwright, "index.mjs"), esm);
    const result = await run(entry);
    expect(result.code).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.output).toContain(expected);
    expect(result.output).not.toContain("CJS entry must not be imported");
    expect(result.output).not.toContain("server must not run");
  });

  it.each([
    [200, "text/html", "<!doctype html><html>login</html>"],
    [200, "application/javascript", "<html>fallback</html>"],
    [404, "application/javascript", "missing"],
    [200, "application/javascript", ""],
  ])("rejects broken asset response %s %s", async (status, type, body) => {
    const base = await serve((_req, res) => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    });
    await expect(verifyStaticAssets(base, '<script src="/_next/static/chunk.js"></script>')).rejects.toThrow("Asset /_next/static/chunk.js");
  });

  it("rejects a login page without application assets", async () => {
    await expect(verifyStaticAssets("http://127.0.0.1", "<html>login</html>")).rejects.toThrow("No local .js/.css");
  });

  it("fails when wrong credentials receive success", async () => {
    const base = await serve((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(req.url === "/api/health" ? { ok: true } : { success: true }));
    });
    await expect(verifyEndpoints(base, "isolated-password")).rejects.toThrow("wrong password: expected JSON HTTP 401");
  });

  it("fails when correct credentials do not issue a session", async () => {
    let logins = 0;
    const base = await serve((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      logins++;
      res.writeHead(logins === 1 ? 401 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(logins === 1 ? { error: "Invalid password" } : { success: true, mustChangePassword: false }));
    });
    await expect(verifyEndpoints(base, "isolated-password")).rejects.toThrow("did not issue a dashboard session");
  });

  it("rejects settings that leave the loopback login bypass enabled", async () => {
    const base = await dashboardServer(() => {}, { ignoreLoginSetting: true });
    await expect(verifyEndpoints(base, "isolated-password")).rejects.toThrow("Settings did not enable requireLogin");
  });

  it.each([
    ["/api/providers", undefined, "no cookie providers"],
    ["/api/providers", "auth_token=invalid-session", "invalid cookie providers"],
    ["/dashboard", undefined, "no cookie dashboard"],
    ["/dashboard", "auth_token=invalid-session", "invalid cookie dashboard"],
  ])("rejects unprotected %s with cookie %s before authenticated reads", async (route, cookie, error) => {
    const base = await dashboardServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end('<html><script src="/_next/static/app.js"></script></html>');
    }, { bypass: (req) => req.url === route && req.headers.cookie === cookie });
    await expect(verifyEndpoints(base, "isolated-password")).rejects.toThrow(error);
  });

  it("rejects dashboard denial redirects outside the same-origin login page", async () => {
    const base = await dashboardServer((_req, res) => {
      res.writeHead(307, { Location: "https://example.invalid/login" });
      res.end();
    }, { bypass: (req) => req.url === "/dashboard" && !req.headers.cookie });
    await expect(verifyEndpoints(base, "isolated-password")).rejects.toThrow("no cookie dashboard: expected same-origin /login redirect");
  });

  it.each([301, 302, 303, 307, 308])("follows authenticated dashboard redirects (%s) and verifies final assets", async (status) => {
    const seen = [];
    const base = await dashboardServer((req, res) => {
      seen.push(req.url);
      if (req.url === "/dashboard") {
        res.writeHead(status, { Location: "/dashboard/usage" });
      } else if (req.url === "/dashboard/usage") {
        res.writeHead(307, { Location: "providers?view=all" });
      } else if (req.url === "/dashboard/providers?view=all") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.write('<html><script src="/_next/static/app.js"></script></html>');
      } else {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.write("window.loaded = true;");
      }
      res.end();
    });
    await expect(verifyEndpoints(base, "isolated-password")).resolves.toBe(1);
    expect(seen).toEqual(["/dashboard", "/dashboard/usage", "/dashboard/providers?view=all", "/_next/static/app.js"]);
  });

  it.each(["/login", "/dashboard/login", "/dashboardish", "/api/providers", "https://example.invalid/dashboard", "//example.invalid/dashboard"])("rejects unsafe redirect %s before requesting it", async (location) => {
    const seen = [];
    const base = await dashboardServer((req, res) => {
      seen.push(req.url);
      res.writeHead(307, { Location: location });
      res.end();
    });
    await expect(verifyEndpoints(base, "isolated-password")).rejects.toThrow("unsafe redirect");
    expect(seen).toEqual(["/dashboard"]);
  });

  it.each([
    [() => undefined, "missing Location", 1],
    [() => "/dashboard#again", "redirect cycle", 1],
    [(url) => url === "/dashboard" ? "/dashboard/usage" : "/dashboard", "redirect cycle", 2],
    [(_url, count) => `/dashboard/usage?hop=${count}`, "redirect limit", 6],
  ])("rejects invalid or unbounded redirect chains %#", async (location, error, requests) => {
    let count = 0;
    const base = await dashboardServer((req, res) => {
      const target = location(req.url, ++count);
      res.writeHead(307, target === undefined ? {} : { Location: target });
      res.end();
    });
    await expect(verifyEndpoints(base, "isolated-password")).rejects.toThrow(error);
    expect(count).toBe(requests);
  });

  it.each([
    [200, "application/json", "{}", "expected HTML HTTP 200"],
    [401, "text/html", "<html>Unauthorized</html>", "expected HTML HTTP 200"],
    [300, "text/html", "<html>Multiple choices</html>", "expected HTML HTTP 200"],
    [200, "text/html", "<html>login</html>", "No local .js/.css"],
    [200, "text/html", '<html><script src="/_next/static/missing.js"></script></html>', "Asset /_next/static/missing.js"],
  ])("still rejects invalid final HTML or assets (%s %s)", async (status, type, body, error) => {
    const base = await dashboardServer((req, res) => {
      if (req.url === "/dashboard") {
        res.writeHead(307, { Location: "/dashboard/usage" });
        res.end();
      } else if (req.url === "/dashboard/usage") {
        res.writeHead(status, { "Content-Type": type });
        res.end(body);
      } else {
        res.writeHead(404);
        res.end("missing");
      }
    });
    await expect(verifyEndpoints(base, "isolated-password")).rejects.toThrow(error);
  });
});
