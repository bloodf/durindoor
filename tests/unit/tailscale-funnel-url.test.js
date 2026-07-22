import { describe, expect, it } from "vitest";
import {
  resolveFunnelPortFromJson,
  deriveTailscaleFunnelUrl,
} from "../../src/lib/tunnel/tailscale/tailscale.js";

// Fixtures modeled on real `tailscale status --json` / `funnel status --json`
// output from a host serving several funnels (DurinDoor on 11434).
const STATUS = { Self: { DNSName: "cortexos.tailfd052e.ts.net." } };

const FUNNEL = {
  TCP: { "11434": { HTTPS: true }, "3000": { HTTPS: true }, "443": { HTTPS: true } },
  Web: {
    "cortexos.tailfd052e.ts.net:11434": { Handlers: { "/": { Proxy: "http://localhost:11434" } } },
    "cortexos.tailfd052e.ts.net:3000": { Handlers: { "/": { Proxy: "http://localhost:3000" } } },
    "cortexos.tailfd052e.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:80" } } },
  },
};

describe("tailscale funnel URL derivation", () => {
  it("matches the funnel port that fronts our local server port", () => {
    expect(resolveFunnelPortFromJson(FUNNEL, 11434)).toBe(":11434");
    expect(resolveFunnelPortFromJson(FUNNEL, 3000)).toBe(":3000");
  });

  it("returns the full funnel URL with port for our server", () => {
    expect(deriveTailscaleFunnelUrl(STATUS, FUNNEL, 11434)).toBe("https://cortexos.tailfd052e.ts.net:11434");
  });

  it("omits an explicit port when the funnel is served on 443", () => {
    const only443 = {
      Web: { "host.ts.net:443": { Handlers: { "/": { Proxy: "http://localhost:8080" } } } },
    };
    expect(resolveFunnelPortFromJson(only443, 8080)).toBe("");
    expect(deriveTailscaleFunnelUrl({ Self: { DNSName: "host.ts.net." } }, only443, 8080))
      .toBe("https://host.ts.net");
  });

  it("returns bare host (no port) when nothing is funneled to our port", () => {
    expect(resolveFunnelPortFromJson(FUNNEL, 59999)).toBe("");
    expect(deriveTailscaleFunnelUrl(STATUS, FUNNEL, 59999)).toBe("https://cortexos.tailfd052e.ts.net");
  });

  it("falls back to the sole funnel port when only one exists and no target matches", () => {
    const single = { TCP: { "8443": { HTTPS: true } }, Web: {} };
    expect(resolveFunnelPortFromJson(single, 12345)).toBe(":8443");
  });

  it("returns null when Self.DNSName is missing (tailscale unreachable)", () => {
    expect(deriveTailscaleFunnelUrl(null, FUNNEL, 11434)).toBeNull();
    expect(deriveTailscaleFunnelUrl({}, FUNNEL, 11434)).toBeNull();
  });

  it("strips the trailing dot from Self.DNSName", () => {
    expect(deriveTailscaleFunnelUrl({ Self: { DNSName: "x.ts.net." } }, { Web: {} }, 1))
      .toBe("https://x.ts.net");
  });
});
