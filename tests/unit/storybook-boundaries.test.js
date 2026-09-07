// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within } from "@testing-library/dom";
import { Request as NativeRequest } from "undici";
import { GITHUB_CONFIG } from "../../src/shared/constants/config.js";

// Hoist the next/navigation mock so React's hooks resolve to fixture adapter.
vi.mock("next/navigation", async () => import("../../.storybook/next-navigation.js"));

import { setupStoryFixture, STORY_FIXTURE_SCENARIOS } from "../../.storybook/fixtures.js";
import {
  installStoryNetwork,
  STORY_FIXTURE_USAGE_MODEL,
  STORY_FIXTURE_USAGE_MODEL_STATS_KEY,
  STORY_FIXTURE_USAGE_ACCOUNT_NAME,
  STORY_FIXTURE_USAGE_ACCOUNT_STATS_KEY,
  STORY_FIXTURE_USAGE_PROVIDER_DISPLAY,
} from "../../.storybook/network.js";
import {
  installStoryNavigation,
  useParams,
  usePathname,
  useSearchParams,
  useSelectedLayoutSegments,
} from "../../.storybook/next-navigation.js";
import StorybookImage from "../../.storybook/next-image.jsx";
import UsageStats from "../../src/shared/components/UsageStats.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let originalFetch;
let OriginalEventSource;
let originalNavigation;

