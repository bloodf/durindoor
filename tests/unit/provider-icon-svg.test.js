import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const providerIconPath = path.join(root, "src/shared/components/ProviderIcon.js");

function extractSetEntries(text) {
  const match = text.match(/const\s+KNOWN_SVGS\s*=\s*new\s+Set\(\[([^\]]*)\]\)/s);
  if (!match) return [];
  return match[1]
    .split(",")
    .map(s => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

describe("ProviderIcon SVG fallback", () => {
  it("has every KNOWN_SVGS id backed by a real public/providers/<id>.svg file", async () => {
    const source = await readFile(providerIconPath, "utf8");
    const ids = extractSetEntries(source);
    const svgFiles = new Set(
      (await readdir(path.join(root, "public/providers")))
        .filter(f => f.endsWith(".svg"))
        .map(f => path.basename(f, ".svg"))
    );
    for (const id of ids) {
      expect(svgFiles).toContain(id);
    }
  });

  it("rewrites local /providers/<id>.png src to /providers/<id>.svg", async () => {
    const source = await readFile(providerIconPath, "utf8");
    expect(source).toMatch(/\.svg/);
    expect(source).toContain('src.match(/^\\/providers\\/([^/]+)\\.png$/i)');
    expect(source).toContain("KNOWN_SVGS");
  });
});
