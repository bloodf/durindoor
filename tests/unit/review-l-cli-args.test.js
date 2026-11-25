import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = fs.readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");

function run(args) {
  const error = vi.fn();
  const context = { args, process: { exit: (code) => { throw { code }; } }, console: { error } };
  const start = source.indexOf("function validateArgs(args) {");
  const end = source.indexOf("\nfunction hasFlag", start);
  const validation = source.slice(start, end);
  try {
    vm.runInNewContext(`${validation}\nvalidateArgs(args)`, context);
    return { error, code: 0 };
  } catch (result) {
    if (result?.code !== undefined) return { error, code: result.code };
    throw result;
  }
}

describe("launcher host and port arguments", () => {
  it.each([["--host"], ["--host", "--headless"], ["-H", "--skip-update"], ["--port"], ["-p", "--host"]])
    ("rejects missing value in %j with exit 2", (...args) => {
      const result = run(args);
      expect(result.code).toBe(2);
      expect(result.error).toHaveBeenCalledOnce();
    });

  it.each([["--port", "0"], ["--port", "65536"], ["--port", "12x"], ["-p", "1.5"]])
    ("rejects invalid port in %j with exit 2", (...args) => {
      const result = run(args);
      expect(result.code).toBe(2);
      expect(result.error).toHaveBeenCalledOnce();
    });

  it.each([["--port", "1"], ["-p", "65535"], ["--host", "localhost"]])
    ("accepts valid argument %j", (...args) => {
      const result = run(args);
      expect(result.code).toBe(0);
      expect(result.error).not.toHaveBeenCalled();
    });
});

it("documents launcher headless and admin commands", () => {
  const docs = fs.readFileSync(new URL("../../docs/reference/cli.mdx", import.meta.url), "utf8");
  expect(docs).toContain("--headless");
  expect(docs).toContain("durindoor admin combos get <id>");
});
