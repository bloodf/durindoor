// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import { TtsExampleCard } from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/TtsExampleCard.js";

// Local catalog/transport contract only; no provider capability is proved live.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  root = null;
});

it("offers Fish speech models and sends the selected catalog ID without Edge voices", async () => {
  const fetchMock = vi.fn(async (url) => {
    if (url === "/api/tunnel/status") return Response.json({});
    if (url === "/api/v1/audio/speech") return Response.json({ error: "Inert speech fixture" }, { status: 400 });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(TtsExampleCard, { providerId: "fish-audio" })));
  const view = within(host);
  const request = () => view.getByRole("region", { name: "Request example" }).textContent;
  expect(request()).toContain('"model":"fish/s2.1-pro-free"');
  expect(request()).toContain("/v1/audio/speech");
  expect(view.queryByRole("button", { name: "Select language" })).toBeNull();
  await act(async () => view.getByRole("combobox", { name: "Model" }).click());
  expect(within(document.body).getAllByRole("option")).toHaveLength(4);
  for (const name of ["S2.1 Pro Free", "S2.1 Pro", "S2 Pro", "S1"]) {
    expect(within(document.body).getByRole("option", { name, exact: true })).toBeTruthy();
  }
  await act(async () => within(document.body).getByRole("option", { name: "S1", exact: true }).click());
  expect(request()).toContain('"model":"fish/s1"');
  await act(async () => view.getByRole("button", { name: "Run" }).click());
  const speechCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/v1/audio/speech");
  expect(speechCalls).toHaveLength(1);
  expect(speechCalls[0][1].method).toBe("POST");
  expect(JSON.parse(speechCalls[0][1].body)).toEqual({
    model: "fish/s1", input: "Hello, this is a text to speech test.",
  });
  expect(view.getByRole("alert").textContent).toBe("Inert speech fixture");
});
