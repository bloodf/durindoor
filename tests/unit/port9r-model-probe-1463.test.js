import { afterEach, expect, it, vi } from "vitest";
import { pingModelByKind } from "../../src/app/api/models/test/ping.js";

vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn().mockResolvedValue("test") }));
afterEach(() => vi.unstubAllGlobals());

it("accepts a tool-call completion and rejects an empty completion", async () => {
  const response = (message) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message }] }) });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ content: null, tool_calls: [{ id: "call1", type: "function", function: { name: "test", arguments: "{}" } }] })).mockResolvedValueOnce(response({ content: null, tool_calls: [] })));
  expect((await pingModelByKind("cu/default", "llm", "http://127.0.0.1:20127")).ok).toBe(true);
  expect((await pingModelByKind("cu/default", "llm", "http://127.0.0.1:20127")).ok).toBe(false);
});
