import { describe, expect, it, vi } from "vitest";
import { startChatGptPlanLoopback } from "../../src/lib/oauth/chatgptPlanLoopback.js";

describe("ChatGPT plan local loopback", () => {
  it("starts its listener before authorization and passes the exact callback to the account service", async () => {
    let redirectUri;
    const selected = { id: "synthetic-selection" };
    const accounts = {
      beginAuthorization: vi.fn(async (options) => {
        redirectUri = options.redirectUri;
        expect(options.selection).toBe(selected);
        expect((await fetch(redirectUri)).status).toBe(404);
        return { handle: {}, authorizationUrl: "https://auth.openai.com/authorize" };
      }),
      finishAuthorization: vi.fn(async (_handle, url) => {
        expect(url).toBe(`${redirectUri}?state=synthetic&code=synthetic`);
        return selected;
      }),
    };
    const flow = await startChatGptPlanLoopback(accounts, { selection: selected });
    expect((await fetch(`${redirectUri}?state=synthetic&code=synthetic`)).status).toBe(200);
    expect(await flow.result).toBe(selected);
    expect(accounts.finishAuthorization).toHaveBeenCalledOnce();
  });

  it("cancels without exchanging a code", async () => {
    const accounts = { beginAuthorization: async () => ({ handle: {}, authorizationUrl: "synthetic" }), finishAuthorization: vi.fn() };
    const flow = await startChatGptPlanLoopback(accounts);
    flow.cancel();
    await expect(flow.result).rejects.toThrow("Authorization cancelled");
    expect(accounts.finishAuthorization).not.toHaveBeenCalled();
  });
});
