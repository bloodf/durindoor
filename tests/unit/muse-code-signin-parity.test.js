import { afterEach, describe, expect, it, vi } from "vitest";

const outbound = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: outbound }));

import { pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { getExecutor } from "../../open-sse/executors/index.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  outbound.mockReset();
});

describe("Muse device sign-in through provider entry points", () => {
  it("keeps two device credentials and minted keys isolated", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ device_code: "device-a", user_code: "A", expires_in: 600 }))
      .mockResolvedValueOnce(json({ device_code: "device-b", user_code: "B", expires_in: 600 }))
      .mockResolvedValueOnce(json({ access_token: "dca:a" }))
      .mockResolvedValueOnce(json({ access_token: "dca:b" }));
    vi.stubGlobal("fetch", fetch);
    outbound.mockResolvedValueOnce(json({ api_key: "key-a" })).mockResolvedValueOnce(json({ api_key: "key-b" }));
    const a = await requestDeviceCode("muse-code", null, {});
    const b = await requestDeviceCode("muse-code", null, {});
    const first = await pollForToken("muse-code", a.device_code, null, null);
    const second = await pollForToken("muse-code", b.device_code, null, null);
    expect(first.tokens).toMatchObject({ accessToken: "key-a", refreshToken: "dca:a" });
    expect(second.tokens).toMatchObject({ accessToken: "key-b", refreshToken: "dca:b" });
    expect(outbound.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(["Bearer dca:a", "Bearer dca:b"]);
    const executor = getExecutor("muse-code");
    expect(executor.buildHeaders(first.tokens, true).Authorization).toBe("Bearer key-a");
    expect(executor.buildHeaders(second.tokens, true).Authorization).toBe("Bearer key-b");
  });
});
