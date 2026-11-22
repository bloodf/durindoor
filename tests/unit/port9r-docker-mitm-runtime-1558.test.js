import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

describe("MITM Docker runtime", () => {
  it("includes the shared DNS mapping required by the copied MITM server", () => {
    const dns = readFileSync(new URL("src/mitm/dns/dnsConfig.js", root), "utf8");
    const dockerfile = readFileSync(new URL("Dockerfile", root), "utf8");
    expect(dns).toContain('require("../../shared/constants/mitmToolHosts.js")');
    expect(dockerfile).toMatch(/^COPY --from=builder \/app\/src\/shared\/constants\/mitmToolHosts\.js \.\/src\/shared\/constants\/mitmToolHosts\.js$/m);
  });
});
