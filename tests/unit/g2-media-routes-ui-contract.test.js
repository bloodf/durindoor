// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/i18n/runtime", () => ({ translate: (text) => text }));
vi.mock("@/shared/components", () => ({ CardSkeleton: () => null }));

const { default: MediaRoutesPage } = await import("../../src/app/(dashboard)/dashboard/media-routes/page.js");

let root;
let container;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

it("labels endpoint results as the saved snapshot while a video draft changes, then refreshes on save", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Inert API snapshots mirror the local transport split: Veo sync, xAI jobs.
  // They assert presentation only; no provider availability is established.
  const route = {
    id: "video", label: "Video generation", endpoint: "/v1/video/generations",
    saved: ["xai/grok-imagine-video", "veoaifree-web/veo"],
    candidates: [
      { id: "xai/grok-imagine-video", name: "Grok Imagine Video" },
      { id: "veoaifree-web/veo", name: "VEO 3.1" },
    ],
    effective: ["xai/grok-imagine-video", "veoaifree-web/veo"],
    endpoints: [
      { path: "/v1/video/generations", effective: ["veoaifree-web/veo"] },
      { path: "/v1/videos", effective: ["xai/grok-imagine-video"] },
    ],
  };
  const saved = {
    ...route, saved: ["xai/grok-imagine-video"], effective: ["xai/grok-imagine-video"],
    endpoints: [
      { path: "/v1/video/generations", effective: [] },
      { path: "/v1/videos", effective: ["xai/grok-imagine-video"] },
    ],
  };
  const fetchMock = vi.fn(async (url, options) => {
    if (url !== "/api/media-providers/routes") throw new Error(`Unexpected fetch: ${url}`);
    return { ok: true, json: async () => options?.method === "PUT" ? { route: saved } : { routes: [route] } };
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(MediaRoutesPage)));

  expect(container.textContent).toContain("Endpoint compatibility reflects the last loaded or saved route.");
  expect(container.textContent).toContain("Catalog entries and local transport support do not verify live provider availability.");
  expect(container.textContent).not.toContain("Save changes to update endpoint compatibility.");
  await act(async () => container.querySelector('[aria-label="Remove veoaifree-web/veo"]').click());
  expect(container.querySelector('[aria-label="Remove veoaifree-web/veo"]')).toBeNull();
  expect(container.textContent).toContain("Save changes to update endpoint compatibility.");
  const syncRow = () => [...container.querySelectorAll("li")].find((row) => row.textContent.includes("/v1/video/generations"));
  expect(syncRow().textContent).toContain("veoaifree-web/veo");

  const saveButton = [...container.querySelectorAll("button")].find((button) => button.textContent.endsWith("Save"));
  expect(saveButton).toBeDefined();
  expect(saveButton.disabled).toBe(false);
  await act(async () => saveButton.click());
  expect(fetchMock).toHaveBeenCalledWith("/api/media-providers/routes", expect.objectContaining({
    method: "PUT", body: '{"kind":"video","models":["xai/grok-imagine-video"]}',
  }));
  expect(syncRow().textContent).toContain("no model in this route can run here");
  expect(syncRow().textContent).not.toContain("veoaifree-web/veo");
  expect(container.textContent).not.toContain("Save changes to update endpoint compatibility.");
});
