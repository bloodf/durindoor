import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const tokenPath = fileURLToPath(
  new URL("../../src/shared/ui/tokens.css", import.meta.url),
);
const tokenCss = readFileSync(tokenPath, "utf8");

/** Read a theme's published solid color custom property. */
function themeColor(theme, token) {
  const selector = theme === "light" ? ":root" : ".dark";
  const block = tokenCss.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  const value = block?.match(new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
  if (!value) throw new Error(`Missing solid ${token} in ${selector}`);
  return value;
}

/** Convert one published #RRGGBB color into WCAG relative luminance. */
function luminance(hex) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) throw new TypeError(`Expected #RRGGBB, got ${hex}`);
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Calculate WCAG contrast ratio for two published solid colors. */
function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const surfaces = ["--dd-bg", "--dd-bg-alt", "--dd-surface", "--dd-surface-2", "--dd-surface-3"];
const readingRoles = [
  "--dd-text",
  "--dd-text-muted",
  "--dd-text-subtle",
  "--dd-success",
  "--dd-warning",
  "--dd-danger",
  "--dd-danger-hover",
  "--dd-info",
  "--dd-accent",
  "--dd-accent-hover",
];

describe("Durin DS contrast tokens", () => {
  it.each(["light", "dark"])("keeps published %s reading roles above 7:1 on every surface", (theme) => {
    for (const role of readingRoles) {
      for (const surface of surfaces) {
        expect(
          contrast(themeColor(theme, role), themeColor(theme, surface)),
          `${theme} ${role} on ${surface}`,
        ).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it.each(["light", "dark"])("keeps the %s focus ring at least 3:1 against every surface it can land on", (theme) => {
    for (const surface of surfaces) {
      expect(
        contrast(themeColor(theme, "--dd-focus-ring"), themeColor(theme, surface)),
        `${theme} focus ring on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(["light", "dark"])("keeps actual primary and danger action states above 7:1", (theme) => {
    for (const background of ["--dd-accent", "--dd-accent-hover"]) {
      expect(contrast(themeColor(theme, "--dd-on-accent"), themeColor(theme, background))).toBeGreaterThanOrEqual(7);
    }
    for (const background of ["--dd-danger-action", "--dd-danger-action-hover"]) {
      expect(contrast(themeColor(theme, "--dd-on-danger"), themeColor(theme, background))).toBeGreaterThanOrEqual(7);
    }
  });

  it("rejects malformed published colors rather than accepting an invalid boundary", () => {
    expect(() => contrast("#fff", "#000000")).toThrow("Expected #RRGGBB");
  });
});

describe("Durin DS published token mappings", () => {
  it("maps every theme dd token to a raw root definition", () => {
    const theme = tokenCss.match(/@theme inline\s*\{([\s\S]*?)\n\}/)?.[1];
    const root = tokenCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1];
    const dark = tokenCss.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1];
    const definitions = `${root}\n${dark}`;
    const references = [...(theme?.matchAll(/var\((--dd-[\w-]+)\)/g) ?? [])].map((match) => match[1]);

    expect(references).not.toHaveLength(0);
    for (const token of references) {
      expect(definitions, `${token} mapped by @theme inline`).toMatch(new RegExp(`${token}:\\s*[^;]+;`));
    }
  });
});

const cliToolCardsDirectory = fileURLToPath(
  new URL("../../src/app/(dashboard)/dashboard/cli-tools/components", import.meta.url),
);

/** Every className string literal in one source file. */
function classLists(source) {
  return [...source.matchAll(/className\s*=\s*(?:\{\s*)?(["'`])([\s\S]*?)\1/g)].map((match) => match[2]);
}

/**
 * The AAA defect axe caught: an `!important` translucent Durin DS fill stacked
 * on an already-tinted panel composited to #5a5031, dropping #FFE07A text to
 * 6.16:1. A plain (non-important) `/10` tint is fine — it measures 7.62:1 or
 * better — so only the important-override form is forbidden here.
 */
function hasImportantTranslucentComposite(classes) {
  return /(?:^|\s)!bg-dd-[\w-]+\/\d+(?=\s|$)/.test(classes)
    && /(?:^|\s)!?text-dd-[\w-]+(?=\s|$)/.test(classes);
}

describe("CLI tool-card contrast", () => {
  it("does not reintroduce a translucent Durin DS background under a Durin DS text color", () => {
    const violations = [];
    for (const file of readdirSync(cliToolCardsDirectory).filter((name) => name.endsWith(".js"))) {
      for (const classes of classLists(readFileSync(join(cliToolCardsDirectory, file), "utf8"))) {
        if (hasImportantTranslucentComposite(classes)) violations.push(`${file}: ${classes}`);
      }
    }
    expect(violations, `Important translucent Durin DS background under Durin DS text:\n${violations.join("\n")}`).toEqual([]);
  });
});

/** Composite a translucent fill over an opaque surface, both #RRGGBB. */
function composite(fill, surface, alpha) {
  const channels = [1, 3, 5].map((offset) => {
    const top = Number.parseInt(fill.slice(offset, offset + 2), 16);
    const bottom = Number.parseInt(surface.slice(offset, offset + 2), 16);
    return Math.round(top * alpha + bottom * (1 - alpha));
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** Every chart that paints a translucent area fill under its axis labels. */
const chartSources = [
  "src/app/(dashboard)/dashboard/usage/components/UsageChart.js",
  "src/app/(dashboard)/dashboard/token-saver/components/TokenSaverOverview.js",
  "src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.js",
  "src/shared/ui/pages/console-log/ConsoleLogPage.jsx",
  "src/shared/ui/pages/timeline/TimelinePage.jsx",
  "src/shared/ui/pages/token-saver/TokenSaverStatsPage.jsx",
  "src/shared/ui/pages/headroom/HeadroomPage.jsx",
];

describe("chart axis label contrast", () => {
  // Axis ticks can sit over the area gradient rather than the plain surface.
  // axe cannot measure SVG text at all (dequelabs/axe-core#1819), so no browser
  // gate catches this; at a 0.28 fill the ticks measured 5.08:1 in dark, under
  // the 7:1 AAA floor for 11px text.
  it("keeps every tick color above 7:1 over its own area fill in both themes", () => {
    const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
    const tickTokens = ["--dd-text-subtle", "--dd-text-muted"];
    const failures = [];
    let checked = 0;
    for (const relativePath of chartSources) {
      const source = readFileSync(join(repoRoot, relativePath), "utf8");
      const alphas = [...source.matchAll(/stopOpacity=\{([\d.]+)\}/g)].map((match) => Number(match[1]));
      const fills = [...new Set([...source.matchAll(/stopColor="var\((--dd-[\w-]+)\)"/g)].map((match) => match[1]))];
      expect(alphas.length, `${relativePath}: no area fill opacities found`).toBeGreaterThan(0);
      expect(fills.length, `${relativePath}: no area fill colors found`).toBeGreaterThan(0);
      const alpha = Math.max(...alphas);
      for (const theme of ["light", "dark"]) {
        for (const fill of fills) {
          for (const tick of tickTokens) {
            const ratio = contrast(themeColor(theme, tick), composite(themeColor(theme, fill), themeColor(theme, "--dd-surface"), alpha));
            checked += 1;
            if (ratio < 7) failures.push(`${relativePath} ${theme} ${tick} over ${fill} @${alpha}: ${ratio.toFixed(2)}:1`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(failures, `Chart tick text below AAA over its own area fill:\n${failures.join("\n")}`).toEqual([]);
  });
});

describe("editor token contrast", () => {
  // Monaco's stock palettes were never held to this dashboard's AAA bar: on the
  // editor surface, dark strings measure 6.15:1, keywords 5.52:1 and comments
  // 4.88:1, and axe reports those as real color-contrast-enhanced violations on
  // the rendered `.mtk*` spans.
  it("keeps every syntax token above 7:1 on the editor surface in both themes", async () => {
    const { EDITOR_SURFACE, EDITOR_TOKENS } = await import("../../src/shared/ui/editorTheme.js");
    const failures = [];
    let checked = 0;
    for (const theme of ["dark", "light"]) {
      for (const [name, colour] of Object.entries(EDITOR_TOKENS[theme])) {
        const ratio = contrast(colour, EDITOR_SURFACE[theme]);
        checked += 1;
        if (ratio < 7) failures.push(`${theme} ${name} ${colour} on ${EDITOR_SURFACE[theme]}: ${ratio.toFixed(2)}:1`);
      }
    }
    expect(checked).toBe(12);
    expect(failures, `Editor syntax token below AAA:\n${failures.join("\n")}`).toEqual([]);
  });

  it("paints the editor on the surface the tokens were measured against", async () => {
    const { EDITOR_SURFACE, EDITOR_THEMES } = await import("../../src/shared/ui/editorTheme.js");
    expect(EDITOR_THEMES["durin-dark"].colors["editor.background"]).toBe(EDITOR_SURFACE.dark);
    expect(EDITOR_THEMES["durin-light"].colors["editor.background"]).toBe(EDITOR_SURFACE.light);
    // The surface must stay in step with the DS token the editor sits on.
    expect(EDITOR_SURFACE.dark).toBe(themeColor("dark", "--dd-surface-2"));
    expect(EDITOR_SURFACE.light).toBe(themeColor("light", "--dd-surface-2"));
  });
});
