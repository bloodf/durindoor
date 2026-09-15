// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import EndpointPageClient from "../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx";
import KeysPageClient from "../../src/app/(dashboard)/dashboard/keys/KeysPageClient.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = (relativePath) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  "utf8",
);
const ENDPOINT_SRC = source("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx");
const KEYS_SRC = source("../../src/app/(dashboard)/dashboard/keys/KeysPageClient.jsx");
const response = (body) => ({ ok: true, status: 200, json: async () => body });

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("endpoint and API-key page split", () => {
  it("blocks tunnel activation while Require API key is disabled", async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url) === "/api/settings") {
        return response({ requireApiKey: false, requireLogin: true, hasPassword: true });
      }
      if (String(url) === "/api/tunnel/status") {
        return response({ tunnel: { enabled: false }, tailscale: { enabled: false } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);

    await act(async () => root.render(React.createElement(EndpointPageClient)));
    const tunnelRow = within(container).getByText("Tunnel").closest("div.flex");
    await act(async () => within(tunnelRow).getByRole("button", { name: "Enable" }).click());

    expect(within(tunnelRow).getByText('Security required: Enable "Require API key" before activating the tunnel.')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalledWith("/api/tunnel/enable", expect.anything());
  });

  it("keeps the Require API key warning target on the endpoint page", () => {
    expect(ENDPOINT_SRC).toContain('id="require-api-key"');
    expect(ENDPOINT_SRC).toMatch(
      /<SecurityWarning\s+message="Require API key is disabled[^>]+action=\{\{ label: "Enable", href: "#require-api-key" \}\}/s,
    );
  });

  it("renders the API-key list and Create Key affordance", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url) === "/api/keys") return response({ keys: [{ id: "fixture-key", name: "Fixture key", isActive: true, createdAt: "2026-01-01T00:00:00Z", policy: {} }], providerConnections: [] });
      if (String(url) === "/api/combos") return response({ combos: [] });
      if (String(url) === "/api/keys/policy-catalog") return response({ models: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    await act(async () => root.render(React.createElement(KeysPageClient)));
    expect(within(container).getByText("Fixture key")).toBeTruthy();
    expect(within(container).getByRole("button", { name: "Create Key" })).toBeTruthy();
  });

  it("keeps each page free of the other page's concern", () => {
    expect(ENDPOINT_SRC).not.toMatch(/ApiKeyRow|handleCreateKey|fetch\("\/api\/keys/);
    expect(KEYS_SRC).not.toMatch(/handleEnableTunnel|handleConnectTailscale|\/api\/tunnel/);
    expect(KEYS_SRC).not.toMatch(/requireApiKey|handleRequireApiKey/);
  });
});
