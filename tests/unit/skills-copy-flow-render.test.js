// @vitest-environment happy-dom
/**
 * End-to-end copy flow for the skills page.
 *
 * The security contract is the point: `GET /api/keys` returns masked
 * management views, so the real credential must be fetched from
 * `GET /api/keys/:id/reveal` at click time and written straight to the
 * clipboard. It must never reach page state or the DOM — a rendered secret
 * would leak into screenshots, screen shares, and devtools.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/ui/components/Card.jsx", () => ({
  Card: ({ children }) => React.createElement("div", null, children),
  CardHeader: ({ title, subtitle, actions }) => React.createElement("header", null, title, subtitle, actions),
  CardContent: ({ children }) => React.createElement("div", null, children),
}));
vi.mock("@/shared/ui/components/Button.jsx", () => ({
  default: ({ children, icon, ...props }) => React.createElement("button", props, children),
}));
vi.mock("@/shared/ui/components/PageHeader.jsx", () => ({ default: ({ title }) => React.createElement("h1", null, title) }));
vi.mock("@/shared/ui/components/Badge.jsx", () => ({ Badge: ({ children }) => React.createElement("span", null, children) }));
vi.mock("@/shared/ui/components/Field.jsx", () => ({
  default: ({ label, children }) => React.createElement("label", null, label, children),
}));
vi.mock("@/shared/ui/components/Select.jsx", () => ({
  default: ({ options, value, onChange, ...props }) =>
    React.createElement(
      "select",
      { ...props, value, onChange: (event) => onChange(event.target.value) },
      (options || []).map((option) => React.createElement("option", { key: option.value, value: option.value }, option.label)),
    ),
}));

import SkillsPage from "@/app/(dashboard)/dashboard/skills/page.js";

const SECRET = "sk-live-real-secret-value";

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("skills copy flow", () => {
  let container;
  let root;
  let written;

  beforeEach(() => {
    written = [];
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async (text) => { written.push(text); }) },
    });

    globalThis.fetch = vi.fn((url) => {
      const target = String(url);
      if (target.startsWith("/api/tunnel/status")) {
        return Promise.resolve(response({
          tunnel: { enabled: true, tunnelUrl: "https://live.trycloudflare.com" },
          // Disabled transport: its URL lingers in status but must not be offered.
          tailscale: { enabled: false, tunnelUrl: "https://stale.ts.net" },
        }));
      }
      if (target === "/api/keys") {
        return Promise.resolve(response({
          keys: [{ id: "key-1", name: "Cortex", maskedKey: "sk-••••••••", isActive: true }],
        }));
      }
      if (target === "/api/keys/key-1/reveal") return Promise.resolve(response({ key: SECRET }));
      return Promise.resolve(response({}));
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const renderAndSettle = async () => {
    await act(async () => {
      root.render(React.createElement(SkillsPage));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const selects = () => Array.from(container.querySelectorAll("select"));

  it("offers only enabled transports as endpoints", async () => {
    await renderAndSettle();

    const endpointOptions = Array.from(selects()[0].options).map((option) => option.value);
    expect(endpointOptions.some((value) => value.includes("live.trycloudflare.com"))).toBe(true);
    // The disabled Tailscale URL must not be selectable.
    expect(endpointOptions.some((value) => value.includes("stale.ts.net"))).toBe(false);
    expect(endpointOptions.some((value) => value.includes("localhost"))).toBe(true);
  });

  it("lists keys by masked label and never renders the secret", async () => {
    await renderAndSettle();

    expect(container.textContent).toContain("sk-••••••••");
    expect(container.textContent).not.toContain(SECRET);
  });

  it("reveals the secret on copy and writes it only to the clipboard", async () => {
    await renderAndSettle();

    const keySelect = selects()[1];
    await act(async () => {
      keySelect.value = "key-1";
      keySelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const copyButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent.includes("Copy instruction"),
    );
    await act(async () => copyButton.click());

    // The secret came from the dedicated reveal route, not the list.
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/keys/key-1/reveal");
    expect(written).toHaveLength(1);
    expect(written[0]).toContain(`API key: ${SECRET}`);
    expect(written[0]).toContain("Read this skill and use it:");
    expect(written[0]).toContain("Base URL:");

    // Clipboard only: the page itself still shows the mask.
    expect(container.textContent).not.toContain(SECRET);
  });

  it("copies without a key line when none is selected", async () => {
    await renderAndSettle();

    const copyButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent.includes("Copy instruction"),
    );
    await act(async () => copyButton.click());

    expect(written[0]).not.toMatch(/API key/);
    // No reveal request is made when no key is chosen.
    expect(globalThis.fetch).not.toHaveBeenCalledWith("/api/keys/key-1/reveal");
  });
});
