import { describe, it, expect } from "vitest";
import { configureToggles } from "../../../src/lib/autoConfigure/toggles.js";

describe("configureToggles", () => {
  it("enables RTK/Caveman/Ponytail with default levels", () => {
    const res = configureToggles({
      rtkEnabled: false,
      cavemanEnabled: false,
      cavemanLevel: "lite",
      ponytailEnabled: false,
      ponytailLevel: "lite",
    });
    expect(res.changed).toBe(true);
    expect(res.updates).toEqual({
      rtkEnabled: true,
      cavemanEnabled: true,
      cavemanLevel: "full",
      ponytailEnabled: true,
      ponytailLevel: "full",
    });
  });

  it("is idempotent", () => {
    const res = configureToggles({
      rtkEnabled: true,
      cavemanEnabled: true,
      cavemanLevel: "full",
      ponytailEnabled: true,
      ponytailLevel: "full",
    });
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(false);
  });

  it("dry-run reports changes without applying", () => {
    const res = configureToggles({
      rtkEnabled: false,
      cavemanEnabled: false,
      cavemanLevel: "lite",
      ponytailEnabled: false,
      ponytailLevel: "lite",
    }, { dryRun: true });
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(true);
    expect(res.updates).toEqual({});
  });
});
