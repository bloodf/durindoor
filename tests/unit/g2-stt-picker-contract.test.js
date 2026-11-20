// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import { SttExampleCard } from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/SttExampleCard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  root = null;
  vi.unstubAllGlobals();
});

it.each(["removed", "retagged"])("reconciles a %s custom STT choice before showing or sending multipart", async (change) => {
  let models = [{ id: "team/custom-whisper", name: "Team Whisper", providerAlias: "local-whisper", type: "stt" }];
  const sent = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/tunnel/status") return Response.json({});
    if (url === "/api/models/custom") return Response.json({ models });
    if (url === "/api/v1/audio/transcriptions") {
      sent.push(options);
      return Response.json({ text: "Fixture transcription" });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(SttExampleCard, { providerId: "local-whisper" })));
  const view = within(host);
  await act(async () => view.getByRole("combobox", { name: "Model" }).click());
  await act(async () => within(document.body).getByRole("option", { name: "Team Whisper" }).click());
  const input = view.getByLabelText("Audio file");
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["fixture"], "sample.wav", { type: "audio/wav" })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(view.getByRole("region", { name: "Request example" }).textContent).toContain('-F "model=local-whisper/team/custom-whisper"');
  await act(async () => view.getByRole("button", { name: "Run" }).click());
  expect(sent).toHaveLength(1);
  expect(sent[0].body.get("model")).toBe("local-whisper/team/custom-whisper");

  models = change === "removed" ? [] : [{ ...models[0], type: "llm" }];
  await act(async () => window.dispatchEvent(new Event("customModelChanged")));
  const snippet = view.getByRole("region", { name: "Request example" }).textContent;
  expect(view.getByRole("combobox", { name: "Model" }).textContent).toContain("Local Whisper");
  expect(snippet).toContain("/v1/audio/transcriptions");
  expect(snippet).toContain('-F "file=@sample.wav"');
  expect(snippet).toContain('-F "model=local-whisper/whisper-1"');
  expect(snippet).not.toContain("team/custom-whisper");
  await act(async () => view.getByRole("button", { name: "Run" }).click());
  expect(sent).toHaveLength(2);
  expect(sent[1].method).toBe("POST");
  expect(sent[1].body.get("model")).toBe("local-whisper/whisper-1");
  expect(sent[1].body.get("file").name).toBe("sample.wav");
  expect(sent[1].body.get("response_format")).toBe("json");
  expect(view.getByRole("region", { name: "Response output" }).textContent).toContain("Fixture transcription");
});


it("ignores an older focus response after a newer catalog refresh", async () => {
  const pending = [];
  let initial = true;
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/tunnel/status") return Response.json({});
    if (url === "/api/models/custom") {
      if (initial) {
        initial = false;
        return Response.json({ models: [] });
      }
      return new Promise((resolve) => pending.push(resolve));
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(SttExampleCard, { providerId: "local-whisper" })));
  const view = within(host);
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => window.dispatchEvent(new Event("customModelChanged")));
  expect(pending).toHaveLength(2);
  await act(async () => pending[1](Response.json({ models: [{ id: "team/current", name: "Current Whisper", providerAlias: "local-whisper", type: "stt" }] })));
  await act(async () => view.getByRole("combobox", { name: "Model" }).click());
  await act(async () => within(document.body).getByRole("option", { name: "Current Whisper" }).click());
  await act(async () => pending[0](Response.json({ models: [{ id: "team/removed", name: "Removed Whisper", providerAlias: "local-whisper", type: "stt" }] })));
  expect(view.getByRole("region", { name: "Request example" }).textContent).toContain('-F "model=local-whisper/team/current"');
  await act(async () => view.getByRole("combobox", { name: "Model" }).click());
  expect(within(document.body).queryByRole("option", { name: "Removed Whisper" })).toBeNull();
  expect(within(document.body).getByRole("option", { name: "Current Whisper" })).toBeTruthy();
});

it("invalidates a pending catalog response when the provider changes", async () => {
  let resolveOld;
  let first = true;
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/tunnel/status") return Response.json({});
    if (url === "/api/models/custom") {
      if (first) {
        first = false;
        return new Promise((resolve) => { resolveOld = resolve; });
      }
      return Response.json({ models: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(SttExampleCard, { providerId: "local-whisper" })));
  await act(async () => root.render(React.createElement(SttExampleCard, { providerId: "openai" })));
  await act(async () => resolveOld(Response.json({ models: [{ id: "team/old", name: "Old Whisper", providerAlias: "local-whisper", type: "stt" }] })));
  await act(async () => within(host).getByRole("combobox", { name: "Model" }).click());
  expect(within(document.body).queryByRole("option", { name: "Old Whisper" })).toBeNull();
});
