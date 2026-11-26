// Docs navigation contrast (#2651).
//
// The dark-theme axe failure on the #nd-subnav "DurinDoor" link came from
// animated theme swaps: the link and the subnav surface interpolated between
// the parchment and forest palettes, and axe sampled the blend. These checks
// read website/src/app/docs/docs.css offline and pin both halves of the fix:
// the settled palettes are readable, and theme swaps cannot show the blend.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const css = readFileSync(path.join(root, "website/src/app/docs/docs.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

// Top-level rule bodies keyed by exact selector text.
function rules(source) {
  const out = new Map();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(re)) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    out.set(selector, (out.get(selector) || "") + match[2]);
  }
  return out;
}

function declarations(body) {
  const out = {};
  for (const part of body.split(";")) {
    const index = part.indexOf(":");
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = part.slice(index + 1).trim().replace(/\s+/g, " ");
  }
  return out;
}

const all = rules(css);
const light = declarations(all.get(".dd-docs"));
const dark = { ...light, ...declarations(all.get(".dark .dd-docs")) };

function rgb(hex) {
  const value = hex.replace("#", "");
  expect(value, hex).toMatch(/^[0-9a-f]{6}$/i);
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a, b, t) {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, "0")).join("")}`;
}

describe("docs navigation contrast", () => {
  it("keeps the subnav on the surface token and the brand link on the text token", () => {
    const subnav = declarations(all.get(".dd-docs #nd-subnav"));
    expect(subnav.background).toBe("var(--dd-surface)");
    expect(subnav["backdrop-filter"]).toBe("none");
    expect(light["--color-fd-foreground"]).toBe("var(--dd-text)");
    expect(light["--color-fd-muted-foreground"]).toBe("var(--dd-text-muted)");
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("settled %s nav labels meet WCAG AA on every docs surface", (_theme, tokens) => {
    for (const fg of ["--dd-text", "--dd-text-muted", "--dd-accent"]) {
      for (const bg of ["--dd-bg", "--dd-surface", "--dd-surface-2"]) {
        expect(contrast(tokens[fg], tokens[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("would fail mid-transition, which is why theme swaps must not animate", () => {
    // Text and surface tween at different rates (160ms vs 150ms, plus the
    // class flip landing between frames). The same 30%/90% blend the browser
    // reported (#5d635d on #131e17) is unreadable, proving the guard matters.
    const fg = mix(light["--dd-text"], dark["--dd-text"], 0.3);
    const bg = mix(light["--dd-surface"], dark["--dd-surface"], 0.98);
    expect(contrast(fg, bg)).toBeLessThan(4.5);
  });

  it("does not animate docs control and chrome colors in any interaction state", () => {
    const guard = ".dd-docs :is(a, button, .transition-colors)";
    expect(declarations(all.get(guard)).transition).toBe("none");
    for (const [selector, body] of all) {
      const decl = declarations(body);
      const value = `${decl.transition || ""} ${decl["transition-property"] || ""}`;
      if (!/(^|[\s,])(color|background-color|background|border-color|all)\b/.test(value)) continue;
      expect(selector, `${selector} animates docs colors`).toBe(guard);
    }
  });

});
