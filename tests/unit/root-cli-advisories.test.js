import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const appRequire = createRequire(join(root, "package.json"));
const storyRequire = createRequire(appRequire.resolve("@storybook/react-vite"));
// This plugin exposes only an ESM import condition, so require.resolve cannot select it.
const docgenEntry = realpathSync(storyRequire.resolve.paths("@joshwooding/vite-plugin-react-docgen-typescript")
  .map(base => join(base, "@joshwooding/vite-plugin-react-docgen-typescript/dist/index.mjs"))
  .find(file => existsSync(file)));
const docgenRequire = createRequire(docgenEntry);
const eslintRequire = createRequire(appRequire.resolve("eslint-config-next"));
const tsRequire = createRequire(eslintRequire.resolve("typescript-eslint"));
const parserRequire = createRequire(tsRequire.resolve("@typescript-eslint/parser"));
const estree = parserRequire("@typescript-eslint/typescript-estree");
const cliRequire = createRequire(join(root, "cli/package.json"));
const nodemonRequire = createRequire(cliRequire.resolve("nodemon"));
const match = nodemonRequire("./monitor/match");
const temporary = [];
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "durindoor-advisories-"));
  temporary.push(dir);
  return dir;
};
afterEach(() => {
  estree.clearCaches();
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scoped security major compatibility", () => {
  it("docgen's globSync finds components and ignores stories and directories", () => {
    const dir = fixture();
    mkdirSync(join(dir, "nested"));
    mkdirSync(join(dir, "directory.tsx"));
    for (const name of ["Button.tsx", "Button.stories.tsx", "nested/Label.tsx", "notes.txt"]) {
      writeFileSync(join(dir, name), "");
    }
    const { globSync } = docgenRequire("glob");
    expect(globSync("**/*.tsx", {
      absolute: true, cwd: dir, ignore: ["**/*.stories.tsx"], nodir: true,
    }).map(file => file.slice(dir.length + 1)).sort()).toEqual(["Button.tsx", "nested/Label.tsx"]);
  });

  it("the real docgen plugin transforms a component without a tsconfig", async () => {
    const dir = fixture();
    const file = join(dir, "Button.tsx");
    const source = 'export function Button(props: { label: string }) { return null; }';
    writeFileSync(file, source);
    const { default: docgen } = await import(pathToFileURL(docgenEntry).href);
    const plugin = docgen({ fileSystemCache: false });
    const warnings = [];
    const context = { addWatchFile() {}, warn(message) { warnings.push(message); } };
    try {
      await plugin.configResolved({ root: dir, command: "serve" });
      const result = await plugin.transform.call(context, source, file);
      expect(result.code ?? result).toContain("Button.__docgenInfo");
      expect(result.code ?? result).toContain('"label"');
      expect(warnings).toEqual([]);
      expect(await plugin.transform.call(context, source, join(dir, "Button.stories.tsx"))).toBeUndefined();
    } finally { plugin.closeBundle(); }
  }, 30000);

  it("estree allowDefaultProject admits a matching file and rejects a nonmatching file", () => {
    const dir = fixture();
    for (const name of ["allowed.js", "denied.js"]) writeFileSync(join(dir, name), "const value = 1;");
    const options = name => ({
      filePath: join(dir, name), tsconfigRootDir: dir,
      projectService: { allowDefaultProject: ["allowed.js"] },
    });
    const result = estree.parseAndGenerateServices("const value = 1;", options("allowed.js"));
    expect(result.ast.body[0].declarations[0].id.name).toBe("value");
    expect(result.services.program.getSourceFile(join(dir, "allowed.js")).fileName).toBe(join(dir, "allowed.js"));
    expect(() => estree.parseAndGenerateServices("const value = 1;", options("denied.js")))
      .toThrow(/was not found by the project service/);
  }, 30000);

  it("nodemon.match watches JS including dotfiles, excludes ignored and wrong extensions", () => {
    const dir = fixture();
    const files = ["app.js", ".hidden.js", "skip.js", "notes.txt"].map(name => join(dir, name));
    const result = match(files, [join(dir, "**/*"), "!" + join(dir, "skip.js")], "js");
    expect(result.result.sort()).toEqual([join(dir, ".hidden.js"), join(dir, "app.js")]);
    expect(result.total).toBe(4);
  });
});
