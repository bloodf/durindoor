// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ProfilePage from "@/app/(dashboard)/dashboard/profile/page";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
const roots = [];
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const settings = {
  fallbackStrategy: "fill-first",
  comboStrategy: "fallback",
  requireLogin: true,
  hasPassword: true,
  authMode: "password",
  exposeComboOnly: false,
  hidePaidModels: false,
  enableObservability: true,
  enableProxyTimeline: true,
  proxyTimelineRetentionDays: 7,
  visionBridgeModel: "openai/gpt-4o",
  visionBridgeEnabled: true,
  outboundProxyEnabled: false,
};

function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push([root, container]);
  act(() => root.render(element));
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

function setValue(input, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function selectTab(label) {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => node.textContent.includes(label));
  await act(async () => tab.click());
}


beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function shimShowModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function shimClose() {
    this.removeAttribute("open");
  };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    if (url === "/api/settings" && (!init.method || init.method === "GET")) {
      return new Response(JSON.stringify(settings), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
});

afterEach(() => {
  while (roots.length) {
    const [root, container] = roots.pop();
    act(() => root.unmount());
    container.remove();
  }
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  document.body.innerHTML = "";
});

describe("profile settings behavior", () => {
  it("waits for initial settings before opening an editable OIDC draft", async () => {
    let resolveSettings;
    globalThis.fetch.mockImplementation((url) => url === "/api/settings"
      ? new Promise((resolve) => { resolveSettings = resolve; })
      : Promise.resolve(new Response("{}")));
    render(h(ProfilePage));
    expect(document.querySelector('[role="status"]').textContent).toContain("Loading settings");
    expect(document.querySelector('[aria-label="Toggle OIDC settings"]')).toBeNull();
    await act(async () => {
      resolveSettings(new Response(JSON.stringify(settings)));
    });
    await selectTab("Security");
    const toggle = document.querySelector('[aria-label="Toggle OIDC settings"]');
    expect(toggle.disabled).toBe(false);
    await act(async () => toggle.click());
    const issuer = document.querySelector('input[placeholder="https://auth.example.com/application/o/durindoor/"]');
    expect(issuer).not.toBeNull();
    setValue(issuer, "https://draft.example.test");
    await selectTab("General");
    await selectTab("Security");
    expect(issuer.value).toBe("https://draft.example.test");
  });

  it("rejects mismatched passwords before saving", async () => {
    render(h(ProfilePage));
    await flush();
    await selectTab("Security");
    setValue(document.querySelector("#profile-current-password"), "old-password");
    setValue(document.querySelector("#profile-new-password"), "new-password");
    setValue(document.querySelector("#profile-confirm-password"), "different-password");
    await act(async () => document.querySelector("#profile-confirm-password").closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(document.body.textContent).toContain("Passwords do not match");
    expect(globalThis.fetch.mock.calls.filter(([url, init]) => url === "/api/settings" && init?.method === "PATCH")).toHaveLength(0);
  });

  it("keeps save failure visible for invalid Firecrawl URL without a request", async () => {
    render(h(ProfilePage));
    await flush();
    await selectTab("Network");
    const input = [...document.querySelectorAll("input")].find((node) => node.getAttribute("placeholder") === "https://api.firecrawl.dev");
    setValue(input, "not-a-url");
    await act(async () => input.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(document.body.textContent).toContain("Invalid URL");
    expect(globalThis.fetch.mock.calls.filter(([url, init]) => url === "/api/settings" && init?.method === "PATCH")).toHaveLength(0);
  });

  it("dismisses shutdown confirmation without sending shutdown request", async () => {
    render(h(ProfilePage));
    await flush();
    await selectTab("System & Data");
    await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Shutdown")).click());
    const dialog = document.querySelector("dialog[open]");
    expect(dialog?.textContent).toContain("Close Proxy");
    await act(async () => [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Cancel").click());
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalledWith("/api/version/shutdown", expect.anything());
  });
  it("shows one category at a time and retains unsaved form values across switches", async () => {
    render(h(ProfilePage));
    await flush();
    expect(document.querySelector('[role="tab"][aria-selected="true"]').textContent).toContain("General");
    expect(document.querySelector('[role="tabpanel"][aria-label="General settings"]').hidden).toBe(false);
    await selectTab("Security");
    const currentPassword = document.querySelector("#profile-current-password");
    setValue(currentPassword, "unsaved-password");
    await selectTab("Routing");
    expect(document.querySelector('[role="tabpanel"][aria-label="Security settings"]').hidden).toBe(true);
    expect(document.querySelector('[role="tabpanel"][aria-label="Routing settings"]').hidden).toBe(false);
    await selectTab("Security");
    expect(document.querySelector("#profile-current-password").value).toBe("unsaved-password");
  });


  it("shows the local-mode footer label on localhost", async () => {
    render(h(ProfilePage));
    await flush();
    expect(document.body.textContent).toContain("Local Mode - All data stored on your machine");
    expect(document.body.textContent).not.toContain("Remote Mode");
  });

  it("shows Remote Mode in the footer when served from a remote host", async () => {
    window.happyDOM.setURL("https://router.example.com/");
    try {
      render(h(ProfilePage));
      await flush();
      expect(document.body.textContent).toContain("Remote Mode");
      expect(document.body.textContent).not.toContain("Local Mode - All data stored on your machine");
    } finally {
      window.happyDOM.setURL("http://localhost/");
    }
  });

  it("treats bracketed IPv6 loopback as local", async () => {
    window.happyDOM.setURL("http://[::1]:20127/");
    try {
      render(h(ProfilePage));
      await flush();
      expect(document.body.textContent).toContain("Local Mode - All data stored on your machine");
      expect(document.body.textContent).not.toContain("Remote Mode");
    } finally {
      window.happyDOM.setURL("http://localhost/");
    }
  });
});


describe("profile settings load recovery", () => {
  it("keeps policy controls unavailable after failed reads and retries without a write", async () => {
    let failed = true;
    globalThis.fetch.mockImplementation(async (url) => url === "/api/settings"
      ? new Response(JSON.stringify(failed ? { error: "Settings unavailable" } : settings), { status: failed ? 503 : 200 })
      : new Response("{}"));
    render(h(ProfilePage)); await flush();
    expect(document.querySelector('[role="alert"]').textContent).toContain("Settings unavailable");
    expect(document.querySelector('[role="tab"]')).toBeNull();
    failed = false;
    await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Retry settings")).click());
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="tab"]')).not.toBeNull();
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });
});

it("rejects a JSON null settings response without exposing policy defaults", async () => {
  globalThis.fetch.mockImplementation(async () => new Response("null"));
  render(h(ProfilePage)); await flush();
  expect(document.querySelector('[role="alert"]').textContent).toContain("Settings could not be loaded");
  expect(document.querySelector('[role="tab"]')).toBeNull();
});

function controlWithLabel(text) {
  const label = [...document.querySelectorAll("label")].find((node) => node.textContent === text);
  return document.getElementById(label.htmlFor);
}

const routingCases = [
  { label: "Cache Affinity", patch: { fallbackStrategy: "cache-affinity" }, initial: {}, summary: "Currently using accounts in priority order", saved: "Currently pinning each conversation to one account (Cache Affinity)" },
  { label: "Round Robin", patch: { fallbackStrategy: "round-robin" }, initial: {}, summary: "Currently using accounts in priority order", saved: "Currently distributing requests with 3 calls per account." },
  { label: "Combo Round Robin", patch: { comboStrategy: "round-robin" }, initial: {}, summary: "Combos always start with their first model.", saved: "Combos rotate after 1 calls per model." },
  { label: "Sticky Limit", patch: { stickyRoundRobinLimit: 5 }, initial: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3 }, summary: "Currently distributing requests with 3 calls per account.", saved: "Currently distributing requests with 5 calls per account.", draft: "5" },
  { label: "Combo Sticky Limit", patch: { comboStickyRoundRobinLimit: 8 }, initial: { comboStrategy: "round-robin", comboStickyRoundRobinLimit: 1 }, summary: "Combos rotate after 1 calls per model.", saved: "Combos rotate after 8 calls per model.", draft: "8" },
];

describe.each(routingCases)("routing save feedback: $label", (scenario) => {
  it.each(["HTTP", "network"])("retains accepted values and rejected drafts after %s failure, then retries", async (failure) => {
    let settle;
    const patches = [];
    globalThis.fetch.mockImplementation(async (url, init = {}) => {
      if (url === "/api/settings" && init.method === "PATCH") {
        patches.push(JSON.parse(init.body));
        expect(init.headers).toEqual({ "Content-Type": "application/json" });
        return new Promise((resolve, reject) => {
          settle = (ok) => ok ? resolve(new Response("{}")) : failure === "HTTP"
            ? resolve(new Response('{"error":"Unavailable"}', { status: 503 }))
            : reject(new TypeError("Network unavailable"));
        });
      }
      return new Response(JSON.stringify(url === "/api/settings" ? { ...settings, ...scenario.initial } : {}));
    });
    render(h(ProfilePage)); await flush(); await selectTab("Routing");
    const panel = document.querySelector('[aria-label="Routing settings"]');
    const control = controlWithLabel(scenario.label);
    if (scenario.draft) setValue(control, scenario.draft);
    else await act(async () => control.click());
    expect(panel.querySelector('[role="status"]').textContent).toBe("Saving routing preference…");
    expect(control.disabled).toBe(true);
    expect(controlWithLabel("Round Robin").disabled).toBe(true);
    expect(controlWithLabel("Combo Round Robin").disabled).toBe(true);
    expect(panel.textContent).toContain(scenario.summary);
    expect(patches).toEqual([scenario.patch]);
    await act(async () => settle(false));
    expect(panel.querySelector('[role="alert"]').textContent).toContain("Could not confirm the routing save");
    expect(panel.querySelector('[role="status"]')).toBeNull();
    expect(control.disabled).toBe(false);
    expect(panel.textContent).toContain(scenario.summary);
    if (scenario.draft) expect(control.value).toBe(scenario.draft);
    else expect(control.getAttribute("aria-checked")).toBe("false");
    await selectTab("General"); await selectTab("Routing");
    if (scenario.draft) expect(controlWithLabel(scenario.label).value).toBe(scenario.draft);
    const retry = [...panel.querySelectorAll("button")].find((button) => button.textContent === "Retry routing save");
    await act(async () => retry.click());
    expect(panel.querySelector('[role="alert"]')).toBeNull();
    expect(patches).toEqual([scenario.patch, scenario.patch]);
    await act(async () => settle(true));
    expect(panel.querySelector('[role="alert"]')).toBeNull();
    expect(panel.querySelector('[role="status"]')).toBeNull();
    expect(panel.textContent).toContain(scenario.saved);
    if (scenario.draft) expect(controlWithLabel(scenario.label).value).toBe(scenario.draft);
    else expect(controlWithLabel(scenario.label).getAttribute("aria-checked")).toBe("true");
  });
});

it.each([true, false])("ignores routing save completion after unmount, success=%s", async (ok) => {
  let settle;
  globalThis.fetch.mockImplementation(async (url, init = {}) => {
    if (init.method === "PATCH") return new Promise((resolve, reject) => {
      settle = () => ok ? resolve(new Response("{}")) : reject(new TypeError("Disconnected"));
    });
    return new Response(JSON.stringify(url === "/api/settings" ? settings : {}));
  });
  render(h(ProfilePage)); await flush(); await selectTab("Routing");
  await act(async () => controlWithLabel("Round Robin").click());
  const [root, container] = roots.pop();
  act(() => root.unmount()); container.remove();
  await act(async () => settle());
  render(h(ProfilePage)); await flush(); await selectTab("Routing");
  expect(controlWithLabel("Round Robin").getAttribute("aria-checked")).toBe("false");
  const panel = document.querySelector('[aria-label="Routing settings"]');
  expect(panel.querySelector('[role="alert"]')).toBeNull();
  expect(panel.querySelector('[role="status"]')).toBeNull();
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
});
