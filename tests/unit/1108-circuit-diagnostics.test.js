import { describe, expect, it } from "vitest";
import { isConnectionRecoveryDiagnostic } from "../../open-sse/services/combo.js";

describe("#1108 bounded combo circuit diagnostics", () => {
  it("recognizes only the local recovery admission response", () => {
    expect(isConnectionRecoveryDiagnostic(503, "Connection recovery in progress")).toBe(true);
    expect(isConnectionRecoveryDiagnostic(503, "upstream secret or provider detail")).toBe(false);
    expect(isConnectionRecoveryDiagnostic(429, "Connection recovery in progress")).toBe(false);
  });
});
