/**
 * #2311: the blocked-provider stub never routes; real web-session executors sit behind a gate.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getExecutor } from "../../open-sse/executors/index.js";
import { SessionDispatchGateExecutor } from "../../open-sse/executors/session-dispatch-gate.js";
import { UnsupportedOmniRouteWebSessionExecutor } from "../../open-sse/executors/unsupported-websession.js";
import { HuggingChatExecutor } from "../../open-sse/executors/huggingchat.js";
import { MuseSparkWebExecutor } from "../../open-sse/executors/muse-spark-web.js";

const optedIn = { apiKey: "synthetic-secret", providerSpecificData: { enableSessionDispatch: true } };
afterEach(() => vi.restoreAllMocks());

describe("web session dispatch gate", () => {
  it.each([
    ["huggingchat", HuggingChatExecutor],
    ["muse-spark-web", MuseSparkWebExecutor],
    ["ms-web", MuseSparkWebExecutor],
  ])("%s reaches the real executor only through the gate", async (id, Real) => {
    const dispatched = { response: new Response("real") };
    const real = vi.spyOn(Real.prototype, "execute").mockResolvedValue(dispatched);
    const executor = getExecutor(id);
    expect(executor).toBeInstanceOf(SessionDispatchGateExecutor);

    for (const flag of [undefined, false, "true"]) {
      const closed = await executor.execute({ credentials: { providerSpecificData: { enableSessionDispatch: flag } } });
      expect(closed.response.status).toBe(501);
    }
    expect(real).not.toHaveBeenCalled();
    await expect(executor.execute({ credentials: optedIn })).resolves.toBe(dispatched);
    expect(() => executor.buildUrl()).toThrow(/HuggingChat|Muse/);
    expect(() => executor.buildHeaders(optedIn)).toThrow(/HuggingChat|Muse/);
  });

  it("the plain stub stays closed for an opted-in connection", async () => {
    const real = vi.spyOn(HuggingChatExecutor.prototype, "execute");
    const result = await new UnsupportedOmniRouteWebSessionExecutor("huggingchat").execute({ credentials: optedIn });
    expect(result.response.status).toBe(501);
    expect(real).not.toHaveBeenCalled();
  });

  it("providers without a real executor are plain stubs", async () => {
    for (const id of ["devin", "suno", "udio"]) {
      const executor = getExecutor(id);
      expect(executor.constructor).toBe(UnsupportedOmniRouteWebSessionExecutor);
      expect((await executor.execute({ credentials: optedIn })).response.status).toBe(501);
    }
  });
});
