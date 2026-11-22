/**
 * Regression for #2293: publish NaN, NLP Cloud, and Replicate under docs/providers/,
 * fold or remove docs/providers.md, and keep #2034 port evidence out of public docs.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const docsRoot = resolve(root, "docs");

function listFilesRecursive(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFilesRecursive(full, acc);
    else acc.push(full);
  }
  return acc;
}

describe("review-b-provider-docs (#2293)", () => {
  it("publishes nan, nlpcloud, and replicate as MDX provider pages with frontmatter", () => {
    for (const id of ["nan", "nlpcloud", "replicate"]) {
      const rel = `docs/providers/${id}.mdx`;
      expect(existsSync(resolve(root, rel)), rel).toBe(true);
      const body = read(rel);
      expect(body.startsWith("---\n")).toBe(true);
      expect(body).toMatch(/^title:\s+\S+/m);
      expect(body).toMatch(/^description:\s+\S+/m);
      expect(existsSync(resolve(root, `docs/${id}.md`)), `docs/${id}.md must be removed`).toBe(false);
    }
  });

  it("lists the three providers in docs/providers/meta.json", () => {
    const pages = JSON.parse(read("docs/providers/meta.json")).pages;
    expect(pages).toEqual(expect.arrayContaining(["nan", "nlpcloud", "replicate"]));
  });

  it("removes the unpublished docs/providers.md stub", () => {
    expect(existsSync(resolve(root, "docs/providers.md"))).toBe(false);
    const index = read("docs/providers/index.mdx");
    expect(index).toMatch(/Atlas Cloud|ParalonCloud|SubQ|Parallel/);
  });

  it("keeps #2034 port evidence out of public docs and in internal notes", () => {
    const publicHits = listFilesRecursive(docsRoot).filter((path) =>
      readFileSync(path, "utf8").includes("2034"),
    );
    expect(publicHits.map((path) => path.slice(docsRoot.length + 1))).toEqual([]);

    for (const note of [
      "internal/docs/nan-2034.md",
      "internal/docs/nlpcloud-2034.md",
      "internal/docs/gemini-web-2034.md",
      "internal/docs/web-cookie-2034.md",
      "internal/docs/muse-spark-web-2034.md",
    ]) {
      expect(existsSync(resolve(root, note)), note).toBe(true);
    }

    const nan = read("docs/providers/nan.mdx");
    expect(nan).toContain("nan_pat_");
    expect(nan).not.toContain("OmniRoute");
    expect(nan).not.toContain("open-sse/config/providers/registry/nan");

    const nlp = read("docs/providers/nlpcloud.mdx");
    expect(nlp).toContain("NLP Cloud");
    expect(nlp).not.toContain("open-sse/executors/nlpcloud.ts");
    expect(nlp).not.toContain("2c4aa9e9af21e2ad27440c4c478c10282154a596");

    expect(read("internal/docs/nan-2034.md")).toContain("#2034");
    expect(read("internal/docs/nlpcloud-2034.md")).toContain("nlpcloud.ts");
    expect(read("internal/docs/gemini-web-2034.md")).toMatch(/gemini-web\.ts|#2034/);
    expect(read("internal/docs/web-cookie-2034.md")).toContain("m365Credentials.ts");
  });

  it("does not link public provider pages at internal/docs", () => {
    for (const id of ["nan", "nlpcloud", "replicate", "gemini-web", "web-cookie", "muse-spark-web"]) {
      const body = read(`docs/providers/${id}.mdx`);
      expect(body).not.toMatch(/\]\(\.\.\/\.\.\/internal\/docs\//);
      expect(body).not.toMatch(/`internal\/docs\/[^`]*2034/);
    }
  });
});
