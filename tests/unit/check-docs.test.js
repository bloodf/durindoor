import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { githubSlug, validateDocumentation } from "../../scripts/check-docs.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const assets =
  '<img src="durindoor-banner.png"> <img src="durindoor-wordmark-theme-aware.svg">';

const COMMUNITY_FIXTURES = {
  "CODE_OF_CONDUCT.md": "# Code of Conduct\n",
  "CONTRIBUTING.md": "# Contributing\n",
  "CHANGELOG.md": "# Changelog\n",
  ".github/CONTRIBUTING.md": "# Contributing\n",
  ".github/SECURITY.md": "# Security\n",
  ".github/PULL_REQUEST_TEMPLATE.md": "# PR Template\n",
  ".github/CHANGELOG_TEMPLATE.md": "# Changelog Template\n",
  ".github/ISSUE_TEMPLATE/bug_report.md": "# Bug Report\n",
  ".github/ISSUE_TEMPLATE/feature_request.md": "# Feature Request\n",
};

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "durindoor-docs-"));
  roots.push(root);
  const all = { ...COMMUNITY_FIXTURES, ...files };
  await Promise.all(Object.entries(all).map(async ([name, text]) => {
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
  const all = { ...COMMUNITY_FIXTURES, ...files };
  const root = await fixture(files);
  return validateDocumentation({ root, files: Object.keys(all) });
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

  it("requires both approved assets in README.md", async () => {
    const issues = await check({ "README.md": "# DurinDoor" });
    expect(issues).toContain("README.md: missing durindoor-banner.png");
    expect(issues).toContain("README.md: missing durindoor-wordmark-theme-aware.svg");
    expect(issues).not.toContain("docs/README.md: missing durindoor-banner.png");
    expect(issues).not.toContain("docs/index.mdx: missing durindoor-banner.png");
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
  it("uses stripped text when checking anchors, ignoring fenced headings", async () => {
    const issues = await check({
      "README.md": `${assets}\n[x](#fake)\n\`\`\`markdown\n# fake\n\`\`\``,
    });
    expect(issues).toContain("README.md: missing anchor #fake in README.md");
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
      "open-sse/AGENT-INDEX.md": "# Agent index",
      "tests/README.md": "# Tests",
      "cli/README.md": "# CLI",
      "AGENTS.md": "internal",
      "CLAUDE.md": "internal",
    });
    expect(issues.filter((i) => i.includes("not reachable"))).toEqual([]);
  });

  it("flags duplicate required asset only once per file", async () => {
    const issues = await check({
      "README.md": assets,
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

  it("reports documented npm scripts missing from package.json", async () => {
    const issues = await check({
      "README.md": `${assets}\nRun \`npm run nonexistent-script\` to test.`,
      "package.json": '{"name":"test","scripts":{"build":"node build.js"}}',
    });
    expect(issues).toContain("README.md: documented npm script 'nonexistent-script' not found in package.json");
  });

  it("reports missing required community files", async () => {
    const root = await fixture({
      "README.md": assets,
      "package.json": '{"name":"test"}',
    });
    const issues = await validateDocumentation({
      root,
      files: ["README.md", "package.json"],
    });
    expect(issues).toContain("repository: missing required community file CODE_OF_CONDUCT.md");
    expect(issues).toContain("repository: missing required community file .github/SECURITY.md");
  });

  it("does not flag existing npm scripts", async () => {
    const issues = await check({
      "README.md": `${assets}\nRun \`npm run build\`.`,
      "package.json": '{"name":"test","scripts":{"build":"node build.js"}}',
    });
    expect(issues).not.toContain(expect.stringMatching(/npm script 'build'/));
  });
});

const INDEX_MDX = `---
title: Docs
description: Test documentation index.
---

Hello from the index.
`;

const PAGE_MDX = `---
title: Extra
description: A listed extra page.
---

Hello from extra.
`;

function mdxTree(extra = {}) {
  return {
    "README.md": assets,
    "docs/index.mdx": INDEX_MDX,
    "docs/meta.json": JSON.stringify({ pages: ["index"] }, null, 2),
    ...extra,
  };
}

describe("mdx tree rules", () => {
  it("accepts a listed mdx tree with frontmatter", async () => {
    const issues = await check(mdxTree());
    expect(issues.filter((i) => i.includes("docs/"))).toEqual([]);
  });

  it("reports an mdx file missing from its folder meta.json pages", async () => {
    const issues = await check(mdxTree({
      "docs/extra.mdx": PAGE_MDX,
    }));
    expect(issues).toContain("docs/extra.mdx: not listed in docs/meta.json pages");
  });

  it("reports a dangling meta.json pages entry", async () => {
    const issues = await check(mdxTree({
      "docs/meta.json": JSON.stringify({ pages: ["index", "ghost"] }, null, 2),
    }));
    expect(issues).toContain("docs/meta.json: dangling pages entry 'ghost'");
  });

  it("does not flag dangling pages in a Task 12 stub section", async () => {
    const issues = await check(mdxTree({
      "docs/meta.json": JSON.stringify({ pages: ["index", "getting-started"] }, null, 2),
      "docs/getting-started/index.mdx": `---
title: Getting started
description: Install and send the first request.
---

Pages in this section are being written.
`,
      "docs/getting-started/meta.json": JSON.stringify({
        pages: ["index", "installation", "first-request"],
      }, null, 2),
    }));
    expect(issues.filter((i) => i.includes("dangling"))).toEqual([]);
  });

  it("reports missing frontmatter title and description", async () => {
    const issues = await check(mdxTree({
      "docs/meta.json": JSON.stringify({ pages: ["index", "extra"] }, null, 2),
      "docs/extra.mdx": "Hello without frontmatter.\n",
    }));
    expect(issues).toContain("docs/extra.mdx: missing frontmatter title");
    expect(issues).toContain("docs/extra.mdx: missing frontmatter description");
  });

  it("allows a section stub to omit description", async () => {
    const issues = await check(mdxTree({
      "docs/meta.json": JSON.stringify({ pages: ["index", "faq"] }, null, 2),
      "docs/faq.mdx": `---
title: FAQ
---

Pages in this section are being written.
`,
    }));
    expect(issues.filter((i) => i.includes("frontmatter"))).toEqual([]);
  });

  it("reports an em dash outside code fences", async () => {
    const issues = await check(mdxTree({
      "docs/meta.json": JSON.stringify({ pages: ["index", "extra"] }, null, 2),
      "docs/extra.mdx": `---
title: Extra
description: A listed extra page.
---

This sentence uses an em dash \u2014 which is banned.
`,
    }));
    expect(issues).toContain("docs/extra.mdx: em dash (U+2014) outside code fences");
  });

  it("reports a bare relative mdx link that Fumadocs cannot resolve", async () => {
    const issues = await check(mdxTree({
      "docs/meta.json": JSON.stringify({ pages: ["index", "extra"] }, null, 2),
      "docs/extra.mdx": `---
title: Extra
description: A listed extra page.
---

See [the index](index.mdx) and [the same page](./index.mdx).
`,
    }));
    expect(issues).toContain("docs/extra.mdx: bare relative link index.mdx (prefix with ./)");
    expect(issues.filter((i) => i.includes("bare relative link"))).toHaveLength(1);
  });

  it("ignores an em dash inside a fenced code block", async () => {
    const issues = await check(mdxTree({
      "docs/meta.json": JSON.stringify({ pages: ["index", "extra"] }, null, 2),
      "docs/extra.mdx": `---
title: Extra
description: A listed extra page.
---

\`\`\`text
em dash \u2014 inside a fence
\`\`\`
`,
    }));
    expect(issues.filter((i) => i.includes("em dash"))).toEqual([]);
  });

  it("reports emoji outside code fences", async () => {
    const issues = await check(mdxTree({
      "docs/meta.json": JSON.stringify({ pages: ["index", "extra"] }, null, 2),
      "docs/extra.mdx": `---
title: Extra
description: A listed extra page.
---

Ship it \u2705
`,
    }));
    expect(issues).toContain("docs/extra.mdx: emoji outside code fences");
  });

  it("skips headings inside MDX component blocks", async () => {
    const issues = await check({
      "README.md": `${assets}\n[x](docs/index.mdx#fake)\n`,
      "docs/index.mdx": `---
title: Docs
description: Test documentation index.
---

<Cards>
# fake
</Cards>
`,
      "docs/meta.json": JSON.stringify({ pages: ["index"] }, null, 2),
    });
    expect(issues).toContain("README.md: missing anchor #fake in docs/index.mdx");
  });

  it("reaches root-level markdown through docs/README.md", async () => {
    const issues = await check({
      "README.md": assets,
      "docs/README.md": "[Docker](../DOCKER.md)\n",
      "DOCKER.md": "# Docker\n",
    });
    expect(issues.filter((i) => i.includes("DOCKER.md"))).toEqual([]);
  });

  it("does not require legacy docs markdown to be reachable via meta.json", async () => {
    const issues = await check(mdxTree({
      "docs/development/contributing.md": "[gone](anti-slop.md)\n",
    }));
    expect(issues.filter((i) => i.includes("anti-slop"))).toEqual([]);
    expect(issues.filter((i) => i.includes("contributing.md"))).toEqual([]);
  });
});

