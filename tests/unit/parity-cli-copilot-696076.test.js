import { afterEach, describe, expect, it, vi } from "vitest";
import { requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { GheCopilotExecutor } from "../../open-sse/executors/ghe-copilot.js";
import { buildCopilotEndpointContract } from "../../open-sse/services/copilotEndpointContract.js";
import { handleCountTokensCore } from "../../open-sse/handlers/countTokensCore.js";

afterEach(() => vi.unstubAllGlobals());

describe("CLIProxyAPI Copilot comparison", () => {
  it.each([
    ["github", undefined, "https://github.com/login/device?provider=issued"],
    ["ghe-copilot", { gheUrl: "https://tenant.example.test" }, "https://tenant.example.test/login/device?provider=issued"],
  ])("preserves the %s provider's device authorization URI", async (provider, options, uri) => {
    const fetch = vi.fn(async () => Response.json({ device_code: "device", user_code: "user", verification_uri: uri, interval: 5 }));
    vi.stubGlobal("fetch", fetch);
    const result = await requestDeviceCode(provider, null, options);
    expect(result.verification_uri).toBe(uri);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([GithubExecutor, GheCopilotExecutor])("selects routes from each connection's catalog", (Executor) => {
    const executor = new Executor();
    const connection = (endpoint) => ({ providerSpecificData: { copilotEndpointContract: buildCopilotEndpointContract([
      { id: "example-model", supported_endpoints: [endpoint] },
    ]) } });
    expect(executor.copilotEndpointRoute("example-model", connection("/responses"))).toBe("responses");
    expect(executor.copilotEndpointRoute("example-model", connection("/chat/completions"))).toBe("chat");
    expect(executor.copilotEndpointRoute("example-model", {})).toBeNull();
  });

  it.each(["github", "ghe-copilot"])("returns the existing approximate count shape for %s", async (provider) => {
    const fetch = vi.fn(() => { throw new Error("unexpected network request"); });
    vi.stubGlobal("fetch", fetch);
    const result = await handleCountTokensCore({ body: { messages: [{ role: "user", content: "hello world" }] }, modelInfo: { provider, model: "example-model" } });
    expect(await result.response.json()).toEqual({ input_tokens: 3, approximate: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
