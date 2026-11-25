import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const proc = new EventEmitter();
    proc.killed = false;
    proc.exitCode = null;
    proc.stdin = { write: vi.fn() };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn(() => { proc.killed = true; });
    return proc;
  }),
}));

const { __test__, listTools, callTool, killAllStdioEntries } = await import("../../src/lib/mcp/gateway/stdioClient");
const { getEntry, getStore } = __test__;
const tick = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => killAllStdioEntries());

describe("stdio replacement during a pending request", () => {
  it.each(["initialize", "tools/list", "tools/call"])("keeps the replacement after %s fails", async (method) => {
    const oldInstance = { id: "race", slug: "race", command: "old" };
    const oldEntry = getEntry(oldInstance);
    await oldEntry.ensure();
    if (method !== "initialize") oldEntry.initialized = true;

    const request = method === "tools/call" ? callTool(oldInstance, "tool", {}) : listTools(oldInstance);
    const rejected = expect(request).rejects.toThrow();
    await tick();
    expect(oldEntry.pending.size).toBe(1);

    const replacement = getEntry({ ...oldInstance, command: "new" });
    const spawning = replacement.ensure();
    const child = replacement.proc;
    await rejected;
    await spawning;

    expect(getStore().get(oldInstance.id)).toBe(replacement);
    expect(replacement.proc).toBe(child);
    expect(child.killed).toBe(false);
    killAllStdioEntries();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
