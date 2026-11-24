import { EventEmitter } from "node:events";
import path from "node:path";
import { createRequire } from "node:module";
import Module from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const G_KEY = "__9routerMcpBridges";

describe("#2431 stdioSseBridge server initiated requests", () => {
  let bridge;
  let proc;

  beforeEach(() => {
    const req = createRequire(import.meta.url);
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, parent, isMain, options) {
      if (request.startsWith("@/")) request = path.resolve(REPO_ROOT, "src", request.slice(2));
      return origResolve.call(this, request, parent, isMain, options);
    };
    const childPath = req.resolve("child_process");
    req.cache[childPath] = {
      id: childPath,
      filename: childPath,
      loaded: true,
      exports: { spawn: vi.fn(() => {
        proc = new EventEmitter();
        proc.killed = false;
        proc.exitCode = null;
        proc.kill = vi.fn();
        proc.stdin = { writable: true, write: vi.fn(() => true) };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        return proc;
      }) },
    };
    const bridgePath = path.resolve(REPO_ROOT, "src/lib/mcp/stdioSseBridge.js");
    delete req.cache[bridgePath];
    delete globalThis[G_KEY];
    try { bridge = req(bridgePath); }
    finally { Module._resolveFilename = origResolve; delete req.cache[childPath]; }
  });

  afterEach(() => { delete globalThis[G_KEY]; });

  it("routes a server request and preserves its reply id without consuming a pending response", () => {
    const name = "browsermcp";
    const sentA = [];
    const sentB = [];
    const sidA = bridge.registerSession(name, (chunk) => sentA.push(chunk));
    const sidB = bridge.registerSession(name, (chunk) => sentB.push(chunk));

    bridge.sendToChild(name, { jsonrpc: "2.0", id: 7, method: "tools/call" }, sidA);
    const pendingId = JSON.parse(proc.stdin.write.mock.calls[0][0]).id;
    const request = { jsonrpc: "2.0", id: pendingId, method: "roots/list", params: {} };
    proc.stdout.emit("data", Buffer.from(`${JSON.stringify(request)}\n`));

    expect(sentA).toHaveLength(1);
    expect(sentB).toHaveLength(0);
    expect(JSON.parse(sentA[0].split("data: ")[1].trim())).toEqual(request);

    bridge.sendToChild(name, { jsonrpc: "2.0", id: pendingId, result: { roots: [] } }, sidB);
    expect(JSON.parse(proc.stdin.write.mock.calls[1][0])).toEqual({
      jsonrpc: "2.0", id: pendingId, result: { roots: [] },
    });

    proc.stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: pendingId, result: { ok: true } })}\n`));
    expect(sentA).toHaveLength(2);
    expect(sentB).toHaveLength(0);
    expect(JSON.parse(sentA[1].split("data: ")[1].trim())).toEqual({
      jsonrpc: "2.0", id: 7, result: { ok: true },
    });
  });
});
