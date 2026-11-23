import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";

describe("Cursor empty upstream response", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([true, false])("returns a gateway error for stream=%s", async (stream) => {
    // #5084 routes proxied text turns through AgentService; pin the legacy ChatService path.
    vi.stubEnv("CURSOR_AGENT_SERVICE", "off");
    const executor = new CursorExecutor();
    vi.spyOn(executor, "makeFetchRequest").mockResolvedValue({ status: 200, body: null });
    const result = await executor.execute({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream,
      credentials: { accessToken: "test", providerSpecificData: { machineId: "a".repeat(64) } },
      proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9" },
    });
    expect(result.response.status).toBe(502);
    expect((await result.response.json()).error.message).toContain("empty response body");
  });
});
