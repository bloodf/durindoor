import { describe, expect, it, vi } from "vitest";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";

describe("Cursor empty upstream response", () => {
  it.each([true, false])("returns a gateway error for stream=%s", async (stream) => {
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
