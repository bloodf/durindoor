// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Root layout side effects (proxy init, bootstrap, console capture, providers)
// are irrelevant to the switch; stub them so the layout can be called directly.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-inter-var" }) }));
vi.mock("@/lib/network/initOutboundProxy", () => ({}));
vi.mock("@/shared/services/bootstrap", () => ({}));
vi.mock("@/lib/consoleLogBuffer", () => ({ initConsoleLogCapture: () => {} }));
vi.mock("@/shared/components/ThemeProvider", () => ({ ThemeProvider: ({ children }) => children }));
// Provider metadata spawns a child process and needs Node's URL, not the DOM one.
vi.mock("../../.storybook/provider-metadata.mjs", () => ({ createProviderMetadataPlugin: async () => ({ name: "provider-metadata-stub" }) }));
vi.mock("@/i18n/RuntimeI18nProvider", () => ({ RuntimeI18nProvider: ({ children }) => children }));

import RootLayout from "../../src/app/layout.js";
import {
  UI_V5_ATTRIBUTE,
  UI_V5_DEFAULT,
  isUiV5Enabled,
  uiV5RootAttributes,
  useUiV5,
} from "../../src/shared/ui/v5/production/uiVersion.js";
import { setupStoryLifecycle } from "../../.storybook/preview.jsx";

const repo = (...parts) => resolve(__dirname, "../..", ...parts);
const read = (...parts) => readFileSync(repo(...parts), "utf8");

