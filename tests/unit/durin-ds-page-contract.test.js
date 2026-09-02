import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const pagesDir = fileURLToPath(new URL("../../src/shared/ui/pages", import.meta.url));
const expectedPaths = {
  "api-docs": "/dashboard/api-docs",
  "cli-tools": "/dashboard/cli-tools",
  combos: "/dashboard/combos",
  "console-log": "/dashboard/console-log",
  endpoint: "/dashboard/endpoint",
  headroom: "/dashboard/headroom",
  health: "/dashboard/health",
  "mcp-gateway": "/dashboard/mcp-gateway",
  "mcp-help": "/dashboard/mcp-help",
  "media-providers": "/dashboard/media-providers/embedding",
  playground: "/dashboard/playground",
  providers: "/dashboard/providers",
  "proxy-pools": "/dashboard/proxy-pools",
  quota: "/dashboard/quota",
  settings: "/dashboard/profile",
  skills: "/dashboard/skills",
  "test-savers": "/dashboard/compression-studio",
  timeline: "/dashboard/timeline",
  "token-saver-settings": "/dashboard/token-saver/settings",
  "token-saver": "/dashboard/token-saver",
  usage: "/dashboard/usage",
};
const shellDecorator = readFileSync(
  fileURLToPath(new URL("../../src/shared/ui/shell/withDashboardShell.jsx", import.meta.url)),
  "utf8",
);

const pageFiles = readdirSync(pagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const files = readdirSync(path.join(pagesDir, entry.name));
    return {
      slug: entry.name,
      page: path.join(pagesDir, entry.name, files.find((file) => file.endsWith("Page.jsx"))),
      story: path.join(pagesDir, entry.name, files.find((file) => file.endsWith("Page.stories.jsx"))),
    };
  });

describe("Durin DS page contracts", () => {
  it("gives every page an icon, title, and subtitle through PageHeader", () => {
    expect(pageFiles).toHaveLength(Object.keys(expectedPaths).length);

    for (const { slug, page } of pageFiles) {
      const source = readFileSync(page, "utf8");
      const header = source.match(/<PageHeader\b[\s\S]*?\/>/)?.[0] ?? "";

      expect(source, `${slug} must import PageHeader`).toMatch(/import PageHeader from ["']@\/shared\/ui\/components\/PageHeader\.jsx["'];/);
      expect(header, `${slug} must render PageHeader`).not.toBe("");
      expect(header, `${slug} PageHeader needs an icon`).toMatch(/\bicon="[^"]+"/);
      expect(header, `${slug} PageHeader needs a title`).toMatch(/\btitle="[^"]+"/);
      expect(header, `${slug} PageHeader needs a subtitle`).toMatch(/\bsubtitle="[^"]+"/);
    }
  });

  it("wraps every page story in the dashboard shell at its canonical path", () => {
    for (const { slug, story } of pageFiles) {
      const source = readFileSync(story, "utf8");

      expect(source, `${slug} must import withDashboardShell`).toMatch(/import \{ withDashboardShell \} from ["']@\/shared\/ui\/shell\/withDashboardShell\.jsx["'];/);
      expect(source, `${slug} must use withDashboardShell`).toContain("withDashboardShell({");
      expect(source, `${slug} activePath`).toContain(`activePath: "${expectedPaths[slug]}"`);
    }
  });

  it("keeps page identity in PageHeader instead of duplicating it in the shell", () => {
    expect(shellDecorator).not.toMatch(/<DashboardShell[\s\S]*?\b(?:title|subtitle|icon)=/);
    expect(shellDecorator).toMatch(/<DashboardShell\b[\s\S]*?\bactions=\{actions\}/);
  });
});
