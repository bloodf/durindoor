import { afterEach, describe, expect, it, vi } from "vitest";
import { workerFetch } from "../../src/lib/tunnel/cloudflare/workerFetch.js";

const URL_UNDER_TEST = "https://worker.example/api/tunnel/register";

function tlsFailure(code) {
  const error = new TypeError("fetch failed");
  error.cause = Object.assign(new Error("tls"), { code });
  return error;
}

describe("tunnel worker TLS failures (upstream 9router#2922)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the certificate error and how to trust a private CA", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(tlsFailure("SELF_SIGNED_CERT_IN_CHAIN")));

    await expect(workerFetch(URL_UNDER_TEST)).rejects.toThrow(
      /fetch failed \(cause: SELF_SIGNED_CERT_IN_CHAIN\).*NODE_EXTRA_CA_CERTS/,
    );
  });

  it("names a non-certificate cause without the CA hint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(tlsFailure("ECONNREFUSED")));

    const error = await workerFetch(URL_UNDER_TEST).catch((caught) => caught);

    expect(error.message).toBe("fetch failed (cause: ECONNREFUSED)");
    expect(error.cause.message).toBe("fetch failed");
  });

  it("rethrows errors without a cause code unchanged", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    await expect(workerFetch(URL_UNDER_TEST)).rejects.toBe(abort);
  });

  it("keeps default certificate verification, even with the upstream bypass variable set", async () => {
    vi.stubEnv("TUNNEL_WORKER_INSECURE", "1");
    const response = new Response("ok");
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const init = { method: "POST" };

    await expect(workerFetch(URL_UNDER_TEST, init)).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(URL_UNDER_TEST, init);
    vi.unstubAllEnvs();
  });
});
