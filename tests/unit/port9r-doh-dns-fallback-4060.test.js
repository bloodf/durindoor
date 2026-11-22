// Port of the DNS piece of decolua/9router#4060: when UDP/53 to Google DNS is
// blocked, the MITM-bypass real-IP lookup must not stall on the UDP timeout; it
// falls back to DNS-over-HTTPS on port 443.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resolveRealIPsForTesting as resolveRealIPs,
  __clearRealIpCacheForTesting,
} from "../../open-sse/utils/proxyFetch.js";

const dohAnswer = (...answers) => new Response(JSON.stringify({ Answer: answers }), { status: 200 });

describe("port9r #4060 DoH DNS fallback", () => {
  beforeEach(() => {
    __clearRealIpCacheForTesting();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("uses UDP answers when they work and never touches DoH", async () => {
    const dohFetch = vi.fn();
    const ips = await resolveRealIPs("cloudcode-pa.googleapis.com", {
      udpResolve: async () => ["142.250.1.1"],
      dohFetch,
    });
    expect(ips).toEqual(["142.250.1.1"]);
    expect(dohFetch).not.toHaveBeenCalled();
  });

  it("falls back to DoH when the UDP resolver times out", async () => {
    const dohFetch = vi.fn(async () => dohAnswer(
      { type: 5, data: "alias.example." },
      { type: 1, data: "142.250.9.9" },
    ));
    const started = Date.now();
    const ips = await resolveRealIPs("cloudcode-pa.googleapis.com", {
      udpResolve: () => new Promise((_, reject) => setTimeout(() => reject(new Error("queryA ETIMEOUT")), 20)),
      dohFetch,
      udpTimeoutMs: 20,
    });
    expect(ips).toEqual(["142.250.9.9"]);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(String(dohFetch.mock.calls[0][0])).toContain("https://1.1.1.1/dns-query?name=cloudcode-pa.googleapis.com");
  });

  it("tries the next DoH endpoint when the first fails and rejects loopback answers", async () => {
    const dohFetch = vi.fn()
      .mockResolvedValueOnce(dohAnswer({ type: 1, data: "127.0.0.1" }))
      .mockResolvedValueOnce(dohAnswer({ type: 1, data: "142.250.7.7" }));
    const ips = await resolveRealIPs("daily-cloudcode-pa.googleapis.com", {
      udpResolve: async () => { throw new Error("blocked"); },
      dohFetch,
    });
    expect(ips).toEqual(["142.250.7.7"]);
    expect(String(dohFetch.mock.calls[1][0])).toContain("https://dns.google/resolve");
  });

  it("returns [] when UDP and every DoH endpoint fail", async () => {
    const ips = await resolveRealIPs("cloudcode-pa.googleapis.com", {
      udpResolve: async () => { throw new Error("blocked"); },
      dohFetch: async () => { throw new Error("offline"); },
    });
    expect(ips).toEqual([]);
  });
});
