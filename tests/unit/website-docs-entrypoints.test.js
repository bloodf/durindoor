import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
function docExists(url) {
  const slug = url
    .replace(/^https:\/\/durindoor\.vercel\.app/, "")
    .split(/[?#]/)[0]
    .replace(/^\/docs\/?/, "");
  return (
    existsSync(resolve(root, "docs", `${slug || "index"}.mdx`)) ||
    existsSync(resolve(root, "docs", slug, "index.mdx"))
  );
}

describe("public documentation entry points", () => {
  it("routes every index guide link to an existing document", () => {
    const links = [
      ...read("docs/index.mdx").matchAll(
        /(?:href|quickStartHref|apiHref)="(\/docs[^\"]*)"/g,
      ),
    ].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(10);
    expect(links.filter((url) => !docExists(url))).toEqual([]);
  });
  it("keeps README documentation and identity links valid", () => {
    const markdown = read("README.md");
    const docs = [
      ...markdown.matchAll(/https:\/\/durindoor\.vercel\.app\/docs[^\s)"<]*/g),
    ].map((match) => match[0]);
    expect(docs.length).toBeGreaterThan(10);
    expect(docs.filter((url) => !docExists(url))).toEqual([]);
    const assets = [
      ...markdown.matchAll(
        /(?:srcset|src)="(assets\/brand\/[^\"]+)"|\]\((assets\/brand\/[^)]+)\)/g,
      ),
    ].map((match) => match[1] || match[2]);
    expect(assets.length).toBeGreaterThan(2);
    expect(assets.filter((path) => !existsSync(resolve(root, path)))).toEqual(
      [],
    );
  });
});
