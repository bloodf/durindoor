// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProviderCard from "../../src/app/(dashboard)/dashboard/providers/components/ProviderCard.js";
import ApiKeyProviderCard from "../../src/app/(dashboard)/dashboard/providers/components/ApiKeyProviderCard.js";
import ProviderTestResultsView from "../../src/app/(dashboard)/dashboard/providers/components/ProviderTestResultsView.js";

let host, root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (Component, props) => act(() => root.render(React.createElement(Component, props)));
const stats = (extra) => ({ connected: 1, error: 0, total: 1, allDisabled: false, ...extra });
const provider = { id: "openai", name: "OpenAI" };

describe("providers overview cards", () => {
  it.each([
    ["ProviderCard", ProviderCard],
    ["ApiKeyProviderCard", ApiKeyProviderCard],
  ])("%s links to the provider and shows its connection status", (_name, Card) => {
    render(Card, { providerId: "openai", provider, stats: stats({ error: 2, errorCode: "AUTH" }), onToggle: vi.fn() });
    expect(host.querySelector("a").getAttribute("href")).toBe("/dashboard/providers/openai");
    expect(host.textContent).toContain("1 Connected");
    expect(host.textContent).toContain("2 Error (AUTH)");
  });

  // The two cards report different toggle arguments; the page handlers depend on it.
  it.each([[false, false], [true, true]])("ProviderCard with allDisabled=%s toggles with %s", (allDisabled, expected) => {
    const onToggle = vi.fn();
    render(ProviderCard, { providerId: "openai", provider, stats: stats({ allDisabled }), onToggle });
    act(() => host.querySelector('[role="switch"]').click());
    expect(onToggle).toHaveBeenCalledWith(expected);
  });

  it.each([false, true])("ApiKeyProviderCard toggles with its allDisabled=%s state", (allDisabled) => {
    const onToggle = vi.fn();
    render(ApiKeyProviderCard, { providerId: "openai", provider, stats: stats({ allDisabled }), onToggle });
    act(() => host.querySelector('[role="switch"]').click());
    expect(onToggle).toHaveBeenCalledWith(allDisabled);
  });

  it("ProviderCard flips the no-auth switch instead of the connection switch", () => {
    const onToggleNoAuth = vi.fn();
    render(ProviderCard, { providerId: "free", provider: { ...provider, noAuth: true }, stats: stats(), noAuthEnabled: true, onToggleNoAuth });
    act(() => host.querySelector('[role="switch"]').click());
    expect(onToggleNoAuth).toHaveBeenCalledWith(false);
  });

  it("renders a batch test summary, rows and the request failure state", () => {
    render(ProviderTestResultsView, { results: { mode: "apikey", summary: { passed: 1, failed: 0, total: 1 }, results: [{ connectionId: "c1", connectionName: "Primary", provider: "openai", valid: true, latencyMs: 12 }] } });
    for (const text of ["API Key Test", "1 passed", "1 tested", "Primary", "12ms", "OK"]) expect(host.textContent).toContain(text);
    render(ProviderTestResultsView, { results: { error: "Test failed" } });
    expect(host.textContent).toContain("Test failed");
  });
});
