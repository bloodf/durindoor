import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReadinessEvidence, { ReadinessEvidenceDetails } from "../../src/app/(dashboard)/dashboard/providers/[id]/ReadinessEvidence.jsx";

describe("provider readiness display", () => {
  it("shows local configuration separately from unknown live evidence", () => {
    const html = renderToStaticMarkup(React.createElement(ReadinessEvidenceDetails, { data: {
      catalog: "LISTED", chatDispatch: "CONFIGURED", nativeKinds: ["chat", "live"],
      authentication: { status: "UNKNOWN" }, inference: { status: "UNKNOWN" },
    } }));
    expect(html).toContain("Listed");
    expect(html).toContain("Configured, not verified");
    expect(html).toContain("Unknown — no fresh timestamped evidence");
    expect(html).toContain("Unknown — no account, model and operation-bound evidence");
    expect(html).toContain("chat, live");
    expect(html).toContain("Unlisted native operations are unsupported");
    expect(html).toContain("Missing or stale evidence");
  });

  it("fails closed for missing data and identifies unsupported dispatch", () => {
    const html = renderToStaticMarkup(React.createElement(ReadinessEvidenceDetails, { data: { chatDispatch: "UNSUPPORTED" } }));
    expect(html).toContain("Unsupported");
    expect(html).toContain("none reported");
    expect(html).toContain("Unknown");
  });

  it("starts in a loading state without making a server-side request", () => {
    const html = renderToStaticMarkup(React.createElement(ReadinessEvidence, { providerId: "openai" }));
    expect(html).toContain("Loading local readiness evidence");
  });
});
