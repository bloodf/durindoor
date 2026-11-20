// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import { GenericExampleCard } from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  root = null;
});

it("shows the Together async video contract without rewriting the vendor model ID", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/tunnel/status") return Response.json({});
    if (url === "/api/providers/client") return Response.json({ connections: [] });
    throw new Error(`Unexpected request: ${url}`);
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(GenericExampleCard, { providerId: "together", kind: "video" })));
  const example = within(host).getByRole("region", { name: "Request example" }).textContent;
  expect(example).toContain("curl -X POST ");
  expect(example).toContain("/v1/videos/generations");
  expect(example).toContain('"model":"together/minimax/video-01-director"');
  expect(example).toContain('"prompt":"A serene lake at sunset"');
  expect(example).not.toContain("/v1/video/generations");
  expect(fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});
