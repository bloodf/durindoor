import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ALIASES } from "../../website/aliases.mjs";
import { rewriteCssImport, CSS_IMPORT_PATTERN } from "../../website/scripts/rewrite-css-import.mjs";

const websiteRoot = new URL("../../website/", import.meta.url);

describe("website build configuration", () => {
  it("uses the shared alias table in Next and the Node loader, with matching jsconfig paths", async () => {
    const [nextConfig, aliasLoader, jsconfig] = await Promise.all([
      readFile(new URL("next.config.mjs", websiteRoot), "utf8"),
      readFile(new URL("scripts/alias-loader.mjs", websiteRoot), "utf8"),
      readFile(new URL("jsconfig.json", websiteRoot), "utf8").then(JSON.parse),
    ]);
    expect(nextConfig).toContain("...resolveAliases()");
    expect(aliasLoader).toContain("resolveAliases()");
    expect(aliasLoader).toContain("../aliases.mjs");
    for (const [alias, target] of Object.entries(ALIASES)) {
      const jsconfigKey = alias === "three128" ? alias : `${alias}/*`;
      const jsconfigTarget = alias === "three128" ? target : `${target}/*`;
      expect(jsconfig.compilerOptions.paths[jsconfigKey]).toEqual([jsconfigTarget]);
    }
  });

  it("throws with the source file and regex when the CSS import rewrite matches nothing", () => {
    const file = "src/shared/ui/tokens.css";
    expect(() => rewriteCssImport("@import \"tailwindcss\";", file)).toThrow(file);
    expect(() => rewriteCssImport("@import \"tailwindcss\";", file)).toThrow(String(CSS_IMPORT_PATTERN));
  });
});
