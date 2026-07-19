import { describe, expect, it } from "vitest";
import { selectOAuthPublicBase } from "@/lib/mcp/gateway/oauthPublicBase.js";

describe("MCP OAuth public base selection", () => {
  it("prefers explicit override then active Tailscale then Cloudflare", () => {
    const statuses = {
      tailscale: { enabled: true, tunnelUrl: "https://device.tailnet.ts.net" },
      tunnel: { enabled: true, publicUrl: "https://dash.example.com" },
    };
    expect(selectOAuthPublicBase({ ...statuses, envOverride: "https://oauth.example.com/path" })).toBe("https://oauth.example.com");
    expect(selectOAuthPublicBase(statuses)).toBe("https://device.tailnet.ts.net");
    expect(selectOAuthPublicBase({ tunnel: statuses.tunnel })).toBe("https://dash.example.com");
  });

  it("rejects inactive and non-public tunnel origins", () => {
    expect(selectOAuthPublicBase({ tailscale: { enabled: false, tunnelUrl: "https://device.tailnet.ts.net" } })).toBeNull();
    expect(selectOAuthPublicBase({ tunnel: { enabled: true, publicUrl: "http://localhost:20128" } })).toBeNull();
  });
});
