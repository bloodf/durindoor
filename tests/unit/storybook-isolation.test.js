// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { setupStoryScope } from "../../.storybook/decorators.jsx";
import { usePathname, useSearchParams } from "../../.storybook/next-navigation.js";
import ThemeToggle from "../../src/shared/components/ThemeToggle.js";
import useThemeStore from "../../src/store/themeStore.js";
import { setupStoryLifecycle } from "../../.storybook/preview.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function context({ globals = {}, fixture } = {}) {
  return {
    globals,
    parameters: fixture === undefined ? {} : { storyFixture: fixture },
  };
}

function RouteProbe() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return React.createElement("div", { "data-testid": "route" }, `${pathname}?${search}`);
}

function ConnectionsProbe() {
  const [connections, setConnections] = useState();

  useEffect(() => {
    fetch("/api/providers")
      .then((response) => response.json())
      .then((data) => setConnections(data.connections));
  }, []);

  if (connections === undefined) return React.createElement("div", null, "Loading connections");
  if (connections.length === 0) return React.createElement("div", null, "No provider connections");
  return React.createElement("div", null, connections.map((connection) => connection.name).join(", "));
}

async function renderProbe(Probe, selector) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Probe)));
  await act(async () => {});
  const text = container.querySelector(selector).textContent;
  await act(async () => root.unmount());
  container.remove();
  return text;
}

async function renderRouteProbe() {
  return renderProbe(RouteProbe, '[data-testid="route"]');
}

async function renderConnectionsProbe() {
  return renderProbe(ConnectionsProbe, "div");
}

describe("Storybook story scope lifecycle", () => {
  let teardown;
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    if (teardown) await teardown();
    teardown = undefined;
  });

  beforeEach(() => {
    document.documentElement.lang = "";
    document.documentElement.removeAttribute("dir");
  });

  it("applies real SB3 DOM/router/network scope for the active story, then fully restores it on cleanup", async () => {
    teardown = await setupStoryScope(
      context({
        globals: { locale: "en", pathname: "/" },
        fixture: { scenario: "providers", locale: "ar", pathname: "/dashboard/providers?tab=keys" },
      })
    );

    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    await expect(renderRouteProbe()).resolves.toBe("/dashboard/providers?tab=keys");
    await expect(renderConnectionsProbe()).resolves.toBe("Fixture Provider");

    await teardown();
    teardown = undefined;

    expect(document.documentElement.lang).toBe("");
    expect(document.documentElement.hasAttribute("dir")).toBe(false);
    expect(globalThis.fetch).toBe(originalFetch);
    expect(() => useSearchParams()).toThrow(/used before setupStoryFixture/);
  });

  it("keeps Story A-B-A DOM, router, and network state isolated", async () => {
    teardown = await setupStoryScope(
      context({ fixture: { scenario: "providers", locale: "he", pathname: "/dashboard/providers" } })
    );
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    await expect(renderRouteProbe()).resolves.toBe("/dashboard/providers?");
    await expect(renderConnectionsProbe()).resolves.toBe("Fixture Provider");
    await teardown();
    teardown = undefined;

    teardown = await setupStoryScope(
      context({ fixture: { scenario: "empty", locale: "en", pathname: "/dashboard/usage" } })
    );
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    await expect(renderRouteProbe()).resolves.toBe("/dashboard/usage?");
    await expect(renderConnectionsProbe()).resolves.toBe("No provider connections");
    await teardown();
    teardown = undefined;

    teardown = await setupStoryScope(
      context({ fixture: { scenario: "providers", locale: "he", pathname: "/dashboard/providers" } })
    );
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    await expect(renderRouteProbe()).resolves.toBe("/dashboard/providers?");
    await expect(renderConnectionsProbe()).resolves.toBe("Fixture Provider");
  });

  it("restores the real network boundary after a story render throws, so the next story gets a clean fixture", async () => {
    teardown = await setupStoryScope(
      context({ fixture: { scenario: "providers", locale: "en", pathname: "/dashboard/providers" } })
    );
    expect(globalThis.fetch).not.toBe(originalFetch);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function ThrowingStory() {
      throw new Error("story render failed");
    }

    await expect(
      (async () => {
        try {
          await act(async () => root.render(React.createElement(ThrowingStory)));
        } finally {
          await act(async () => root.unmount());
          container.remove();
          await teardown();
          teardown = undefined;
        }
      })()
    ).rejects.toThrow("story render failed");

    expect(globalThis.fetch).toBe(originalFetch);

    teardown = await setupStoryScope(
      context({ fixture: { scenario: "default", locale: "en", pathname: "/dashboard/usage" } })
    );
    await expect(renderConnectionsProbe()).resolves.toBe("No provider connections");
  });

  it("propagates a real SB3 fixture-setup failure so Storybook blocks the story render, without leaking scope into the next one", async () => {
    await expect(
      setupStoryScope(context({ fixture: { scenario: "not-a-real-scenario" } }))
    ).rejects.toThrow(/Unknown Storybook fixture scenario/);

    teardown = await setupStoryScope(
      context({ fixture: { scenario: "default", locale: "en", pathname: "/dashboard/usage" } })
    );
    expect(document.documentElement.lang).toBe("en");
    await expect(renderConnectionsProbe()).resolves.toBe("No provider connections");
  });
});

describe("Storybook theme scope lifecycle", () => {
  const storageKey = "theme";
  const storedTheme = JSON.stringify({ state: { theme: "system" }, version: 0 });
  let teardown;

  beforeEach(() => {
    useThemeStore.getState().setTheme("system");
    localStorage.setItem(storageKey, storedTheme);
  });

  afterEach(async () => {
    if (teardown) await teardown();
    teardown = undefined;
    useThemeStore.getState().setTheme("system");
    localStorage.removeItem(storageKey);
  });

  it("keeps real ThemeToggle, DOM, store, and persisted state isolated A-B-A", async () => {
    teardown = await setupStoryLifecycle(context({ globals: { theme: "dark" } }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(React.createElement(ThemeToggle)));

    const button = container.querySelector("button");
    expect(button.getAttribute("aria-label")).toBe("Switch to light mode");
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await act(async () => button.click());
    expect(useThemeStore.getState().theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await act(async () => root.unmount());
    container.remove();
    await teardown();
    teardown = undefined;
    expect(useThemeStore.getState().theme).toBe("system");
    expect(localStorage.getItem(storageKey)).toBe(storedTheme);

    teardown = await setupStoryLifecycle(context({ globals: { theme: "light" } }));
    expect(useThemeStore.getState().theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await teardown();
    teardown = undefined;
    expect(localStorage.getItem(storageKey)).toBe(storedTheme);

    teardown = await setupStoryLifecycle(context({ globals: { theme: "dark" } }));
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await teardown();
    teardown = undefined;
    expect(useThemeStore.getState().theme).toBe("system");
    expect(localStorage.getItem(storageKey)).toBe(storedTheme);
  });
});
