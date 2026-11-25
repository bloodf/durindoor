import { describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));

import { getAccessToken, refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import { refreshAccessToken } from "../../open-sse/services/tokenRefresh/providers.js";

describe.each(["antigravity", "agy"])("%s refresh without a lease", (provider) => {
  it("does not dispatch from generic refresh entry points", async () => {
    fetchMock.mockClear();
    const credentials = { refreshToken: "synthetic-refresh" };
    expect(await getAccessToken(provider, credentials)).toBeNull();
    expect(await refreshTokenByProvider(provider, credentials)).toBeNull();
    expect(await refreshAccessToken(provider, credentials.refreshToken, credentials)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
