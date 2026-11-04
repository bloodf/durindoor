// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import { normalizeSyncedModels, mergeSyncedCatalog, effectiveSyncedModels } from "../../src/lib/modelAutoSync/catalog.js";
import { getModelsByProviderId } from "../../src/shared/constants/models.js";
import { GenericExampleCard } from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.js";
import { SttExampleCard } from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/SttExampleCard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  root = null;
});

async function render(component, props) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(component, props)));
  return within(host);
}

it("lists and sends a custom STT row with a multipart file", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/tunnel/status") return Response.json({});
    if (url === "/api/models/custom") return Response.json({ models: [{ id: "custom-whisper", name: "Custom Whisper", providerAlias: "local-whisper", kind: "stt" }] });
    if (url === "/api/v1/audio/transcriptions") {
      expect(options.body.get("model")).toBe("local-whisper/custom-whisper");
      expect(options.body.get("file").name).toBe("sample.wav");
      return Response.json({ text: "Custom transcription complete" });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  const view = await render(SttExampleCard, { providerId: "local-whisper" });
  await act(async () => view.getByRole("combobox", { name: "Model" }).click());
  await act(async () => within(document.body).getByRole("option", { name: "Custom Whisper" }).click());
  const input = view.getByLabelText("Audio file");
  const file = new File(["audio"], "sample.wav", { type: "audio/wav" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(view.getByRole("region", { name: "Request example" }).textContent).toContain("model=local-whisper/custom-whisper");
  await act(async () => view.getByRole("button", { name: "Run" }).click());
  expect(view.getByRole("region", { name: "Response output" }).textContent).toContain("Custom transcription complete");
});

it("ignores stale synced responses across provider A to B to A", async () => {
  const pending = [];
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (url === "/api/tunnel/status") return Promise.resolve(Response.json({}));
    if (url === "/api/providers/client") return Promise.resolve(Response.json({ connections: [] }));
    if (url === "/api/models/custom") return Promise.resolve(Response.json({ models: [] }));
    if (String(url).startsWith("/api/models/auto-sync?provider=")) return new Promise((resolve) => pending.push({ url, resolve }));
    throw new Error(`Unexpected request: ${url}`);
  }));
  const view = await render(GenericExampleCard, { providerId: "openai", kind: "image" });
  await act(async () => root.render(React.createElement(GenericExampleCard, { providerId: "xai", kind: "image" })));
  await act(async () => root.render(React.createElement(GenericExampleCard, { providerId: "openai", kind: "image" })));
  expect(pending).toHaveLength(3);
  await act(async () => pending[2].resolve(Response.json({ providers: { openai: { eligible: true, models: [{ id: "latest-image", name: "Latest Image", kind: "image" }] } } })));
  await act(async () => pending[0].resolve(Response.json({ providers: { openai: { eligible: true, models: [{ id: "stale-image", name: "Stale Image", kind: "image" }] } } })));
  await act(async () => pending[1].resolve(Response.json({ providers: { xai: { eligible: true, models: [{ id: "foreign-image", name: "Foreign Image", kind: "image" }] } } })));
  await act(async () => view.getByRole("combobox", { name: "Model" }).click());
  expect(within(document.body).getByRole("option", { name: "Latest Image" })).toBeTruthy();
  expect(within(document.body).queryByRole("option", { name: "Stale Image" })).toBeNull();
  expect(within(document.body).queryByRole("option", { name: "Foreign Image" })).toBeNull();
});

it("keeps the newest custom catalog when a refresh races", async () => {
  const pending = [];
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (url === "/api/tunnel/status") return Promise.resolve(Response.json({}));
    if (url === "/api/providers/client") return Promise.resolve(Response.json({ connections: [] }));
    if (String(url).startsWith("/api/models/auto-sync?")) return Promise.resolve(Response.json({}));
    if (url === "/api/models/custom") return new Promise((resolve) => pending.push(resolve));
    throw new Error(`Unexpected request: ${url}`);
  }));
  const view = await render(GenericExampleCard, { providerId: "openai", kind: "image" });
  await act(async () => window.dispatchEvent(new Event("customModelChanged")));
  expect(pending).toHaveLength(2);
  await act(async () => pending[1](Response.json({ models: [{ providerAlias: "openai", id: "new-image", name: "New Custom Image", kind: "image" }] })));
  await act(async () => pending[0](Response.json({ models: [{ providerAlias: "openai", id: "old-image", name: "Old Custom Image", kind: "image" }] })));
  await act(async () => view.getByRole("combobox", { name: "Model" }).click());
  expect(within(document.body).getByRole("option", { name: "New Custom Image" })).toBeTruthy();
  expect(within(document.body).queryByRole("option", { name: "Old Custom Image" })).toBeNull();
});

it("makes a normalized synced image model selectable for an existing provider", async () => {
  const staticModels = getModelsByProviderId("openai");
  const rows = normalizeSyncedModels([{ id: "gpt-image-sync-fixture", kind: "image", display_name: "Synced Image Fixture" }], staticModels);
  const catalog = mergeSyncedCatalog(null, rows, { now: Date.parse("2026-01-01T00:00:00Z"), staticModels });
  const models = effectiveSyncedModels(catalog, staticModels);
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/tunnel/status") return Response.json({});
    if (url === "/api/providers/client") return Response.json({ connections: [] });
    if (url === "/api/models/custom") return Response.json({ models: [{ providerAlias: "openai", id: "custom-image", name: "Custom Image", kind: "image" }] });
    if (url === "/api/models/auto-sync?provider=openai") return Response.json({ providers: { openai: { eligible: true, models } } });
    if (url === "/api/v1/images/generations") {
      expect(JSON.parse(options.body).model).toBe("openai/gpt-image-sync-fixture");
      return Response.json({ data: [{ b64_json: "aGVsbG8=" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  const view = await render(GenericExampleCard, { providerId: "openai", kind: "image" });
  expect(view.getByRole("region", { name: "Request example" }).textContent).toContain("openai/gpt-image");
  await act(async () => view.getByRole("combobox", { name: "Model" }).click());
  expect(within(document.body).getAllByRole("option", { name: /GPT Image/ }).length).toBeGreaterThan(0);
  expect(within(document.body).getByRole("option", { name: "Custom Image" })).toBeTruthy();
  await act(async () => within(document.body).getByRole("option", { name: "Synced Image Fixture" }).click());
  expect(view.getByRole("region", { name: "Request example" }).textContent).toContain("openai/gpt-image-sync-fixture");
  await act(async () => view.getByRole("button", { name: "Run" }).click());
  expect(view.getByRole("img", { name: "Generated" }).getAttribute("src")).toContain("aGVsbG8=");
});
