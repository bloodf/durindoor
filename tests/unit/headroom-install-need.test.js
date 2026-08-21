import { describe, expect, it } from "vitest";

import { DEFAULT_HEADROOM_EXTRAS, resolveInstallNeed } from "@/lib/autoConfigure/headroom.js";

/**
 * Regression for the reported bug's most stubborn form.
 *
 * The operator's host had headroom installed by `uv tool install
 * "headroom-ai[proxy]"`: present on PATH, so `installed` was true, but with the
 * `code` and `ml` compression extras absent and living in a pip-less,
 * user-scoped venv that can never be repaired in place.
 *
 * Auto-configure used to gate the install on `!installed`, so it skipped the
 * install entirely and the extras never arrived — the exact symptom that was
 * reported. Presence is not completeness.
 */
describe("resolveInstallNeed", () => {
  it("installs when headroom is absent entirely", () => {
    const need = resolveInstallNeed({ installed: false });
    expect(need.needed).toBe(true);
    expect(need.reason).toContain("not installed");
  });

  it("installs when a PATH-only proxy install reports installed but lacks the extras", () => {
    const need = resolveInstallNeed({
      installed: true,
      source: "path",
      extras: { code: false, ml: false },
    });
    expect(need.needed).toBe(true);
    expect(need.reason).toContain("code");
    expect(need.reason).toContain("ml");
  });

  it("installs when only one compression extra is missing", () => {
    const need = resolveInstallNeed({
      installed: true,
      source: "managed",
      extras: { code: true, ml: false },
    });
    expect(need.needed).toBe(true);
    expect(need.reason).toContain("ml");
    expect(need.reason).not.toContain("code");
  });

  it("installs when every extra is present but the install is not the managed venv", () => {
    // A PATH install cannot be repaired in place, so DurinDoor takes ownership.
    const need = resolveInstallNeed({
      installed: true,
      source: "path",
      extras: { code: true, ml: true },
    });
    expect(need.needed).toBe(true);
    expect(need.reason).toContain("managed venv");
  });

  it("does nothing when the managed venv already has every requested extra", () => {
    const need = resolveInstallNeed({
      installed: true,
      source: "managed",
      extras: { code: true, ml: true },
    });
    expect(need.needed).toBe(false);
  });

  it("honours a narrowed extras request", () => {
    // Asking for proxy+code must not demand ml.
    const need = resolveInstallNeed(
      { installed: true, source: "managed", extras: { code: true, ml: false } },
      ["proxy", "code"],
    );
    expect(need.needed).toBe(false);
  });

  it("requests proxy, code and ml by default", () => {
    expect(DEFAULT_HEADROOM_EXTRAS).toEqual(["proxy", "code", "ml"]);
  });
});
