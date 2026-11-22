// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "../../src/app/(dashboard)/dashboard/profile/page.js";
import MfaCard from "../../src/app/(dashboard)/dashboard/profile/MfaCard.jsx";
import DatabaseSettingsPage from "../../src/app/(dashboard)/dashboard/settings/database/page.js";
import PricingSettingsPage from "../../src/app/dashboard/settings/pricing/page.js";
import QuotaLoading from "../../src/app/(dashboard)/dashboard/quota/QuotaLoading.jsx";
import QuotaPage from "../../src/app/(dashboard)/dashboard/quota/page.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/quota",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

let host, root;
const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body });
const fail = (status = 503, body = { error: "unavailable" }) => ({ ok: false, status, json: async () => body });
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
const settle = async () => { await act(async () => { await flush(); }); };
const button = (name) => [...document.querySelectorAll("button")].find((el) => el.textContent.includes(name) || el.getAttribute("aria-label") === name);
const click = async (el) => { expect(el).toBeTruthy(); await act(async () => { el.click(); await flush(); }); };
const render = async (element) => { await act(async () => { root.render(element); await flush(); }); };
const setV5 = (on) => { if (on) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui; };
const requests = () => fetch.mock.calls.map(([url, options]) => [options?.method || "GET", url, options?.body]);

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); setV5(false);
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

const profileSettings = { fallbackStrategy: "fill-first", comboStrategy: "fallback", requireLogin: false, hasPassword: false, authMode: "password" };

describe("profile (S19)", () => {
  it.each([false, true])("sends the same settings PATCH, V5 %s", async (v5) => {
    setV5(v5);
    vi.stubGlobal("fetch", vi.fn(async (url, options) => (options?.method === "PATCH" ? ok({}) : ok(profileSettings))));
    await render(React.createElement(ProfilePage));
    await settle();
    await click(document.querySelector('[role="tab"]:nth-child(2)'));
    const toggle = [...document.querySelectorAll('[role="switch"]')].find((el) => /Require login/i.test(el.getAttribute("aria-label") || el.closest("label")?.textContent || el.parentElement?.textContent || ""));
    await click(toggle);
    const write = requests().find(([method]) => method === "PATCH");
    expect(write).toEqual(["PATCH", "/api/settings", JSON.stringify({ requireLogin: true })]);
  });

  it("shows loading then unavailable with Retry in V5 and retries the same read", async () => {
    setV5(true);
    let failing = true;
    vi.stubGlobal("fetch", vi.fn(async () => (failing ? fail(503, { error: "Settings offline" }) : ok(profileSettings))));
    await render(React.createElement(ProfilePage));
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Settings offline");
    failing = false;
    await click(button("Retry settings"));
    await settle();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(requests().filter(([, url]) => url === "/api/settings").length).toBe(2);
    expect(document.body.textContent).toContain("Local dashboard, routing, and service preferences");
  });

  it("keeps the one-time-code label and autocomplete on the MFA verification input", async () => {
    setV5(true);
    vi.stubGlobal("fetch", vi.fn(async (url) => (String(url).includes("setup") ? ok({ secret: "ABC", qrCodeDataUri: "data:image/png;base64,AA==" }) : ok({ enabled: false }))));
    await render(React.createElement(MfaCard, { enabled: false, onChanged() {} }));
    await settle();
    const start = button("Set up") || button("Enable");
    if (start) await click(start);
    const password = document.querySelector('input[type="password"]');
    if (password) {
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(password, "pw"); password.dispatchEvent(new Event("input", { bubbles: true })); await flush(); });
      await click(button("Continue"));
      await settle();
    }
    const code = document.querySelector('input[autocomplete="one-time-code"]');
    expect(code).toBeTruthy();
    expect(document.querySelector(`label[for="${code.id}"]`)?.textContent).toContain("code");
  });
});

const engine = { activeEngine: "sqlite", databasePgVersion: 16, snapshots: [], startupEnv: { effective: {}, sources: {} } };

