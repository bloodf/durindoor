import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getExecutor: vi.fn(),
}));

vi.mock("@/lib/localDb.js", () => ({ getProviderConnections: mocks.getProviderConnections }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: mocks.getExecutor }));
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "test-agent",
  updateKimchiUserAgent: async () => "test-agent",
}));

import { POST } from "../../src/app/api/translator/translate/route.js";

beforeEach(() => vi.clearAllMocks());

describe("console tool-history validation terminates before provider preparation", () => {
  for (const stream of [true, false]) {
    it.each([false, true])(`returns JSON 400 for non-object tool input with stream=${stream}, strict=%s`, async (strict) => {
      // CommandCode validates arguments itself; shared normalization must not
      // turn this invalid array into an empty object before the route sees it.
      const response = await POST({
        json: async () => ({
          step: 3,
          body: {
            provider: "commandcode",
            model: "m",
            body: {
              stream,
              tools: [{ type: "function", function: {
                name: "workspace.read", strict,
                parameters: { type: "object", properties: {} },
              } }],
              messages: [
                { role: "user", content: "read workspace" },
                { role: "assistant", content: null, tool_calls: [{
                  id: "call_read", type: "function",
                  function: { name: "workspace.read", arguments: "[]" },
                }] },
                { role: "tool", tool_call_id: "call_read", content: "previous result" },
              ],
            },
          },
        }),
      });

      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({
        success: false,
        error: "assistant tool call call_read arguments must be a JSON object",
      });
      expect(mocks.getProviderConnections).not.toHaveBeenCalled();
      expect(mocks.getExecutor).not.toHaveBeenCalled();
    });
  }
});
