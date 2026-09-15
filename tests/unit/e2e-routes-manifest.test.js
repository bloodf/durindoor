/**
 * The e2e route manifest is data, not code, so nothing stops it drifting from
 * the app: a page can be split in two and the manifest keeps asserting text
 * that now lives on a different route. Playwright only notices in a full e2e
 * run, which is not part of the unit gate.
 *
 * These checks are cheap and catch the drift at the source: every manifest
 * entry must point at a page file that exists.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("../../", import.meta.url)));
const { routes } = JSON.parse(readFileSync(join(root, "tests/e2e/routes.json"), "utf8"));

describe("e2e route manifest", () => {
  it("points every route at a page file that exists", () => {
    const missing = routes.filter((route) => !existsSync(join(root, route.entry)));
    expect(missing.map((route) => `${route.id} → ${route.entry}`)).toEqual([]);
  });

  it("gives every route a unique id and template", () => {
    const ids = routes.map((route) => route.id);
    const templates = routes.map((route) => route.template);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(templates).size).toBe(templates.length);
  });

  it("covers both MCP Gateway pages with text that lives on the right one", () => {
    // The split moved keys to their own route. Asserting "No gateway keys yet"
    // against the instances page would fail only in a full Playwright run.
    const instances = routes.find((route) => route.template === "/dashboard/mcp-gateway");
    const keys = routes.find((route) => route.template === "/dashboard/mcp-gateway/keys");
    expect(keys).toBeDefined();
    expect(instances.expectedSecondary).toContain("No instances yet");
    expect(instances.expectedSecondary).not.toContain("No gateway keys yet");
    expect(keys.expectedSecondary).toContain("No gateway keys yet");
    expect(keys.expectedText).toBe("Gateway Keys");
  });
});
