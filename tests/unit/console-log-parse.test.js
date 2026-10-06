import { describe, expect, it } from "vitest";
import { parseConsoleLine } from "@/app/(dashboard)/dashboard/console-log/parseConsoleLine.js";
import {
  EMPTY_CONSOLE_LOG,
  appendConsoleLines,
  clearConsoleEntries,
  countConsoleEntriesSince,
  reconcileConsoleSnapshot,
} from "@/app/(dashboard)/dashboard/console-log/consoleLogEntries.js";

describe("parseConsoleLine", () => {
  it("extracts the leading [HH:MM:SS] timestamp and strips it from the message", () => {
    expect(parseConsoleLine("[17:48:00] ℹ️  [BOOT] listening on :20128")).toEqual({
      ts: "17:48:00",
      level: "info",
      tag: "BOOT",
      message: "ℹ️  [BOOT] listening on :20128",
      raw: "[17:48:00] ℹ️  [BOOT] listening on :20128",
    });
  });

  it("returns a null timestamp when the line has no leading stamp", () => {
    const parsed = parseConsoleLine("plain output [12:00:00] later");
    expect(parsed.ts).toBeNull();
    expect(parsed.message).toBe("plain output [12:00:00] later");
  });

  it.each([
    ["❌ glyph", "[10:00:00] ❌ [TIER] provider timeout"],
    ["[ERROR] marker", "[10:00:00] [ERROR] boom"],
    ["Error: text", "TypeError: Cannot read properties of undefined"],
  ])("classifies %s as error", (_label, line) => {
    expect(parseConsoleLine(line).level).toBe("error");
  });

  it.each([
    ["⚠️ glyph", "[10:00:00] ⚠️  [HEADROOM] compression skipped"],
    ["⚠ without variation selector", "[10:00:00] ⚠ queue depth high"],
    ["[WARN] marker", "[WARN] queue depth high"],
  ])("classifies %s as warn", (_label, line) => {
    expect(parseConsoleLine(line).level).toBe("warn");
  });

  it("classifies [DEBUG] as debug and everything else as info", () => {
    expect(parseConsoleLine("[10:00:00] [DEBUG] cache miss").level).toBe("debug");
    expect(parseConsoleLine("[10:00:00] [INFO] ready").level).toBe("info");
    expect(parseConsoleLine("[10:00:00] 🟢 → POST gpt-5.5 → codex/gpt-5.5").level).toBe("info");
    expect(parseConsoleLine("").level).toBe("info");
  });

  it("prefers error over warn when both markers are present", () => {
    expect(parseConsoleLine("⚠️ retry failed: Error: socket hang up").level).toBe("error");
  });

  it("uses the first [WORD] token as the tag", () => {
    expect(parseConsoleLine("[10:00:00] ℹ️  [HEADROOM] online").tag).toBe("HEADROOM");
    expect(parseConsoleLine("[10:00:00] [TIER] CODEX routed [ROUTE] x").tag).toBe("TIER");
    expect(parseConsoleLine("[10:00:00] 📊 [USAGE] in=1").tag).toBe("USAGE");
  });

  it("skips level markers when choosing the bracket tag", () => {
    expect(parseConsoleLine("[10:00:00] [DEBUG] [CACHE] miss").tag).toBe("CACHE");
    expect(parseConsoleLine("[WARN] [QUEUE] depth high").tag).toBe("QUEUE");
    expect(parseConsoleLine("[ERROR] boom").tag).toBeNull();
  });

  it.each(["POST", "DONE", "GET", "CANCELLED"])("falls back to the first word %s, skipping leading glyphs", (word) => {
    expect(parseConsoleLine(`[10:00:00] 🟢 📊 ${word} 812ms · IN 10`).tag).toBe(word);
    expect(parseConsoleLine(`${word} /v1/chat/completions`).tag).toBe(word);
  });

  it("has no tag when the first word is not a request verb", () => {
    expect(parseConsoleLine("[10:00:00] 🟢 → PUT /v1/x POST").tag).toBeNull();
    expect(parseConsoleLine("Listening on port 3000").tag).toBeNull();
    expect(parseConsoleLine("post lowercase").tag).toBeNull();
  });

  it("coerces non-string input", () => {
    expect(parseConsoleLine(undefined)).toMatchObject({ raw: "", message: "", ts: null, tag: null });
    expect(parseConsoleLine(42).raw).toBe("42");
  });
});

describe("console log entries", () => {
  it("appends parsed entries with increasing ids and trims to the ring size", () => {
    const state = appendConsoleLines(EMPTY_CONSOLE_LOG, ["a", "b", "c", "d"], 3);
    expect(state.entries.map((entry) => [entry.id, entry.raw])).toEqual([[1, "b"], [2, "c"], [3, "d"]]);
    expect(state.nextId).toBe(4);
  });

  it("keeps ids for lines a snapshot still contains and appends the rest", () => {
    const state = appendConsoleLines(EMPTY_CONSOLE_LOG, ["a", "b", "c"]);
    const next = reconcileConsoleSnapshot(state, ["b", "c", "d", "e"]);
    expect(next.entries.map((entry) => [entry.id, entry.raw])).toEqual([[1, "b"], [2, "c"], [3, "d"], [4, "e"]]);
    expect(countConsoleEntriesSince(next, state.nextId)).toBe(2);
  });

  it("returns the same state for an unchanged snapshot", () => {
    const state = appendConsoleLines(EMPTY_CONSOLE_LOG, ["a", "b"]);
    expect(reconcileConsoleSnapshot(state, ["a", "b"])).toBe(state);
  });

  it("treats a snapshot without overlap as a replaced buffer", () => {
    const state = appendConsoleLines(EMPTY_CONSOLE_LOG, ["a", "b"]);
    const next = reconcileConsoleSnapshot(state, ["x", "y"]);
    expect(next.entries.map((entry) => [entry.id, entry.raw])).toEqual([[2, "x"], [3, "y"]]);
  });

  it("clears entries without resetting the id counter", () => {
    const state = clearConsoleEntries(appendConsoleLines(EMPTY_CONSOLE_LOG, ["a", "b"]));
    expect(state).toEqual({ entries: [], nextId: 2 });
    expect(appendConsoleLines(state, ["c"]).entries[0].id).toBe(2);
  });
});
