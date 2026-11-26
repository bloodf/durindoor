import { describe, expect, it, vi } from "vitest";
import { UnsupportedOmniRouteWebSessionExecutor } from "../../open-sse/executors/unsupported-websession.js";
import { HuggingChatExecutor } from "../../open-sse/executors/huggingchat.js";

describe("staged web session stub", () => {
  it("fails closed even when session dispatch is enabled", async () => {
    const dispatch = vi.spyOn(HuggingChatExecutor.prototype, "execute");
    try {
      const executor = new UnsupportedOmniRouteWebSessionExecutor("huggingchat");
      const result = await executor.execute({ credentials: { providerSpecificData: { enableSessionDispatch: true } } });
      expect(result.response.status).toBe(501);
      expect((await result.response.json()).error.type).toBe("provider_port_pending");
      expect(() => executor.buildUrl()).toThrow();
      expect(() => executor.buildHeaders()).toThrow();
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      dispatch.mockRestore();
    }
  });
});