describe("database settings (S19)", () => {
  it.each([false, true])("re-reads status after the cutover write with the same sequence, V5 %s", async (v5) => {
    setV5(v5);
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (url === "/api/settings/database/cutover") return ok({ ok: true });
      if (url === "/api/settings/database/engine") return ok(engine);
      return ok({});
    }));
    await render(React.createElement(DatabaseSettingsPage, { initialPassword: "secret" }));
    await settle();
    await click(button("Cut over to Postgres"));
    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    await click([...dialog.querySelectorAll("button")].find((el) => el.textContent.trim() === "Cut over"));
    await settle();
    const seq = requests().filter(([, url]) => String(url).startsWith("/api/settings/database/")).map(([method, url, body]) => [method, url, body]);
    const post = seq.findIndex(([method]) => method === "POST");
    expect(seq[post]).toEqual(["POST", "/api/settings/database/cutover", JSON.stringify({})]);
    expect(seq.slice(post + 1).some(([method, url]) => method === "GET" && url === "/api/settings/database/engine")).toBe(true);
    const sent = fetch.mock.calls.find(([url]) => url === "/api/settings/database/cutover")[1];
    expect(sent.headers).toEqual({ "content-type": "application/json", "x-9r-password": "secret" });
  });

  it("explains the cutover in the danger-toned dialog in V5", async () => {
    setV5(true);
    vi.stubGlobal("fetch", vi.fn(async () => ok(engine)));
    await render(React.createElement(DatabaseSettingsPage, { initialPassword: "secret" }));
    await settle();
    await click(button("Cut over to Postgres"));
    const dialog = document.querySelector("dialog");
    expect(dialog.textContent).toContain("mirror every SQLite table");
    expect([...dialog.querySelectorAll("button")].find((el) => el.textContent.trim() === "Cut over").className).toContain("bg-dd-danger-action");
  });

  it("shows status unavailable with Retry in V5", async () => {
    setV5(true);
    vi.stubGlobal("fetch", vi.fn(async () => fail(503)));
    await render(React.createElement(DatabaseSettingsPage, { initialPassword: "secret" }));
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Database status is unknown");
    expect(button("Retry status")).toBeTruthy();
  });
});

describe("pricing settings (S19)", () => {
  const pricing = { openai: { "gpt-4o": { input: 2.5, output: 10 } } };

  it.each([false, true])("reads /api/pricing once and renders the same summary, V5 %s", async (v5) => {
    setV5(v5);
    vi.stubGlobal("fetch", vi.fn(async () => ok(pricing)));
    await render(React.createElement(PricingSettingsPage));
    await settle();
    expect(requests()).toEqual([["GET", "/api/pricing", undefined]]);
    expect(document.body.textContent).toContain("OPENAI");
    expect(!!document.querySelector('[role="region"][aria-label="Pricing table"]')).toBe(v5);
  });

  it("renders the empty guidance", async () => {
    setV5(true);
    vi.stubGlobal("fetch", vi.fn(async () => ok({})));
    await render(React.createElement(PricingSettingsPage));
    await settle();
    expect(document.body.textContent).toContain("No pricing data available");
    expect(document.body.textContent).toContain("Add pricing rates to enable cost tracking.");
  });

  it("shows a load failure with Retry in V5 only", async () => {
    setV5(true);
    let failing = true;
    vi.stubGlobal("fetch", vi.fn(async () => (failing ? fail() : ok(pricing))));
    await render(React.createElement(PricingSettingsPage));
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Unable to load pricing data");
    failing = false;
    await click(button("Retry pricing"));
    await settle();
    expect(document.body.textContent).toContain("OPENAI");
    expect(requests().map(([, url]) => url)).toEqual(["/api/pricing", "/api/pricing"]);
  });

  it("keeps the legacy empty state on failure when V5 is off", async () => {
    setV5(false);
    vi.stubGlobal("fetch", vi.fn(async () => fail()));
    await render(React.createElement(PricingSettingsPage));
    await settle();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain("No pricing data available");
  });
});

