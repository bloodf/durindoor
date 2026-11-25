import { afterEach, describe, expect, it, vi } from "vitest";
import { SocksProxyAgent } from "socks-proxy-agent";
import { connectHttp2 } from "../../open-sse/utils/http2Connect.js";
import { SOCKS_CREDENTIAL_TOO_LONG } from "../../open-sse/utils/socksCredential.js";

describe("HTTP/2 SOCKS credential guard (#2472)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects an over-long SOCKS5 password before dialing", async () => {
    const dial = vi.spyOn(SocksProxyAgent.prototype, "connect");

    await expect(connectHttp2("https://localhost/", {
      proxyUrl: `socks5://user:${"p".repeat(300)}@127.0.0.1:1080`,
    })).rejects.toMatchObject({ code: SOCKS_CREDENTIAL_TOO_LONG });

    expect(dial).not.toHaveBeenCalled();
  });
});
