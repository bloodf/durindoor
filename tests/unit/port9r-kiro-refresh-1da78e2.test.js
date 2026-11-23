import { expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { refreshKiroToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { buildKiroIdentityHeaders } from "../../open-sse/shared/kiroHeaders.js";

it("uses the Kiro IDE identity for social token refresh in both refresh paths", async () => {
  proxyAwareFetch.mockResolvedValue({ ok: true, json: async () => ({ accessToken: "access", profileArn: "profile" }) });
  await new DefaultExecutor("kiro").refreshKiro("fake-refresh");
  await refreshKiroToken("fake-refresh", { profileArn: "profile" });
  expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  for (const [, options] of proxyAwareFetch.mock.calls) {
    expect(options.headers).toMatchObject(buildKiroIdentityHeaders({ refreshToken: "fake-refresh" }));
    expect(JSON.parse(options.body)).toEqual({ refreshToken: "fake-refresh" });
  }
});