describe("quota (S19)", () => {
  const codex = (id, name) => ({ id, provider: "codex", name, email: `${id}@example.com`, authType: "oauth", isActive: true, providerSpecificData: { plan: "Pro" } });
  const accounts = [codex("a1", "Alpha"), codex("a2", "Beta")];
  const quotaBody = { plan: "Pro", rate_limit: { primary_window: { used_percent: 30, reset_at: Date.now() + 3_600_000 } } };
  const route = (a1 = () => ok(quotaBody)) => vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith("/api/providers/client")) return ok({ connections: accounts, providerOptions: ["codex"], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 }, totals: { eligibleConnections: 2, providerFilteredConnections: 2 } });
    if (u.startsWith("/api/settings")) return ok({ quotaTrackerState: {}, claudeAutoPing: { connections: {} }, codexAutoPing: { connections: {} }, quotaVisibility: {} });
    if (u.startsWith("/api/proxy-pools")) return ok({ proxyPools: [] });
    if (u.startsWith("/api/usage/a1")) return a1();
    if (u.startsWith("/api/usage/a2")) return ok(quotaBody);
    return ok({});
  });

  it("exposes loading as a status in V5 only", async () => {
    for (const v5 of [false, true]) {
      setV5(v5);
      await render(React.createElement(QuotaLoading));
      expect(!!document.querySelector('[role="status"][aria-label="Loading quota"]')).toBe(v5);
      expect(document.querySelectorAll(".animate-pulse")).toHaveLength(2);
    }
  });

  it.each([false, true])("reads the same quota endpoints and keeps account rows reachable, V5 %s", async (v5) => {
    setV5(v5);
    vi.stubGlobal("fetch", route());
    await render(React.createElement(QuotaPage));
    await settle(); await settle();
    const urls = requests().map(([, url]) => String(url)).filter((url) => url.startsWith("/api/usage/")).sort();
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls.some((url) => url.startsWith("/api/usage/a1"))).toBe(true);
    expect(document.querySelector('section[aria-label*="a1@example.com"]')).toBeTruthy();
    expect(document.querySelector('section[aria-label*="a2@example.com"]')).toBeTruthy();
  });

  it("shows a per-account failure with Retry and keeps the other account in V5", async () => {
    setV5(true);
    let failing = true;
    vi.stubGlobal("fetch", route(() => (failing ? fail(503, { error: "Quota service unavailable" }) : ok(quotaBody))));
    await render(React.createElement(QuotaPage));
    await settle(); await settle();
    const alpha = document.querySelector('section[aria-label*="a1@example.com"]');
    const beta = document.querySelector('section[aria-label*="a2@example.com"]');
    expect(alpha.querySelector('[role="alert"]')?.textContent).toContain("Quota service unavailable");
    expect(beta.querySelector('[role="alert"]')).toBeNull();
    expect(beta.textContent).not.toContain("Quota service unavailable");
    expect(beta.querySelector('[aria-label="Refresh quota"]')).toBeTruthy();
    failing = false;
    await click([...alpha.querySelectorAll("button")].find((el) => el.textContent.includes("Retry quota")));
    await settle();
    expect(document.querySelector('section[aria-label*="a1@example.com"] [role="alert"]')).toBeNull();
    expect(document.querySelector('section[aria-label*="a2@example.com"]')).toBeTruthy();
    expect(requests().filter(([, url]) => String(url).startsWith("/api/usage/a1")).length).toBe(2);
  });

  it("offers no Retry quota button when V5 is off", async () => {
    setV5(false);
    vi.stubGlobal("fetch", route(() => fail(503, { error: "Quota service unavailable" })));
    await render(React.createElement(QuotaPage));
    await settle(); await settle();
    expect(button("Retry quota")).toBeUndefined();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Quota service unavailable");
  });
});
