import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { githubSlug, validateDocumentation } from "../../scripts/check-docs.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const assets =
  '<img src="durindoor-banner.png"> <img src="durindoor-wordmark-theme-aware.svg">';

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "durindoor-docs-"));
  roots.push(root);
  await Promise.all(Object.entries(files).map(async ([name, text]) => {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }));
  // The two approved assets must exist as file targets so image tags resolve.
  await writeFile(path.join(root, "durindoor-banner.png"), "");
  await writeFile(path.join(root, "durindoor-wordmark-theme-aware.svg"), "");
  return root;
}

async function check(files) {
  const root = await fixture(files);
  return validateDocumentation({ root, files: Object.keys(files) });
}

describe("documentation integrity", () => {
  it("uses GitHub-compatible heading slugs", () => {
    expect(githubSlug("API & Reference")).toBe("api--reference");
    expect(githubSlug("What's New?")).toBe("whats-new");
    expect(githubSlug("  Spaces  ")).toBe("spaces");
    expect(githubSlug("C++ Guide")).toBe("c-guide");
    expect(githubSlug("Under_score")).toBe("under_score");
    expect(githubSlug("Café")).toBe("café");
    expect(githubSlug("Заголовок")).toBe("заголовок");
    expect(githubSlug("!@#$%^&*()")).toBe("");
  });

  it("reports missing files and anchors", async () => {
    const issues = await check({
      "README.md": `${assets}\n[missing](docs/missing.md) [anchor](docs/guide.md#nope)`,
      "docs/guide.md": "# Present heading\n",
    });
    expect(issues).toEqual([
      "README.md: missing anchor #nope in docs/guide.md",
      "README.md: missing target docs/missing.md",
    ]);
  });

  it("requires both approved assets in both entry points", async () => {
    const issues = await check({ "README.md": "# DurinDoor", "docs/README.md": "# Docs" });
    expect(issues).toContain("README.md: missing durindoor-banner.png");
    expect(issues).toContain("README.md: missing durindoor-wordmark-theme-aware.svg");
    expect(issues).toContain("docs/README.md: missing durindoor-banner.png");
    expect(issues).toContain("docs/README.md: missing durindoor-wordmark-theme-aware.svg");
  });

  it("reports forbidden URLs even inside code blocks", async () => {
    const issues = await check({
      "README.md": `${assets}\n`,
      "docs/orphan.md": "\`\`\`text\nhttps://bloodf.github.io/durindoor/\n\`\`\`",
    });
    expect(issues).toContain("docs/orphan.md: forbidden URL bloodf.github.io/durindoor");
  });

  it("ignores fenced and inline code blocks", async () => {
    const issues = await check({
      "README.md": `${assets}\n\`\`\`js\n[link](docs/missing.md)\n\`\`\`\n\`\`\`markdown\n[link](docs/gone.md)\n\`\`\`\n~~~bash\n[link](docs/tilded.md)\n~~~\n\`[link](docs/inline.md)\``,
    });
    const missingTargets = issues.filter((i) => i.startsWith("README.md: missing target"));
    expect(missingTargets).toEqual([]);
  });

  it("allows pure anchor links resolved against current file", async () => {
    const issues = await check({
      "README.md": `${assets}\n[section](#section)\n# section\n`,
    });
    expect(issues).toEqual([]);
  });

  it("resolves URL-encoded fragments", async () => {
    const issues = await check({
      "README.md": `${assets}\n[link](docs/guide.md#api%20%26%20reference)`,
      "docs/guide.md": "# API & Reference\n",
    });
    expect(issues).toEqual([]);
  });

  it("distinguishes duplicate headings with numeric suffixes", async () => {
    const issues = await check({
      "README.md": `${assets}\n[first](#dup) [second](#dup-1) [third](#dup-2)\n# Dup\n# Dup\n# Dup`,
    });
    expect(issues).toEqual([]);
  });

  it("parses HTML img and a tags", async () => {
    const issues = await check({
      "README.md": `${assets}\n<img src=\"docs/missing.png\"> <a href=\"docs/anchor.md#nope\">x</a>`,
      "docs/anchor.md": "# Heading\n",
    });
    expect(issues).toContain("README.md: missing target docs/missing.png");
    expect(issues).toContain("README.md: missing anchor #nope in docs/anchor.md");
  });

  it("ignores URL schemes and mailto links", async () => {
    const issues = await check({
      "README.md": `${assets}\n[site](https://example.com) [mail](mailto:hi@example.com)`,
    });
    expect(issues).not.toContain(expect.stringMatching(/missing target/));
  });

  it("treats internal and package docs as non-public", async () => {
    const issues = await check({
      "README.md": `${assets}\n`,
      "docs/superpowers/internal.md": "[x](other.md)",
      "docs/superpowers/other.md": "# OK",
      "cli/README.md": "# CLI",
      "AGENTS.md": "internal",
    });
    expect(issues).not.toContain("docs/superpowers/internal.md: public document is not reachable from README.md or docs/README.md");
    expect(issues).not.toContain("cli/README.md: public document is not reachable from README.md or docs/README.md");
    expect(issues).not.toContain("AGENTS.md: public document is not reachable from README.md or docs/README.md");
  });

  it("flags duplicate required asset only once per file", async () => {
    const issues = await check({
      "README.md": assets,
      "docs/README.md": assets,
    });
    const bannerIssues = issues.filter((i) => i.includes("missing durindoor-banner.png"));
    const wordmarkIssues = issues.filter((i) => i.includes("missing durindoor-wordmark-theme-aware.svg"));
    expect(bannerIssues).toHaveLength(0);
    expect(wordmarkIssues).toHaveLength(0);
  });

  it("sorts issues for stable output", async () => {
    const issues = await check({
      "README.md": `${assets}\n[z](z.md)`,
      "z.md": "[one](b.md) [two](c.md)",
    });
    expect(issues).toEqual([
      "z.md: missing target b.md",
      "z.md: missing target c.md",
    ]);
  });
});
