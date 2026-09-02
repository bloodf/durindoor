import { describe, it, expect } from "vitest";

import { normalizeProviderStainless } from "../__baseline__/provider-header-normalize.mjs";
import { PROVIDERS } from "../../open-sse/config/providers.js";

const STAINLESS_OS_LITERAL = "MacOS";
const STAINLESS_ARCH_LITERAL = "arm64";

describe("provider baseline Stainless host-key normalization", () => {
  it("replaces X-Stainless-Os and X-Stainless-Arch with placeholders", () => {
    const fixture = {
      primary: {
        headers: {
          "X-Stainless-Os": STAINLESS_OS_LITERAL,
          "X-Stainless-Arch": STAINLESS_ARCH_LITERAL,
          "User-Agent": "claude-cli/2.1.258 (external, sdk-cli)",
        },
      },
      nested: [
        {
          format: "claude",
          transport: {
            headers: {
              "X-Stainless-Os": "Linux",
              "X-Stainless-Arch": "x64",
              "X-Stainless-Package-Version": "0.112.1",
            },
          },
        },
      ],
    };

    const normalized = normalizeProviderStainless(fixture);
    expect(normalized.primary.headers["X-Stainless-Os"]).toBe("<OS>");
    expect(normalized.primary.headers["X-Stainless-Arch"]).toBe("<ARCH>");
    expect(normalized.primary.headers["User-Agent"]).toBe("claude-cli/2.1.258 (external, sdk-cli)");
    expect(normalized.nested[0].transport.headers["X-Stainless-Os"]).toBe("<OS>");
    expect(normalized.nested[0].transport.headers["X-Stainless-Arch"]).toBe("<ARCH>");
    expect(normalized.nested[0].transport.headers["X-Stainless-Package-Version"]).toBe("0.112.1");
  });

  it("leaves providers without those headers untouched", () => {
    const fixture = { noHost: { headers: { "User-Agent": "static" } } };
    const normalized = normalizeProviderStainless(fixture);
    expect(normalized.noHost.headers).toEqual({ "User-Agent": "static" });
  });

  it("normalizes live PROVIDERS Claude and AgentRouter headers to placeholders", () => {
    const normalized = normalizeProviderStainless(PROVIDERS);
    const agentrouterPrimary = normalized.agentrouter?.headers;
    const agentrouterTransport = normalized.agentrouter?.transports?.[0]?.headers;
    const claudePrimary = normalized.claude?.headers;
    for (const target of [agentrouterPrimary, agentrouterTransport, claudePrimary]) {
      expect(target).toBeDefined();
      expect(target["X-Stainless-Os"]).toBe("<OS>");
      expect(target["X-Stainless-Arch"]).toBe("<ARCH>");
    }
    expect(claudePrimary["User-Agent"]).toBe("claude-cli/2.1.258 (external, sdk-cli)");
  });
});
