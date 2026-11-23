import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateDocumentation } from "../../scripts/check-docs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readRepoFile(file) {
  return readFile(path.join(root, file), "utf8");
}

describe("review l docs regressions", () => {
  it("keeps the published documentation graph and links valid", async () => {
    const files = execFileSync("git", ["ls-files", "*.md", "*.mdx", "*.json"], {
      cwd: root,
      encoding: "utf8",
    }).trim().split("\n");
    const issues = await validateDocumentation({ root, files });
    expect(issues).toEqual([]);
  });

  it("warns about CLI LAN exposure and query-string key logging", async () => {
    const install = await readRepoFile("docs/getting-started/installation.mdx");
    const gettingStarted = await readRepoFile("docs/getting-started/index.mdx");
    const realtime = await readRepoFile("docs/features/realtime.mdx");
    const gateway = await readRepoFile("docs/features/mcp-gateway.mdx");
    const management = await readRepoFile("docs/reference/management-api.mdx");
    for (const text of [install, gettingStarted]) {
      expect(text).toContain("reachable by other devices on the network");
      expect(text).toContain("requireApiKey");
    }
    for (const text of [realtime, gateway, management]) {
      expect(text).toContain("proxy and access logs or browser history");
      expect(text).toContain("only for clients that cannot send headers");
    }
  });

  it("documents verifiable third-party installs and omits unused AGY variables", async () => {
    const installs = await readRepoFile("docs/integrations/other-tools.mdx");
    const environment = await readRepoFile("docs/reference/environment.mdx");
    expect(installs).toContain("https://docs.factory.com/droid-cli/quickstart");
    expect(installs).toContain("https://docs.pi.dev/latest/quickstart");
    expect(installs).not.toContain("curl -fsSL https://app.factory.ai/cli");
    expect(installs).not.toContain("curl -fsSL https://pi.dev/install.sh");
    expect(environment).not.toContain("AGY_CLIENT_ID");
    expect(environment).not.toContain("AGY_CLIENT_SECRET");
  });
});
