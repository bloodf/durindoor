import { describe, expect, it, vi } from "vitest";
import admin from "../../cli/src/cli/admin.js";

function deps(result = { success: true, data: { id: "combo-1", name: "work", models: ["openai/gpt"] } }) {
  const api = { configure: vi.fn(), getComboById: vi.fn().mockResolvedValue(result) };
  return { api, loadApi: vi.fn(() => api), stdout: vi.fn(), stderr: vi.fn() };
}

describe("local combo administration", () => {
  it("prints the combo as JSON and uses local management on the selected port", async () => {
    const io = deps();
    expect(await admin.runAdmin(["combos", "get", "combo-1", "--port", "20129"], io)).toBe(0);
    expect(io.api.configure).toHaveBeenCalledWith({ host: "127.0.0.1", protocol: "http:", port: 20129 });
    expect(io.api.getComboById).toHaveBeenCalledWith("combo-1");
    expect(JSON.parse(io.stdout.mock.calls[0][0])).toEqual({ id: "combo-1", name: "work", models: ["openai/gpt"] });
    expect(io.stderr).not.toHaveBeenCalled();
  });

  it("reports API failures only on stderr with exit 1", async () => {
    const io = deps({ success: false, error: "Combo not found", statusCode: 404 });
    expect(await admin.runAdmin(["combos", "get", "missing"], io)).toBe(1);
    expect(io.api.configure).toHaveBeenCalledWith({ host: "127.0.0.1", protocol: "http:", port: 20128 });
    expect(JSON.parse(io.stderr.mock.calls[0][0])).toEqual({ error: "Combo not found", statusCode: 404 });
    expect(io.stdout).not.toHaveBeenCalled();
  });

  it.each([
    [], ["keys", "get", "id"], ["combos", "delete", "id"], ["combos", "get"],
    ["combos", "get", ".."], ["combos", "get", "--help"],
    ["combos", "get", "id", "--host", "example.com"],
    ["combos", "get", "id", "--port", "0"],
    ["combos", "get", "id", "--port", "65536"],
    ["combos", "get", "id", "--port", "12x"],
    ["combos", "get", "id", "--port"],
  ])("rejects invalid arguments %j before loading authorization", async (...args) => {
    const io = deps();
    expect(await admin.runAdmin(args, io)).toBe(2);
    expect(io.loadApi).not.toHaveBeenCalled();
    expect(io.stdout).not.toHaveBeenCalled();
  });

  it("shows admin help without loading authorization", async () => {
    const io = deps();
    expect(await admin.runAdmin(["--help"], io)).toBe(0);
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining("admin combos get"));
    expect(io.loadApi).not.toHaveBeenCalled();
  });
});

// Exercise the real client with an in-memory transport and auth files only.
import fs from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

it("encodes combo IDs as one path component and retains management authorization", async () => {
  let sent;
  const transport = { request(options, callback) {
    sent = options;
    const request = new EventEmitter();
    request.setTimeout = vi.fn();
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit("data", '{"id":"a/b?x#y"}');
      response.emit("end");
    };
    return request;
  } };
  const sandbox = { module: { exports: {} }, Buffer, require(name) {
    if (name === "http" || name === "https") return transport;
    if (name === "node-machine-id") return { machineIdSync: () => "fixture-machine" };
    if (name === "../appDataDir") return { getAppDataDir: () => "/fixture" };
    if (name === "node:fs") return { readFileSync: () => "fixture-secret" };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(new URL("../../cli/src/cli/api/client.js", import.meta.url), "utf8"), sandbox);
  const result = await sandbox.module.exports.getComboById("a/b?x#y");
  expect(sent.path).toBe("/api/combos/a%2Fb%3Fx%23y");
  expect(sent.headers["x-9r-cli-token"]).toMatch(/^[a-f0-9]{16}$/);
  expect(result.data).toEqual({ id: "a/b?x#y" });
});
