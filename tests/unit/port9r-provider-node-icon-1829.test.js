import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveProviderNodeIcon } from "../../src/shared/utils/providerNodeIcon.js";

// 9router PR #1829: custom compatible provider nodes fall back to the initials
// of their own name, not a shared "OC"/"AC" badge, on the providers list and
// the provider detail page.

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(`${root}${rel}`, "utf8");

describe("compatible provider node icon fallback (9router #1829)", () => {
  it("uses name initials with the API-family color", () => {
    expect(resolveProviderNodeIcon({ id: "openai-compatible-chat-1", name: "groqish", type: "openai-compatible" }))
      .toEqual({ textIcon: "GR", color: "#10A37F" });
    expect(resolveProviderNodeIcon({ id: "anthropic-compatible-1", name: "my proxy", type: "anthropic-compatible" }))
      .toEqual({ textIcon: "MY", color: "#D97757" });
  });

  it("falls back to the node id when the name is blank", () => {
    expect(resolveProviderNodeIcon({ id: "openai-compatible-x", name: "  ", type: "openai-compatible" }).textIcon).toBe("OP");
  });

  it("keeps the family badge when neither name nor id is usable", () => {
    expect(resolveProviderNodeIcon({ type: "anthropic-compatible" }).textIcon).toBe("AC");
    expect(resolveProviderNodeIcon({ type: "openai-compatible" }).textIcon).toBe("OC");
    expect(resolveProviderNodeIcon(null).color).toBe("#6b7280");
  });

  it("distinguishes two custom nodes of the same family", () => {
    const a = resolveProviderNodeIcon({ id: "n1", name: "Alpha", type: "openai-compatible" });
    const b = resolveProviderNodeIcon({ id: "n2", name: "Beta", type: "openai-compatible" });
    expect(a.textIcon).not.toBe(b.textIcon);
  });

  it("the providers list and detail page use the helper instead of hard-coded OC/AC badges", () => {
    for (const rel of [
      "src/app/(dashboard)/dashboard/providers/page.js",
      "src/app/(dashboard)/dashboard/providers/[id]/page.js",
    ]) {
      const src = read(rel);
      expect(src).toContain("resolveProviderNodeIcon(");
      expect(src).not.toMatch(/textIcon:\s*"(?:OC|AC)"/);
      expect(src).not.toMatch(/textIcon:\s*providerNode\.type === "anthropic-compatible" \? "AC" : "OC"/);
    }
  });
});
