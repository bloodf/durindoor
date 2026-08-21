import { describe, expect, it } from "vitest";
import {
  diagnosticView,
  externalInstallNote,
  formatExtrasSummary,
  hasCopyableCommand,
  hasLogTail,
  installActionLabel,
  reportFetchOutcome,
} from "@/shared/utils/setupDiagnosticView";

describe("setup diagnostic view", () => {
  it("marks command fixes as copyable", () => {
    expect(hasCopyableCommand({ label: "Install", command: "python -m pip install headroom-ai" })).toBe(true);
  });

  it("does not mark URL-only fixes as copyable", () => {
    expect(hasCopyableCommand({ label: "Read docs", url: "https://example.test/docs" })).toBe(false);
  });

  it("only shows log details for a nonempty log tail", () => {
    expect(hasLogTail({ logTail: "pip failed" })).toBe(true);
    expect(hasLogTail({ logTail: "  " })).toBe(false);
  });

  it("keeps unknown diagnostic content while supplying a fallback heading", () => {
    const diagnostic = {
      code: "FUTURE_FAILURE",
      summary: "A future setup check failed",
      detail: "Observed detail",
      fixes: [{ label: "Repair it", command: "repair-headroom" }],
    };

    expect(diagnosticView(diagnostic)).toEqual({
      heading: "Headroom setup needs attention",
      summary: diagnostic.summary,
      detail: diagnostic.detail,
      fixes: diagnostic.fixes,
    });
  });

  it("distinguishes absent, partial, and complete compression extras", () => {
    expect(formatExtrasSummary({ code: false, ml: false })).toBe("Compression extras: code absent, ml absent.");
    expect(formatExtrasSummary({ code: true, ml: false })).toBe("Compression extras: code present, ml absent.");
    expect(formatExtrasSummary({ code: true, ml: true })).toBe("Compression extras: code present, ml present.");
  });
});

describe("externalInstallNote", () => {
  it("names the manager that produced the install when known", () => {
    expect(externalInstallNote({ manager: "pipx" })).toContain("installed with pipx");
  });

  it("never hardcodes a uv command, so a pipx user is not sent a failing one", () => {
    // Regression: the note used to end with "Remove it with: uv tool uninstall
    // headroom-ai" regardless of how the install was made. Wrong guidance is
    // worse than none, because it teaches the operator to distrust the rest.
    for (const manager of ["uv", "pipx", "unknown", undefined]) {
      const note = externalInstallNote(manager ? { manager } : undefined);
      expect(note).not.toContain("uv tool uninstall");
      expect(note).not.toContain("pipx uninstall");
    }
  });

  it("omits the manager phrase when it could not be determined", () => {
    expect(externalInstallNote({ manager: "unknown" })).not.toContain("installed with");
  });
});

describe("installActionLabel", () => {
  it("offers a full install when nothing is installed", () => {
    // Regression: the panel only ever said "Install compression extras", which
    // reads as an add-on to something absent, and the status refresh returned
    // early before this panel rendered at all on a fresh host.
    expect(installActionLabel({ installed: false })).toBe("Install Headroom with compression extras");
    expect(installActionLabel(undefined)).toBe("Install Headroom with compression extras");
  });

  it("names only the extras that are actually missing", () => {
    expect(installActionLabel({ installed: true, extras: { code: true, ml: false } }))
      .toBe("Install missing ml extra");
    expect(installActionLabel({ installed: true, extras: { code: false, ml: false } }))
      .toBe("Install missing code and ml extras");
  });

  it("offers a reinstall when everything is already present", () => {
    expect(installActionLabel({ installed: true, extras: { code: true, ml: true } }))
      .toBe("Reinstall compression extras");
  });
});

describe("reportFetchOutcome", () => {
  it("keeps a 200 payload that carries an informational diagnostic", () => {
    // Regression: GET /api/headroom/status answers 200 with NOT_INSTALLED (or
    // any advisory) plus a valid payload. Treating that as a transport failure
    // reset installed/running to false, so an installed and running proxy read
    // as "not installed" and the repair panel was hidden.
    const outcome = reportFetchOutcome(true, {
      installed: true, running: true, diagnostic: { code: "NOT_INSTALLED" },
    });
    expect(outcome.applyPayload).toBe(true);
    expect(outcome.resetState).toBe(false);
    expect(outcome.diagnostic.code).toBe("NOT_INSTALLED");
  });

  it("applies a clean 200 with no diagnostic", () => {
    const outcome = reportFetchOutcome(true, { installed: true });
    expect(outcome).toEqual({ applyPayload: true, resetState: false, diagnostic: null });
  });

  it("resets state only when the response itself failed", () => {
    const outcome = reportFetchOutcome(false, { diagnostic: { code: "INTERNAL_ERROR" } });
    expect(outcome.resetState).toBe(true);
    expect(outcome.applyPayload).toBe(false);
    expect(outcome.diagnostic.code).toBe("INTERNAL_ERROR");
  });
});
