import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// MCP help lives on the docs site (the in-app MCP Help page was removed).
// This test checks that both MCP surfaces and their current control contracts
// stay documented in the MDX pages the dashboard links to.

const here = dirname(fileURLToPath(import.meta.url));
const src = ["mcp-gateway.mdx", "mcp-control.mdx"]
  .map((file) => readFileSync(resolve(here, "../../docs/features", file), "utf8"))
  .join("\n");

// Every control tool that must be listed, matching src/lib/mcp/control/tools.js.
const CONTROL_TOOLS = [
  "list_providers",
  "list_connections",
  "toggle_connection_active",
  "toggle_provider_active",
  "usage_stats",
  "token_saver_stats",
  "model_list",
  "list_combos",
  "get_combo",
  "create_combo",
  "update_combo",
  "delete_combo",
  "quota_snapshots",
  "refresh_quota",
  "list_api_keys",
  "get_settings",
  "update_settings",
];

describe("MCP docs document every surface", () => {
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

  it("documents the control server endpoint and every control tool", () => {
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