describe("DURINDOOR_UI_V5 resolution", () => {
  it("is off by default and exports the attribute name", () => {
    expect(UI_V5_DEFAULT).toBe(false);
    expect(UI_V5_ATTRIBUTE).toBe("data-ui");
    expect(isUiV5Enabled({})).toBe(false);
  });

  it.each(["1", "true", "on", "TRUE", " On "])("treats %j as on", (value) => {
    expect(isUiV5Enabled({ DURINDOOR_UI_V5: value })).toBe(true);
  });

  it.each(["0", "false", "off", "OFF"])("treats %j as off", (value) => {
    expect(isUiV5Enabled({ DURINDOOR_UI_V5: value })).toBe(false);
  });

  it.each(["", "yes", "2", "garbage", "v5"])("falls back to the default for %j", (value) => {
    expect(isUiV5Enabled({ DURINDOOR_UI_V5: value })).toBe(UI_V5_DEFAULT);
  });

  it("reads process.env when no environment is passed", () => {
    vi.stubEnv("DURINDOOR_UI_V5", "1");
    expect(isUiV5Enabled()).toBe(true);
    vi.stubEnv("DURINDOOR_UI_V5", "0");
    expect(isUiV5Enabled()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("builds root attributes only when on", () => {
    expect(uiV5RootAttributes({ DURINDOOR_UI_V5: "on" })).toEqual({ "data-ui": "v5" });
    expect(uiV5RootAttributes({ DURINDOOR_UI_V5: "off" })).toEqual({});
    expect(uiV5RootAttributes({})).toEqual({});
  });
});

describe("root layout", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function htmlProps() {
    const tree = await RootLayout({ children: React.createElement("main") });
    expect(tree.type).toBe("html");
    return tree.props;
  }

  it("renders data-ui only when the switch is on", async () => {
    vi.stubEnv("DURINDOOR_UI_V5", "1");
    expect((await htmlProps())["data-ui"]).toBe("v5");
    vi.stubEnv("DURINDOOR_UI_V5", "on");
    expect((await htmlProps())["data-ui"]).toBe("v5");
  });

  it("leaves the root element as today when the switch is off or unset", async () => {
    vi.stubEnv("DURINDOOR_UI_V5", "0");
    const off = await htmlProps();
    expect(off).not.toHaveProperty("data-ui");
    vi.stubEnv("DURINDOOR_UI_V5", "");
    expect(await htmlProps()).not.toHaveProperty("data-ui");
    delete process.env.DURINDOOR_UI_V5;
    const unset = await htmlProps();
    expect(unset).not.toHaveProperty("data-ui");
    expect(Object.keys(unset).sort()).toEqual(["children", "dir", "lang", "suppressHydrationWarning"]);
    expect(unset.lang).toBe("en");
  });

  it("imports the token file after the base styles", () => {
    const source = read("src/app/layout.js");
    const globals = source.indexOf('import "./globals.css"');
    const tokens = source.indexOf('import "@/shared/ui/v5/production/v5-tokens.css"');
    expect(globals).toBeGreaterThan(-1);
    expect(tokens).toBeGreaterThan(globals);
  });
});

describe("useUiV5", () => {
  let container;
  let root;

  function Probe() {
    return React.createElement("span", { "data-testid": "probe" }, useUiV5() ? "v5" : "legacy");
  }

  beforeEach(() => {
    document.documentElement.removeAttribute("data-ui");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.removeAttribute("data-ui");
  });

  const label = () => container.querySelector("[data-testid=probe]").textContent;

  it("returns false during server rendering even when a switch is set", () => {
    document.documentElement.dataset.ui = "v5";
    expect(renderToString(React.createElement(Probe))).toContain("legacy");
  });

  it("is false without the attribute", async () => {
    await act(async () => root.render(React.createElement(Probe)));
    expect(label()).toBe("legacy");
  });

  it("is true when the root carries data-ui=v5 and ignores other values", async () => {
    document.documentElement.dataset.ui = "v5";
    await act(async () => root.render(React.createElement(Probe)));
    expect(label()).toBe("v5");
    await act(async () => document.documentElement.setAttribute("data-ui", "other"));
    expect(label()).toBe("legacy");
  });

  it("follows the attribute at runtime in both directions", async () => {
    await act(async () => root.render(React.createElement(Probe)));
    await act(async () => document.documentElement.setAttribute("data-ui", "v5"));
    expect(label()).toBe("v5");
    await act(async () => document.documentElement.removeAttribute("data-ui"));
    expect(label()).toBe("legacy");
  });
});

describe("v5 tokens", () => {
  const tokens = read("src/shared/ui/v5/production/v5-tokens.css");
  const review = read("src/shared/ui/v5/review.css");

  it("declares the light and dark blocks under both selectors", () => {
    expect(tokens).toMatch(/html\[data-ui="v5"\],\s*html\[data-v5-review="true"\]\s*\{/);
    expect(tokens).toMatch(/html\.dark\[data-ui="v5"\],\s*html\.dark\[data-v5-review="true"\]\s*\{/);
  });

  it("carries the forest accent for both themes", () => {
    expect(tokens).toContain("--dd-accent: #17623f;");
    expect(tokens).toContain("--dd-accent: #9cd9b0;");
    expect(tokens).toContain("--dd-on-accent: #132f1e;");
  });

  it("adds no new token names beyond dd and color aliases", () => {
    const names = [...tokens.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(30);
    for (const name of names) expect(name).toMatch(/^--(?:dd|color)-/);
  });

  it("is no longer declared in review.css", () => {
    expect(review).not.toMatch(/--dd-accent\s*:/);
    expect(review).not.toMatch(/--dd-bg\s*:/);
    expect(review).not.toMatch(/--color-primary\s*:/);
  });
});

describe("Storybook wiring", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-ui");
    document.documentElement.removeAttribute("data-v5-review");
  });

  it("imports the tokens after globals.css in the preview", () => {
    const source = read(".storybook/preview.jsx");
    const globals = source.indexOf('import "../src/app/globals.css"');
    const tokens = source.indexOf('import "../src/shared/ui/v5/production/v5-tokens.css"');
    expect(tokens).toBeGreaterThan(globals);
  });

  it("sets both attributes for review stories and restores them on teardown", async () => {
    document.documentElement.dataset.ui = "legacy-marker";
    const dispose = await setupStoryLifecycle({
      globals: {},
      parameters: { v5Review: { source: "x" } },
      canvasElement: document.createElement("div"),
    });
    expect(document.documentElement.dataset.v5Review).toBe("true");
    expect(document.documentElement.dataset.ui).toBe("v5");
    await dispose();
    expect(document.documentElement.dataset.ui).toBe("legacy-marker");
    expect(document.documentElement.hasAttribute("data-v5-review")).toBe(false);
  });

  it("removes data-ui for non-review stories", async () => {
    document.documentElement.dataset.ui = "v5";
    const dispose = await setupStoryLifecycle({ globals: {}, parameters: {}, canvasElement: document.createElement("div") });
    expect(document.documentElement.hasAttribute("data-ui")).toBe(false);
    await dispose();
    expect(document.documentElement.dataset.ui).toBe("v5");
  });

  it("skips files that import uiVersion and still transforms others", async () => {
    const { default: config } = await import("../../.storybook/main.js");
    const merged = await config.viteFinal({});
    const plugin = merged.plugins.find((entry) => entry?.name === "v5-review-control-boundary");
    expect(plugin).toBeTruthy();
    const id = repo("src/app/(dashboard)/dashboard/combos/page.js");

    // Unmigrated: the replacement boundary wraps the page.
    const original = "export default function CombosPage(props) { return null; }\n";
    const wrapped = plugin.transform(original, id);
    expect(wrapped.code).toContain("IncumbentCombosPage");

    // Migrated: the same signature is left untouched and nothing throws.
    const migrated = `import { useUiV5 } from "@/shared/ui/v5/production/uiVersion";\n${original}`;
    expect(plugin.transform(migrated, id)).toBeNull();
    expect(() => plugin.transform(migrated.replace("CombosPage", "Renamed"), id)).not.toThrow();
  });
});
