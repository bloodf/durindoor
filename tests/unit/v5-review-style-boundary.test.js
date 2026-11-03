import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import postcss from "postcss";
import { reviewIconStyles } from "../../.storybook/review-style-boundary.mjs";

describe("review icon cascade boundary", () => {
  it.each(["src/app/globals.css", "node_modules/material-symbols/outlined.css"])("layers %s so utility sizes win and preserves the incumbent rule outside review", (path) => {
    const original = postcss.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
    const transformed = postcss.parse(reviewIconStyles(original.toString()));
    let sourceRule, reviewRule, incumbentRule;
    original.walkRules(".material-symbols-outlined", (rule) => { if (rule.nodes.some((node) => node.prop === "font-family")) sourceRule = rule; });
    transformed.walkRules((rule) => {
      if (rule.selector === ".material-symbols-outlined" && rule.parent.type === "atrule" && rule.parent.name === "layer" && rule.parent.params === "base") reviewRule = rule;
      if (rule.selector === ':where(html:not([data-v5-review="true"])) .material-symbols-outlined') incumbentRule = rule;
    });
    expect(reviewRule).toBeTruthy();
    expect(incumbentRule?.parent.type).toBe("root");
    const declarations = (rule) => rule.nodes.map((node) => node.toString());
    expect(declarations(reviewRule)).toEqual(declarations(sourceRule));
    expect(declarations(incumbentRule)).toEqual(declarations(sourceRule));
    expect(sourceRule.nodes.find((node) => node.prop === "font-size").value).toBe("24px");
    const ordinary = (ast) => { const result = []; ast.walkRules((rule) => { if (!rule.selector.includes("material-symbols-outlined")) result.push(rule.toString()); }); return result; };
    expect(ordinary(transformed)).toEqual(ordinary(original));
    const fontFaces = (ast) => { const result = []; ast.walkAtRules("font-face", (rule) => result.push(rule.toString())); return result; };
    expect(fontFaces(transformed)).toEqual(fontFaces(original));
  });

  it("fails clearly when the source icon definition can no longer be recognized", () => {
    expect(() => reviewIconStyles(".material-symbols-outlined { font-size: 24px; }")).toThrow("Material icon base style changed");
  });
});
