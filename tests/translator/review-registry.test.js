import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "./registerAll.js";
import { requestRegistry, responseRegistry } from "../../open-sse/translator/registry.js";

describe("translator registry structure", () => {
  it("does not import the translator index", () => {
    const source = readFileSync(resolve(process.cwd(), "../open-sse/translator/registry.js"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*index\.js["']/);
  });

  it("preserves every registered format pair", () => {
    const actualPairs = [...new Set([...requestRegistry.keys(), ...responseRegistry.keys()])].sort();
    expect(actualPairs).toEqual([
      "antigravity:openai",
      "claude:gemini",
      "claude:kiro",
      "claude:openai",
      "commandcode:openai",
      "cursor:openai",
      "gemini-cli:openai",
      "gemini:claude",
      "gemini:openai",
      "kiro:claude",
      "kiro:openai",
      "ollama:openai",
      "openai-responses:openai",
      "openai:antigravity",
      "openai:claude",
      "openai:commandcode",
      "openai:cursor",
      "openai:gemini",
      "openai:gemini-cli",
      "openai:kiro",
      "openai:ollama",
      "openai:openai-responses",
      "openai:vertex",
      "vertex:openai",
    ]);
  });
});
