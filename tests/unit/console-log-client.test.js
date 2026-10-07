// @vitest-environment happy-dom
/**
 * Rendered behaviour of the Console Log viewer: level/tag/search filters,
 * pause with the "N new" pill, clear, windowed rendering, copy and download.
 * The transport is replaced so tests drive SSE events directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const transport = vi.hoisted(() => ({ handlers: null, stop: null, invalidate: null }));

vi.mock("@/app/(dashboard)/dashboard/console-log/transport.js", () => ({
  startConsoleLogTransport: (handlers) => {
    transport.handlers = handlers;
    return { ready: Promise.resolve(), stop: transport.stop, invalidate: transport.invalidate };
  },
}));

import ConsoleLogClient from "@/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js";

const LINES = [
  "[17:48:00] ℹ️  [BOOT] gateway listening on :20128",
  "[17:48:01] ℹ️  [HEADROOM] compression proxy online",
  "[17:48:02] 🟢 → POST gpt-5.5 → codex/gpt-5.5",
  "[17:48:04] ⚠️  [HEADROOM] compression skipped: payload under threshold",
  "[17:48:05] ❌ [TIER] provider timeout after 30000ms",
  "[17:48:06] [DEBUG] [CACHE] miss for combo default",
];

let container;
let root;

function emit(message) {
  act(() => transport.handlers.onEvent(message));
}

function visibleLabel(element) {
  const copy = element.cloneNode(true);
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent.trim();
}

function button(name) {
  const match = [...container.querySelectorAll('button:not([role="combobox"])')].find((element) => visibleLabel(element) === name);
  if (!match) throw new Error(`button not found: ${name}`);
  return match;
}

function levelChip(label) {
  const group = container.querySelector('[role="group"][aria-label="Filter by log level"]');
  const match = [...group.querySelectorAll("button")].find((element) => element.firstElementChild?.textContent === label);
  if (!match) throw new Error(`level chip not found: ${label}`);
  return match;
}

function chipCount(label) {
  return Number(levelChip(label).lastElementChild.textContent);
}

function tagOptions() {
  return [...document.body.querySelectorAll('[role="listbox"] [role="option"]')];
}

function click(element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function rowTexts() {
  return [...container.querySelectorAll("[data-console-row]")].map((row) => row.textContent);
}

function counter() {
  return container.querySelector('[role="status"][aria-label$="log lines"]').getAttribute("aria-label");
}

function typeSearch(value) {
  const input = container.querySelector('input[aria-label="Search console logs"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  transport.handlers = null;
  transport.stop = vi.fn();
  transport.invalidate = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(React.createElement(ConsoleLogClient)));
  emit({ type: "init", logs: LINES });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConsoleLogClient", () => {
  it("renders parsed rows with live level counts", () => {
    expect(rowTexts()).toHaveLength(6);
    expect(chipCount("All")).toBe(6);
    expect(chipCount("Error")).toBe(1);
    expect(chipCount("Warn")).toBe(1);
    expect(chipCount("Info")).toBe(3);
    expect(chipCount("Debug")).toBe(1);

    emit({ type: "lines", lines: ["[17:48:07] ❌ [TIER] second failure"] });
    expect(chipCount("Error")).toBe(2);
    expect(counter()).toBe("7 of 7 log lines");
  });

  it("filters by level chip", () => {
    click(levelChip("Error"));
    expect(levelChip("Error").getAttribute("aria-pressed")).toBe("true");
    expect(rowTexts()).toEqual([expect.stringContaining("provider timeout")]);
    click(levelChip("All"));
    expect(levelChip("All").getAttribute("aria-pressed")).toBe("true");
    expect(levelChip("Error").getAttribute("aria-pressed")).toBe("false");
    expect(rowTexts()).toHaveLength(6);
  });

  it("filters by an observed tag from the tag select", () => {
    click(container.querySelector('[role="combobox"][aria-label="Filter by tag"]'));
    expect(tagOptions().map(visibleLabel)).toEqual(["All tags", "BOOT", "CACHE", "HEADROOM", "POST", "TIER"]);
    click(tagOptions().find((option) => visibleLabel(option) === "HEADROOM"));
    expect(rowTexts()).toHaveLength(2);
    expect(rowTexts().every((text) => text.includes("[HEADROOM]"))).toBe(true);
    expect(counter()).toBe("2 of 6 log lines");
    expect(chipCount("Warn")).toBe(1);
    expect(chipCount("All")).toBe(2);
  });

  it("searches case-insensitively and highlights matches", () => {
    typeSearch("COMPRESSION");
    expect(rowTexts()).toHaveLength(2);
    const marks = [...container.querySelectorAll("[data-console-row] mark")].map((mark) => mark.textContent);
    expect(marks).toEqual(["compression", "compression"]);
    typeSearch("no such line");
    expect(container.textContent).toContain("No matching console logs.");
  });

  it("highlights searches in the timestamp and displayed tag", () => {
    typeSearch("17:48:05");
    expect(rowTexts()).toEqual([expect.stringContaining("provider timeout")]);
    expect([...container.querySelectorAll("[data-console-row] mark")].map((mark) => mark.textContent)).toEqual(["17:48:05"]);
    typeSearch("[17:48:05]");
    expect([...container.querySelectorAll("[data-console-row] mark")].map((mark) => mark.textContent)).toEqual(["[17:48:05]"]);
    typeSearch("HEADROOM");
    expect(rowTexts()).toHaveLength(2);
    expect([...container.querySelectorAll("[data-console-row] mark")].map((mark) => mark.textContent)).toEqual(["HEADROOM", "HEADROOM"]);
  });

  it("counts arrivals beyond ring retention and resets the pause baseline on both clear paths", async () => {
    click(button("Pause"));
    emit({ type: "lines", lines: Array.from({ length: 2100 }, (_, index) => `arrival ${index}`) });
    expect(container.textContent).toContain("2100 new");
    expect(rowTexts()).toHaveLength(6);
    emit({ type: "clear" });
    expect(container.textContent).not.toContain("2100 new");
    emit({ type: "line", line: "after stream clear" });
    expect(container.textContent).toContain("1 new");
    expect(rowTexts()).toHaveLength(0);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    await act(async () => button("Clear").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).not.toContain("1 new");
    emit({ type: "lines", lines: ["after delete one", "after delete two"] });
    expect(container.textContent).toContain("2 new");
    click(button("Resume"));
    expect(rowTexts()).toEqual([expect.stringContaining("after delete one"), expect.stringContaining("after delete two")]);
  });

  it("freezes rows while paused, counts new lines, and jumps to latest", () => {
    click(button("Pause"));
    expect(container.textContent).toContain("Paused");
    emit({ type: "lines", lines: ["[17:49:00] 🟢 → POST one", "[17:49:01] 🟢 → POST two"] });
    emit({ type: "line", line: "[17:49:02] 🟢 → POST three" });
    expect(rowTexts()).toHaveLength(6);
    expect(container.textContent).toContain("3 new");

    click(button("Jump to latest"));
    expect(rowTexts()).toHaveLength(9);
    expect(rowTexts().at(-1)).toContain("POST three");
    expect(container.textContent).not.toContain("3 new");
    expect(container.textContent).toContain("Streaming");
  });

  it("resumes without losing lines that arrived while paused", () => {
    click(button("Pause"));
    emit({ type: "lines", lines: ["[17:49:00] 🟢 → POST late"] });
    click(button("Resume"));
    expect(rowTexts().at(-1)).toContain("POST late");
  });

  it("clears through the API and on the stream clear event", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => button("Clear").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(fetchMock).toHaveBeenCalledWith("/api/translator/console-logs", { method: "DELETE" });
    expect(transport.invalidate).toHaveBeenCalled();
    expect(container.textContent).toContain("No console logs yet.");

    emit({ type: "lines", lines: ["[17:50:00] after clear"] });
    expect(rowTexts()).toHaveLength(1);
    emit({ type: "clear" });
    expect(container.textContent).toContain("No console logs yet.");
  });

  it("renders only a window of rows for a full 2000-line buffer and keeps the ring size", () => {
    const many = Array.from({ length: 2001 }, (_, index) => `[18:00:00] 🟢 → POST line-${index}`);
    emit({ type: "init", logs: many });
    expect(counter()).toBe("2000 of 2000 log lines");
    const rendered = rowTexts();
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
    expect(rendered.at(-1)).toContain("line-2000");
    expect(rendered.some((text) => text.endsWith("line-1"))).toBe(false);
    const viewer = container.querySelector('[role="log"]');

    click(button("Wrap lines"));
    expect(rowTexts().length).toBeLessThan(100);
    expect(rowTexts().at(-1)).toContain("line-2000");
    act(() => {
      viewer.scrollTop = 0;
      viewer.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(rowTexts()[0]).toContain("line-1");
    expect(rowTexts().some((text) => text.endsWith("line-2000"))).toBe(false);
    click(button("Jump to latest"));
    expect(rowTexts().at(-1)).toContain("line-2000");
  });

  it("keeps multiline wrapped rows windowed as measured heights change", () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function measure() {
      return this.hasAttribute("data-console-row")
        ? { top: 0, left: 0, width: 320, height: 96, right: 320, bottom: 96 }
        : original.call(this);
    });
    emit({ type: "init", logs: Array.from({ length: 2000 }, (_, index) => `wrapped-${index}\nsecond line\nthird line`) });
    click(button("Wrap lines"));
    expect(rowTexts().length).toBeLessThan(100);
    expect(rowTexts().at(-1)).toContain("wrapped-1999");
    const viewer = container.querySelector('[role="log"]');
    act(() => {
      viewer.scrollTop = 0;
      viewer.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(rowTexts()[0]).toContain("wrapped-0");
    expect(rowTexts()[0]).toContain("third line");
    expect(rowTexts().some((text) => text.includes("wrapped-1999"))).toBe(false);
    click(button("Jump to latest"));
    expect(rowTexts().at(-1)).toContain("wrapped-1999");
  });

  it("copies the visible lines", () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard: { writeText } });
    click(levelChip("Error"));
    click(button("Copy visible"));
    expect(writeText).toHaveBeenCalledWith("[17:48:05] ❌ [TIER] provider timeout after 30000ms");
    expect(button("Copied")).toBeTruthy();
  });

  it("downloads the visible lines as a .log file", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:console");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const downloads = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function recordDownload() {
      downloads.push(this.download);
    });
    click(levelChip("Warn"));
    click(button("Download .log"));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^durindoor-console-.+\.log$/);
    const blob = createObjectURL.mock.calls[0][0];
    expect(await blob.text()).toBe("[17:48:04] ⚠️  [HEADROOM] compression skipped: payload under threshold\n");
  });
});
