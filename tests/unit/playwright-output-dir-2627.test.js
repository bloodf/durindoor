import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const configURL = new URL("../../website/playwright.config.mjs", import.meta.url).href;

describe("PR 2627 regressions", () => {
  it("keeps Playwright artifacts under the original temporary directory", () => {
    const script = `const {default: config} = await import(${JSON.stringify(configURL)}); console.log(JSON.stringify({ output: config.outputDir, scratch: process.env.TMPDIR }));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }, encoding: "utf8", timeout: 10000,
    });
    expect(result.status, result.stderr).toBe(0);
    const { output, scratch } = JSON.parse(result.stdout.trim());
    expect(path.dirname(output)).toBe(path.join(process.env.TMPDIR, "omc-docs"));
    expect(path.relative(scratch, output).startsWith(".." + path.sep)).toBe(true);
  });

  it("documents OpenAI batch limits once, including the proxy limit", () => {
    const doc = readFileSync(new URL("../../docs/reference/environment.mdx", import.meta.url), "utf8");
    expect(doc.match(/^## OpenAI batch input limits$/gm)).toHaveLength(1);
    expect(doc.split("## OpenAI batch input limits")[1].split("\n## ")[0]).toContain("NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE");
  });
});