describe("Storybook safe-dependency boundaries (SB3)", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    OriginalEventSource = globalThis.EventSource;
    originalNavigation = globalThis.__STORYBOOK_NAV__;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = OriginalEventSource;
    if (originalNavigation) globalThis.__STORYBOOK_NAV__ = originalNavigation;
    else delete globalThis.__STORYBOOK_NAV__;
    vi.unstubAllGlobals();
  });

  it("rejects unknown scenarios so stories cannot pick a permissive no-op", async () => {
    expect(STORY_FIXTURE_SCENARIOS).toEqual(expect.arrayContaining(["default", "providers", "empty", "error", "usage-stream", "actualUsageStats"]));
    await expect(setupStoryFixture({ scenario: "nope" })).rejects.toThrow(/Unknown Storybook fixture scenario/);
  });

  it("rejects known paths from external origins and wrong methods", async () => {
    const cleanup = installStoryNetwork({ scenario: "providers" });
    try {
      await expect(fetch("https://external.example/api/providers")).rejects.toThrow(/Unexpected Storybook network request/);
      await expect(fetch("/api/providers", { method: "POST" })).rejects.toThrow(/Unexpected Storybook network request/);
      expect((await fetch("/api/providers")).status).toBe(200);
    } finally {
      await cleanup();
    }
  });

  it("does not treat API-shaped image paths as local assets", async () => {
    const passthrough = vi.fn(async () => new Response("ok"));
    globalThis.fetch = passthrough;
    const cleanup = installStoryNetwork({ scenario: "default" });
    try {
      await expect(fetch("/api/foo.png")).rejects.toThrow(/Unexpected Storybook network request/);
      await fetch("/fonts/Inter-Regular.woff2");
      expect(passthrough).toHaveBeenCalledOnce();
    } finally {
      await cleanup();
    }
  });
  it("renders local provider and brand assets without an image optimizer request", () => {
    expect(StorybookImage({ src: "/providers/claude.png", alt: "Claude" }).props.src).toBe("/providers/claude.png");
    expect(StorybookImage({ src: "/icons/icon-512.png", alt: "DurinDoor" }).props.src).toBe("/icons/icon-512.png");
    expect(() => StorybookImage({ src: "https://external.example/providers/claude.png", alt: "Claude" })).toThrow();
    expect(() => StorybookImage({ src: "/api/image.png", alt: "API" })).toThrow();
  });

  it("returns production-shaped SSE data on /api/usage/stream with array/pending-map and finite EventSource cleanup", async () => {
    const hostHref = globalThis.location.href;
    const cleanup = installStoryNetwork({ scenario: "actualUsageStats" });
    try {
      const response = await fetch("/api/usage/stream?period=today");
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const text = await response.text();
      const data = JSON.parse(text.replace(/^data: /, "").replace(/\n\n$/, ""));
      expect(Array.isArray(data.activeRequests)).toBe(true);
      expect(Array.isArray(data.activeSessions)).toBe(true);
      expect(data.pending && typeof data.pending === "object").toBe(true);
      expect(data.pending.byModel && typeof data.pending.byModel === "object").toBe(true);
      expect(data.pending.byAccount && typeof data.pending.byAccount === "object").toBe(true);
      expect(typeof data.totalRequests).toBe("number");

    } finally {
      await cleanup();
    }
    expect(globalThis.location.href).toBe(hostHref);
  });

  it("cleanup cancels scheduled EventSource messages", async () => {
    const cleanup = installStoryNetwork({ scenario: "actualUsageStats" });
    const messages = [];
    const source = new EventSource("/api/usage/stream");
    source.onmessage = (event) => messages.push(event.data);
    await cleanup();
    await flush();
    expect(source.readyState).toBe(2);
    expect(messages).toEqual([]);
  });
  it("rolls back document and installed network mutations after partial setup failure", async () => {
    document.documentElement.lang = "fr";
    document.documentElement.removeAttribute("dir");
    const cookieDenied = new Error("cookie denied");
    const descriptor = Object.getOwnPropertyDescriptor(document, "cookie");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: () => { throw cookieDenied; },
    });
    try {
      await expect(setupStoryFixture({ locale: "ar" })).rejects.toBe(cookieDenied);
      expect(document.documentElement.lang).toBe("fr");
      expect(document.documentElement.hasAttribute("dir")).toBe(false);
      expect(globalThis.fetch).toBe(originalFetch);
      expect(globalThis.EventSource).toBe(OriginalEventSource);
    } finally {
      if (descriptor) Object.defineProperty(document, "cookie", descriptor);
      else delete document.cookie;
    }
  });

  it("restores fetch, EventSource, navigation, locale and direction on cleanup", async () => {
    const hostHref = globalThis.location.href;
    document.documentElement.lang = "en";
    document.documentElement.setAttribute("dir", "ltr");
    const fixture = await setupStoryFixture({ scenario: "default", locale: "ar", pathname: "/x?y=1" });
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    await fixture.cleanup();
    expect(globalThis.fetch).toBe(originalFetch);
    expect(globalThis.EventSource).toBe(OriginalEventSource);
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(globalThis.location.href).toBe(hostHref);
  });

  it("refuses external next/image sources instead of starting optimizer/CDN traffic", () => {
    expect(() => StorybookImage({ src: "https://cdn.example.com/foo.png", alt: "" })).toThrow();
  });

  it("renders the actual UsageStats consumer without crash using the actualUsageStats scenario and a virtual navigation fixture", async () => {
    const hostHref = globalThis.location.href;
    const networkCleanup = installStoryNetwork({ scenario: "actualUsageStats" });
    const navCleanup = installStoryNavigation({ pathname: "/dashboard/usage" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(React.createElement(UsageStats)); });
      await flush();
      // Model is default table. Account data is observable only after selecting
      // its actual table view, proving both production data branches render.
      expect(container.textContent).toContain(STORY_FIXTURE_USAGE_MODEL);
      expect(container.textContent).toContain(STORY_FIXTURE_USAGE_PROVIDER_DISPLAY);
      expect(container.textContent).not.toContain(STORY_FIXTURE_USAGE_ACCOUNT_NAME);
      const tableView = within(container).getByRole("combobox", { name: "Usage grouping" });
      await act(async () => { tableView.click(); });
      await act(async () => { within(document.body).getByRole("option", { name: "Usage by Account" }).click(); });
      expect(container.textContent).toContain(STORY_FIXTURE_USAGE_ACCOUNT_NAME);
    } finally {
      await act(async () => { root.unmount(); });
      await navCleanup();
      await networkCleanup();
      container.remove();
    }
    // Host window.location is the Storybook manager URL — fixture must never
    // touch it. Original URL is preserved across setup, render, and cleanup.
    expect(globalThis.location.href).toBe(hostHref);
  });

  it("virtual navigation observable updates usePathname/useSearchParams without mutating host URL (A-B-A cleanup cycle)", async () => {
    const hostHref = globalThis.location.href;
    const navCleanup = installStoryNavigation({ pathname: "/a" });
    try {
      // A: mount, capture initial observable state.
      const aContainer = document.createElement("div");
      document.body.appendChild(aContainer);
      const aRoot = createRoot(aContainer);
      function ObsA() {
        const path = usePathname();
        const search = useSearchParams();
        return React.createElement("span", null, `${path}|${search.get("z") ?? ""}`);
      }
      await act(async () => { aRoot.render(React.createElement(ObsA)); });
      expect(aContainer.querySelector("span").textContent).toBe("/a|");
      // B: replace pathname + query, observe virtual update.
      const nav = globalThis.__STORYBOOK_NAV__;
      await act(async () => { nav.useRouter().push("/b?z=fixture"); });
      expect(aContainer.querySelector("span").textContent).toBe("/b|fixture");
      // A: back via virtual history returns to /a without writing host URL.
      await act(async () => { nav.useRouter().back(); });
      expect(aContainer.querySelector("span").textContent).toBe("/a|");
      await act(async () => { aRoot.unmount(); });
      aContainer.remove();
    } finally {
      await navCleanup();
    }
    expect(globalThis.location.href).toBe(hostHref);
  });
  it("routes override isolates per-installation without mutating a chosen scenario", async () => {
    const defaultCleanup = installStoryNetwork({
      scenario: "default",
      routes: { "GET /api/scenario-only": { body: { from: "default-override" } } },
    });
    try {
      expect(await (await fetch("/api/scenario-only")).json()).toEqual({ from: "default-override" });
    } finally {
      await defaultCleanup();
    }

    const providersCleanup = installStoryNetwork({
      scenario: "providers",
      routes: { "GET /api/scenario-only": { body: { from: "providers-override" } } },
    });
    try {
      expect(await (await fetch("/api/scenario-only")).json()).toEqual({ from: "providers-override" });
    } finally {
      await providersCleanup();
    }

    const untouchedCleanup = installStoryNetwork({ scenario: "default" });
    try {
      await expect(fetch("/api/scenario-only")).rejects.toThrow(/Unexpected Storybook network request/);
    } finally {
      await untouchedCleanup();
    }
  });

  it("rejects unknown API and external origins with routes override installed", async () => {
    const cleanup = installStoryNetwork({ scenario: "default", routes: { "GET /api/x": { body: {} } } });
    try {
      await expect(fetch("https://external.example/api/x")).rejects.toThrow(/Unexpected Storybook network request/);
      await expect(fetch("/api/unknown")).rejects.toThrow(/Unexpected Storybook network request/);
      const res = await fetch("/api/x");
      expect(res.status).toBe(200);
    } finally {
      await cleanup();
    }
  });

  it("descriptor function receives a native Request honoring fetch(input, init) overrides", async () => {
    // happy-dom's Request ignores init.body when input is another Request.
    vi.stubGlobal("Request", NativeRequest);
    const seen = [];
    const cleanup = installStoryNetwork({
      scenario: "default",
      routes: {
        "POST /api/stateful": async (req) => {
          seen.push({ isRequest: req instanceof Request, pathname: req.pathname, method: req.method, contentType: req.headers.get("content-type"), body: await req.text() });
          return { body: { received: true, at: seen.length } };
        },
      },
    });
    try {
      const original = new Request(new URL("/api/stateful", globalThis.location.origin).href, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ original: true }) });
      const res = await fetch(original, { headers: { "content-type": "application/json" }, body: JSON.stringify({ overridden: true }) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, at: 1 });
      expect(seen[0]).toEqual({ isRequest: true, pathname: "/api/stateful", method: "POST", contentType: "application/json", body: JSON.stringify({ overridden: true }) });

      const last = await fetch("/api/stateful", { method: "POST", body: JSON.stringify({ z: 3 }) });
      expect(await last.json()).toEqual({ received: true, at: 2 });
      expect(seen[1].isRequest).toBe(true);
      expect(seen[1].body).toEqual(JSON.stringify({ z: 3 }));
    } finally {
      await cleanup();
    }
  });

  it("rejects external EventSource even when a matching route is registered", async () => {
    const cleanup = installStoryNetwork({ scenario: "default", routes: { "GET /api/external-ok": { events: [] } } });
    try {
      expect(() => new EventSource("https://external.example/api/external-ok")).toThrow(/Unexpected Storybook EventSource/);
      const source = new EventSource("/api/external-ok");
      expect(source.readyState).toBe(EventSource.CONNECTING);
      source.close();
    } finally {
      await cleanup();
    }
  });

  it("serves only exact external fixtures in memory without calling original fetch and routes through setupStoryFixture", async () => {
    const passthrough = vi.fn(async () => new Response("network"));
    globalThis.fetch = passthrough;
    const cleanup = installStoryNetwork({
      scenario: "default",
      externalFixtures: { [`GET ${GITHUB_CONFIG.changelogUrl}`]: { body: "# Fixture changelog", contentType: "text/markdown" } },
    });
    try {
      const response = await fetch(GITHUB_CONFIG.changelogUrl);
      expect(response.headers.get("content-type")).toContain("text/markdown");
      expect(await response.text()).toBe("# Fixture changelog");
      await expect(fetch("https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/OTHER.md")).rejects.toThrow(/Unexpected Storybook network request/);
      expect(passthrough).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }

    const setupPassthrough = vi.fn(async () => new Response("network"));
    globalThis.fetch = setupPassthrough;
    const fixture = await setupStoryFixture({
      scenario: "default",
      externalFixtures: { [`GET ${GITHUB_CONFIG.changelogUrl}`]: { body: "# Setup changelog", contentType: "text/markdown" } },
    });
    try {
      const response = await fetch(GITHUB_CONFIG.changelogUrl);
      expect(response.headers.get("content-type")).toContain("text/markdown");
      expect(await response.text()).toBe("# Setup changelog");
      expect(setupPassthrough).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it("routes override network cleanup restores globalThis.fetch and EventSource", async () => {
    const cleanup = installStoryNetwork({ scenario: "default", routes: { "GET /api/y": { body: { ok: true } } } });
    expect(globalThis.fetch).not.toBe(originalFetch);
    expect(globalThis.EventSource).not.toBe(OriginalEventSource);
    await cleanup();
    expect(globalThis.fetch).toBe(originalFetch);
    expect(globalThis.EventSource).toBe(OriginalEventSource);
  });

  it("setupStoryFixture forwards params and selectedLayoutSegments to navigation; cleanup restores prior navigation", async () => {
    const fixture = await setupStoryFixture({
      scenario: "default",
      params: { id: "42", tab: "models" },
      selectedLayoutSegments: ["dashboard", "usage"],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function NavObserver() {
      const params = useParams();
      const segments = useSelectedLayoutSegments();
      return React.createElement("span", { "data-testid": "nav" }, `${params.id}|${params.tab}|${segments.join(",")}`);
    }
    let observed;
    try {
      await act(async () => { root.render(React.createElement(NavObserver)); });
      observed = container.querySelector("[data-testid='nav']")?.textContent;
      expect(observed).toBe("42|models|dashboard,usage");
      await act(async () => { root.unmount(); });
      container.remove();
    } finally {
      await fixture.cleanup();
    }
    if (originalNavigation) expect(globalThis.__STORYBOOK_NAV__).toBe(originalNavigation);
    else expect(globalThis.__STORYBOOK_NAV__).toBeUndefined();
  });

  it("rejects malformed routes override and externalFixtures (non-plain-object, invalid descriptor shapes) at its boundary", async () => {
    expect(() => installStoryNetwork({ scenario: "default", routes: [] })).toThrow(/must be a plain object/);
    expect(() => installStoryNetwork({ scenario: "default", routes: "nope" })).toThrow(/must be a plain object/);
    expect(() => installStoryNetwork({ scenario: "default", routes: 42 })).toThrow(/must be a plain object/);
    expect(() => installStoryNetwork({ scenario: "default", externalFixtures: [] })).toThrow(/must be a plain object/);
    expect(() => installStoryNetwork({ scenario: "default", externalFixtures: "nope" })).toThrow(/must be a plain object/);
    const arrayCleanup = installStoryNetwork({ scenario: "default", routes: { "GET /api/bad": [] } });
    try { await expect(fetch("/api/bad")).rejects.toThrow(/fixture descriptor must return/); } finally { await arrayCleanup(); }
    const badStatusCleanup = installStoryNetwork({ scenario: "default", routes: { "GET /api/bad-status": { body: {}, status: "ok" } } });
    try { await expect(fetch("/api/bad-status")).rejects.toThrow(/fixture descriptor must return/); } finally { await badStatusCleanup(); }
    const badEventsCleanup = installStoryNetwork({ scenario: "default", routes: { "GET /api/bad-events": { events: "nope" } } });
    try { await expect(fetch("/api/bad-events")).rejects.toThrow(/fixture descriptor must return/); } finally { await badEventsCleanup(); }
    const badExtCleanup = installStoryNetwork({ scenario: "default", externalFixtures: { [`GET ${GITHUB_CONFIG.changelogUrl}`]: { body: "ok", status: "ok" } } });
    try { await expect(fetch(GITHUB_CONFIG.changelogUrl)).rejects.toThrow(/fixture descriptor must return/); } finally { await badExtCleanup(); }
  });
});
