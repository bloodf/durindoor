// @vitest-environment happy-dom
/**
 * `useEndpointTargets` offers every endpoint the Endpoint page can show, so the
 * skills copy controls never hide a reachable base URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  buildEndpointTargets,
  useEndpointTargets,
} from "@/app/(dashboard)/dashboard/endpoint/useEndpointTargets.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const REMOTE = { origin: "https://dash.example.test", hostname: "dash.example.test" };

const ids = (targets) => targets.map((t) => t.id);
const byId = (targets, id) => targets.find((t) => t.id === id);

describe("buildEndpointTargets", () => {
  it("always includes the local endpoint", () => {
    expect(buildEndpointTargets(null, { localPort: 4000 })).toEqual([
      { id: "local", label: "Local — http://localhost:4000/v1", value: "http://localhost:4000/v1" },
    ]);
  });

  it("includes an enabled tunnel and strips trailing slashes", () => {
    const targets = buildEndpointTargets({ tunnel: { enabled: true, tunnelUrl: "https://t.example.test//" } });
    expect(byId(targets, "tunnel")).toEqual({
      id: "tunnel",
      label: "Tunnel — https://t.example.test/v1",
      value: "https://t.example.test/v1",
    });
  });

  it("omits a disabled tunnel's leftover URL", () => {
    const targets = buildEndpointTargets({ tunnel: { enabled: false, tunnelUrl: "https://t.example.test" } });
    expect(ids(targets)).toEqual(["local"]);
  });

  it("includes every allUrls entry", () => {
    const targets = buildEndpointTargets({
      tunnel: { enabled: false, allUrls: ["https://a.example.test", "https://b.example.test/"] },
    });
    expect(targets.map((t) => t.value)).toEqual([
      "http://localhost:20128/v1",
      "https://a.example.test/v1",
      "https://b.example.test/v1",
    ]);
  });

  it("includes the external tunnel", () => {
    const targets = buildEndpointTargets({ tunnel: { externalTunnel: { tunnelUrl: "https://ext.example.test" } } });
    expect(byId(targets, "tunnel-external").value).toBe("https://ext.example.test/v1");
  });

  it("includes enabled Tailscale and the system Tailscale", () => {
    const targets = buildEndpointTargets({
      tailscale: {
        enabled: true,
        tunnelUrl: "https://ts.example.test",
        systemTailscale: { tunnelUrl: "https://sys.example.test" },
      },
    });
    expect(byId(targets, "tailscale")).toMatchObject({ label: "Tailscale — https://ts.example.test/v1" });
    expect(byId(targets, "tailscale-external")).toMatchObject({
      label: "External Tailscale — https://sys.example.test/v1",
    });
  });

  it("omits a disabled Tailscale's leftover URL but keeps the system Tailscale", () => {
    const targets = buildEndpointTargets({
      tailscale: { enabled: false, tunnelUrl: "https://ts.example.test", systemTailscale: { tunnelUrl: "https://sys.example.test" } },
    });
    expect(ids(targets)).toEqual(["local", "tailscale-external"]);
  });

  it("adds the browser origin when the dashboard is on a remote host", () => {
    const targets = buildEndpointTargets(null, { location: REMOTE });
    expect(byId(targets, "browser-origin")).toEqual({
      id: "browser-origin",
      label: "This host — https://dash.example.test/v1",
      value: "https://dash.example.test/v1",
    });
  });

  it.each([
    ["localhost", "http://localhost:3000"],
    ["127.0.0.1", "http://127.0.0.1:3000"],
    ["::1", "http://[::1]:3000"],
  ])("skips the browser origin on %s", (hostname, origin) => {
    expect(ids(buildEndpointTargets(null, { location: { origin, hostname } }))).toEqual(["local"]);
  });

  it("skips an opaque origin", () => {
    expect(ids(buildEndpointTargets(null, { location: { origin: "null", hostname: "" } }))).toEqual(["local"]);
  });

  it("de-duplicates by URL, keeping the first row", () => {
    const targets = buildEndpointTargets(
      {
        tunnel: {
          enabled: true,
          tunnelUrl: "https://dash.example.test",
          allUrls: ["https://dash.example.test", "https://other.example.test"],
          externalTunnel: { tunnelUrl: "https://other.example.test/" },
        },
        tailscale: { enabled: true, tunnelUrl: "https://dash.example.test" },
      },
      { location: REMOTE },
    );
    expect(targets.map((t) => t.value)).toEqual([
      "http://localhost:20128/v1",
      "https://dash.example.test/v1",
      "https://other.example.test/v1",
    ]);
    expect(ids(targets)).toEqual(["local", "tunnel", "tunnel-all:https://other.example.test"]);
  });
});

describe("useEndpointTargets", () => {
  const originalFetch = global.fetch;
  let container;
  let root;
  let latest;

  function Probe({ port }) {
    latest = useEndpointTargets(port);
    return null;
  }

  async function mount(port) {
    await act(async () => {
      root.render(React.createElement(Probe, { port }));
    });
    await act(async () => {});
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("derives every source from /api/tunnel/status", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tunnel: {
          enabled: true,
          tunnelUrl: "https://t.example.test",
          allUrls: ["https://t.example.test", "https://t2.example.test"],
          externalTunnel: { tunnelUrl: "https://ext.example.test" },
        },
        tailscale: { enabled: true, tunnelUrl: "https://ts.example.test", systemTailscale: { tunnelUrl: "https://sys.example.test" } },
      }),
    }));

    await mount(20128);

    expect(global.fetch.mock.calls[0][0]).toBe("/api/tunnel/status");
    expect(latest.loading).toBe(false);
    expect(ids(latest.endpoints)).toEqual([
      "local",
      "tunnel",
      "tunnel-all:https://t2.example.test",
      "tunnel-external",
      "tailscale",
      "tailscale-external",
    ]);
  });

  it("falls back to the local endpoint when the status request fails", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("offline");
    });

    await mount(5555);

    expect(latest.loading).toBe(false);
    expect(latest.endpoints.map((e) => e.value)).toEqual(["http://localhost:5555/v1"]);
  });

  it("falls back to the local endpoint on a non-OK status response", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));

    await mount(20128);

    expect(latest.loading).toBe(false);
    expect(ids(latest.endpoints)).toEqual(["local"]);
  });
});
