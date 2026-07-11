/**
 * F2a2 — auto-combo resolver seam.
 *
 * Covers the resolver module that backs `auto/<family>` virtual combos. The
 * resolver is self-contained (no F2a1 family-helper import yet); F2a1 swaps the
 * detection rule once PATCHES_DONE lands. Three cases per the assignment.
 */

import { describe, it, expect } from "vitest";
import {
  AUTO_COMBO_PREFIX,
  isAutoComboId,
  familyOfAutoId,
  resolveAutoCombo,
} from "../../open-sse/services/autoComboResolver.js";

describe("auto-combo resolver (F2a2)", () => {
  it("empty pool fast-fails: unrecognized/empty catalog yields [] (never null)", () => {
    // Recognized auto id with an empty catalog → empty array (truthy), so the
    // caller enters the combo path and fails fast instead of falling through to
    // a literal "auto" provider or a DB miss.
    expect(isAutoComboId("auto/glm")).toBe(true);
    expect(familyOfAutoId("auto/glm")).toBe("glm");
    const out = resolveAutoCombo("glm", {});
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([]);

    // Case-insensitive family segment; ids are matched lowercase.
    expect(familyOfAutoId("auto/GLM")).toBe("glm");
    expect(resolveAutoCombo("GLM", {})).toEqual([]);

    // Not an auto id → not recognized.
    expect(isAutoComboId("glm/glm-5.2")).toBe(false);
    expect(isAutoComboId("myCombo")).toBe(false);
    // Unknown family segment is NOT a valid auto id (no fail-fast masking typos).
    expect(isAutoComboId("auto/foo")).toBe(false);
    expect(familyOfAutoId("auto/foo")).toBe(null);
    expect(AUTO_COMBO_PREFIX).toBe("auto/");
  });

  it("auto/zai is a provider-override family (pools zai alias, not zai-* ids)", () => {
    // zai is never detected from a model id; auto/zai matches the catalog alias.
    expect(isAutoComboId("auto/zai")).toBe(true);
    expect(resolveAutoCombo("zai", { zai: [{ id: "glm-5.2" }] })).toEqual(["zai/glm-5.2"]);
    // Other providers' glm ids are NOT pulled into auto/zai.
    expect(resolveAutoCombo("zai", { glm: [{ id: "glm-5.2" }], zai: [{ id: "glm-5.1" }] })).toEqual(["zai/glm-5.1"]);
  });

  it("nested catalog ids keep their alias (Fireworks-style)", () => {
    // `accounts/fireworks/models/glm-5p2` under alias `fireworks` must route as
    // `fireworks/accounts/fireworks/models/glm-5p2` — the id is NOT prequalified
    // because its first segment (`accounts`) is not the alias.
    const catalog = { fireworks: [{ id: "accounts/fireworks/models/glm-5p2" }] };
    expect(resolveAutoCombo("glm", catalog)).toEqual(["fireworks/accounts/fireworks/models/glm-5p2"]);
  });

  it("family resolves across providers and dedupes", () => {
    const catalog = {
      glm: [{ id: "glm-5.2" }, { id: "glm-5.1" }],
      zai: [{ id: "glm-5.2" }], // zai serves glm-* ids
      minimax: [{ id: "minimax-m2.7" }],
    };
    const out = resolveAutoCombo("glm", catalog);
    // Members are qualified provider/model, deduped, glm-anchored only.
    expect(out).toEqual(["glm/glm-5.2", "glm/glm-5.1", "zai/glm-5.2"]);
    expect(out).not.toContain("minimax/minimax-m2.7");
  });

  it("auto/glm returns glm models and tolerates catalog entry shapes", () => {
    const catalog = {
      // bare string entries + already-qualified id (no double-prefix) + {id}
      glm: ["glm-5.2", { id: "glm-5" }, { id: "glm/glm-4.7" }, { id: "chatgpt-4o" }],
    };
    const out = resolveAutoCombo("glm", catalog);
    // chatgpt-4o is not glm-anchored → excluded; glm/glm-4.7 not double-prefixed.
    expect(out).toEqual(["glm/glm-5.2", "glm/glm-5", "glm/glm-4.7"]);
    expect(out.every((m) => /\/glm-/i.test(m))).toBe(true);
  });
});
