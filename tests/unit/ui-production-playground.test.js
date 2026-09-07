import { describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

const { getConnectionOptions, getModelReasoningOptions, groupModelsByProvider, normalizeReasoningEffort, paginateSessions } = await import(
  "../../src/app/(dashboard)/dashboard/playground/playgroundHelpers.js"
);

describe("ui-production-playground", () => {
  it("preserves the public helpers surface so sibling lanes stay compatible", () => {
    expect(typeof getConnectionOptions).toBe("function");
    expect(typeof getModelReasoningOptions).toBe("function");
    expect(typeof groupModelsByProvider).toBe("function");
    expect(typeof normalizeReasoningEffort).toBe("function");
    expect(typeof paginateSessions).toBe("function");
  });

  it("keeps connection options stable: auto first, then per-connection label", () => {
    const group = {
      connections: [
        { id: "codex-primary", name: "Codex Primary" },
        { id: "codex-backup", email: "backup@example.com" },
      ],
    };
    const options = getConnectionOptions(group);
    expect(options[0]).toEqual({ value: "auto", label: "Auto" });
    expect(options[1]).toEqual({ value: "codex-primary", label: "Codex Primary" });
    expect(options[2]).toEqual({ value: "codex-backup", label: "backup@example.com" });
  });

  it("returns null reasoning options when provider or model is missing", () => {
    expect(getModelReasoningOptions(null, "m")).toBeNull();
    expect(getModelReasoningOptions("codex", null)).toBeNull();
  });

  it("normalizes persisted reasoning effort to auto when unsupported", () => {
    expect(normalizeReasoningEffort(["auto", "low", "high"], "medium")).toBe("auto");
    expect(normalizeReasoningEffort(["auto", "low"], "low")).toBe("low");
    expect(normalizeReasoningEffort(null, "low")).toBe("auto");
  });

  it("groups and dedupes models by provider, drops empty providers", () => {
    const connections = [
      { providerId: "codex", providerName: "Codex" },
      { providerId: "claude", providerName: "Claude" },
      { providerId: "empty", providerName: "Empty" },
    ];
    const models = [
      { providerId: "codex", id: "codex/a", name: "Alpha" },
      { providerId: "codex", id: "codex/a", name: "Alpha" },
      { providerId: "codex", id: "codex/b", name: "Bravo" },
      { providerId: "claude", id: "claude/x", name: "Xray" },
    ];
    const groups = groupModelsByProvider(connections, models);
    const byId = Object.fromEntries(groups.map((group) => [group.providerId, group.models.map((model) => model.id).sort()]));
    expect(byId).toEqual({ codex: ["codex/a", "codex/b"], claude: ["claude/x"] });
  });

  it("clamps pagination back to the last page when the list shrinks", () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ id: `s${index + 1}` }));
    const page3 = paginateSessions(items, 3, 10);
    expect(page3.page).toBe(3);
    expect(page3.items).toHaveLength(5);
    const short = paginateSessions(items.slice(0, 5), 9, 10);
    expect(short.page).toBe(1);
    expect(short.items).toHaveLength(5);
  });
});
