import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkClaims, parseClaimRows, tokensIn } from "../../scripts/docs-claims-check.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "durindoor-claims-"));
  roots.push(root);
  await Promise.all(Object.entries(files).map(async ([name, text]) => {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }));
  return root;
}

describe("docs-claims-check", () => {
  it("parses claim arrows", () => {
    const rows = parseClaimRows([
      "DATA_DIR default → src/config.js:3",
      "- npm run build -> package.json:5",
      "not a claim",
    ].join("\n"));
    expect(rows).toEqual([
      { claim: "DATA_DIR default", file: "src/config.js", line: 3, raw: "DATA_DIR default → src/config.js:3" },
      { claim: "npm run build", file: "package.json", line: 5, raw: "- npm run build -> package.json:5" },
    ]);
  });

  it("extracts env, npm run, and /v1 tokens", () => {
    const tokens = tokensIn("Set DATA_DIR then npm run build against /v1/models.");
    expect([...tokens]).toEqual(expect.arrayContaining(["DATA_DIR", "npm run build", "/v1/models"]));
  });

  it("passes when cited tokens appear at the named line", async () => {
    const root = await fixture({
      "notes.md": [
        "DATA_DIR default → src/config.js:2",
        "npm run build → package.json:3",
        "/v1/models list → src/routes.js:2",
      ].join("\n"),
      "src/config.js": "const x = 1;\nexport const DATA_DIR = \"~/.9router\";\n",
      "package.json": "{\n  \"scripts\": {\n    \"build\": \"node build.js\"\n  }\n}\n",
      "src/routes.js": "app.get(\n  \"/v1/models\",\n  handler\n);\n",
      "docs/page.mdx": "---\ntitle: Page\ndescription: A page.\n---\n\n`DATA_DIR` and `npm run build` hit `/v1/models`.\n",
    });
    const issues = await checkClaims({
      notesPath: "notes.md",
      docsDir: "docs",
      cwd: root,
    });
    expect(issues).toEqual([]);
  });

  it("fails when the cited line window lacks the token", async () => {
    const root = await fixture({
      "notes.md": "DATA_DIR default → src/config.js:1",
      "src/config.js": "const other = 1;\nconst nope = 2;\n",
      "docs/page.mdx": "---\ntitle: Page\ndescription: A page.\n---\n\nNo env here.\n",
    });
    const issues = await checkClaims({
      notesPath: "notes.md",
      docsDir: "docs",
      cwd: root,
    });
    expect(issues.some((i) => i.includes("DATA_DIR") && i.includes("absent"))).toBe(true);
  });

  it("fails on an uncited token in the docs dir", async () => {
    const root = await fixture({
      "notes.md": "DATA_DIR default → src/config.js:1",
      "src/config.js": "export const DATA_DIR = 1;\n",
      "docs/page.mdx": "---\ntitle: Page\ndescription: A page.\n---\n\n`DATA_DIR` and `JWT_SECRET`.\n",
    });
    const issues = await checkClaims({
      notesPath: "notes.md",
      docsDir: "docs",
      cwd: root,
    });
    expect(issues).toContain("docs/page.mdx: uncited token JWT_SECRET");
  });
});
