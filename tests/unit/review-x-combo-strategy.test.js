// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mergeSettingsPatch } from "@/lib/db/repos/settingsRepo.js";
import { updateComboStrategy } from "@/shared/utils/comboStrategy";
import useSettingsStore from "@/store/settingsStore";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "A" }), useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/dashboard/combos", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/shared/components", () => ({ ModelSelectModal: () => null, CapacityBadges: () => null, CardSkeleton: () => null }));
vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("@/shared/components/DocsLink", () => ({ default: () => null }));
vi.mock("../../src/app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.jsx", () => ({ default: () => null }));
import CombosPage from "../../src/app/(dashboard)/dashboard/combos/page.js";
import MediaComboPage from "../../src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js";

const ok = (body) => ({ ok: true, status: 200, json: async () => structuredClone(body) });
const click = async (element) => { expect(element).toBeTruthy(); await act(async () => { element.click(); }); };
let host, root, server;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useSettingsStore.setState({ settings: null, lastFetched: 0, error: null, loading: false });
  server = { comboStrategies: { primary: { fallbackStrategy: "round-robin" }, other: { fallbackStrategy: "fusion" } } };
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/settings") {
      if (options?.method === "PATCH") server = { ...server, ...mergeSettingsPatch(server, JSON.parse(options.body)) };
      return ok(server);
    }
    if (options?.method === "DELETE") return ok({});
    if (url === "/api/combos") return ok({ combos: [{ id: "A", name: "primary", models: [] }] });
    if (url === "/api/combos/A") return ok({ id: "A", name: "primary", kind: "webSearch", models: [] });
    if (url === "/api/usage/logs") return ok([]);
    if (String(url).startsWith("/api/providers")) return ok({ connections: [] });
    if (String(url).startsWith("/api/connection-groups")) return ok({ groups: [] });
    return ok({});
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (element) => { await act(async () => { root.render(element); await new Promise((resolve) => setTimeout(resolve, 0)); }); };

it("deletes a combo's stored strategy without removing another", async () => {
  await render(React.createElement(CombosPage));
  await click(within(host).getByRole("button", { name: "Delete", exact: true }));
  await click(within(document.body.querySelector("dialog")).getByRole("button", { name: "Confirm" }));
  expect(server.comboStrategies).toEqual({ other: { fallbackStrategy: "fusion" } });
});

it("deletes a media combo strategy when round robin is disabled", async () => {
  await render(React.createElement(MediaComboPage));
  await click(within(host).getByRole("switch", { name: "Round Robin" }));
  expect(server.comboStrategies).toEqual({ other: { fallbackStrategy: "fusion" } });
});

it("preserves an explicit zero timeout when inheriting the strategy", () => {
  const next = updateComboStrategy(server.comboStrategies, "primary", { fallbackStrategy: "inherit", timeoutMs: 0 });
  expect(mergeSettingsPatch(server, { comboStrategies: next }).comboStrategies).toEqual({ primary: { timeoutMs: 0 }, other: { fallbackStrategy: "fusion" } });
});
