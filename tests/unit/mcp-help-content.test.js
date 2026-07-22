import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// WS1 (MCP Help page). The page is a JSX-in-.js server component, which the
// repo's vitest esbuild does not transform for SSR, so we assert the documented
// surfaces are present in the source. Each check maps to a done-state item in
// docs/superpowers/specs/2026-07-22-control-mcp-parity-roadmap.md (WS1).

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  resolve(here, "../../src/app/(dashboard)/dashboard/mcp-help/page.js"),
  "utf8"
);

// The seven control tools that must be listed, matching src/lib/mcp/control/tools.js.
const CONTROL_TOOLS = [
  "list_providers",
  "list_connections",
  "toggle_connection_active",
  "toggle_provider_active",
  "usage_stats",
  "token_saver_stats",
  "model_list",
];

describe("MCP Help page documents every surface", () => {
  it("frames both MCP surfaces (gateway + control server)", () => {
    expect(src).toMatch(/gateway/i);
    expect(src).toMatch(/control server/i);
  });

  it("documents all three transports", () => {
    expect(src).toContain("/api/mcp-gateway/message"); // streamable-HTTP
    expect(src).toContain("/api/mcp-gateway/sse"); // SSE
    expect(src).toMatch(/stdio/i); // stdio bridge
  });

  it("documents the slug__toolName namespacing convention", () => {
    expect(src).toContain("__");
    expect(src).toMatch(/instanceSlug|brave__search/);
  });

  it("documents the control server endpoint and all 7 tools", () => {
    expect(src).toContain("/api/mcp/control");
    for (const tool of CONTROL_TOOLS) {
      expect(src, `control tool ${tool} must be documented`).toContain(tool);
    }
  });

  it("documents gateway-key auth and the key-vs-dashboard-key distinction", () => {
    expect(src).toMatch(/Bearer/);
    expect(src).toMatch(/gateway key/i);
    expect(src).toMatch(/separate credentials/i);
  });

  it("documents the upstream OAuth flow (discovery, registration, login, refresh)", () => {
    expect(src).toMatch(/Discovery/i);
    expect(src).toMatch(/Registration/i);
    expect(src).toMatch(/PKCE/i);
    expect(src).toMatch(/Refresh/i);
  });

  it("includes a troubleshooting section", () => {
    expect(src).toMatch(/Troubleshooting/i);
    expect(src).toMatch(/401/);
  });
});
