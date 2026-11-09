// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import { EmbeddingExampleCard } from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/EmbeddingExampleCard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  root = null;
  vi.unstubAllGlobals();
});

it("uses only the current provider embedding catalog after navigation", async () => {
  const requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/tunnel/status") return Response.json({});
    if (url === "/api/v1/embeddings") {
      requests.push(JSON.parse(options.body));
      return Response.json({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const view = within(host);
  await act(async () => root.render(React.createElement(EmbeddingExampleCard, { providerId: "openai" })));
  await act(async () => view.getByRole("combobox", { name: "Model" }).click());
  expect(within(document.body).queryByRole("option", { name: "GPT-4o" })).toBeNull();
  expect(within(document.body).queryByRole("option", { name: "DALL-E 3" })).toBeNull();
  await act(async () => within(document.body).getByRole("option", { name: "Text Embedding 3 Small", exact: true }).click());
  expect(view.getByRole("region", { name: "Request example" }).textContent).toContain('"model":"openai/text-embedding-3-small"');
  await act(async () => root.render(React.createElement(EmbeddingExampleCard, { providerId: "gemini" })));
  expect(view.getByRole("region", { name: "Request example" }).textContent).toContain('"model":"gemini/gemini-embedding-2-preview"');
  expect(view.getByRole("region", { name: "Request example" }).textContent).not.toContain("text-embedding-3-small");
  await act(async () => view.getByRole("combobox", { name: "Model" }).click());
  await act(async () => within(document.body).getByRole("option", { name: "Gemini Embedding 001", exact: true }).click());
  await act(async () => view.getByRole("button", { name: "Run" }).click());
  expect(requests).toEqual([{
    model: "gemini/gemini-embedding-001",
    input: "The quick brown fox jumps over the lazy dog",
  }]);
});
