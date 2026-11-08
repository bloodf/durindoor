import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ModelRow, { getDeclaredModelCapabilities } from "../../src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js";

const render = (testStatus) => renderToStaticMarkup(React.createElement(ModelRow, {
  model: { id: "example" }, fullModel: "provider/example", onCopy: () => {}, testStatus,
}));

describe("provider model inference evidence", () => {
  it.each([
    [undefined, "Inference not tested"],
    ["ok", "Inference passed in this session"],
    ["error", "Inference failed in this session"],
    ["skipped", "Inference skipped in this session"],
  ])("labels %s without relying on icon color", (status, label) => {
    expect(render(status)).toContain(label);
  });
});

const renderCapabilities = (model, override, caps = {}) => renderToStaticMarkup(
  React.createElement(ModelRow, {
    model: { id: "example", ...model }, fullModel: "provider/example", onCopy: () => {},
    caps, declaredCaps: getDeclaredModelCapabilities(model, override),
  }),
);

describe("provider model capability metadata", () => {
  it.each([
    [{ vision: true, tools: true }, "declared supported", "declared supported"],
    [{ vision: false, tools: false }, "declared unsupported", "declared unsupported"],
    [{}, "UNKNOWN", "UNKNOWN"],
    [{ vision: true, tools: false }, "declared supported", "declared unsupported"],
    [{ vision: false, tools: true }, "declared unsupported", "declared supported"],
    [{ vision: false }, "declared unsupported", "UNKNOWN"],
    [{ tools: false }, "UNKNOWN", "declared unsupported"],
  ])("distinguishes declared values and missing fields: %j", (capabilities, vision, tools) => {
    const html = renderCapabilities({ capabilities }, undefined, capabilities);
    expect(html).toContain(`Vision metadata: ${vision}`);
    expect(html).toContain(`Tools metadata: ${tools}`);
    expect(html).toContain("Inference not tested");
    if (capabilities.vision) expect(html).toContain('aria-label="Vision');
    if (capabilities.tools) expect(html).toContain('aria-label="Tools');
  });

  it("keeps fallback negatives unknown and positive badges intact", () => {
    const html = renderCapabilities({}, undefined, { vision: false, tools: true });
    expect(html).toContain("Vision metadata: UNKNOWN");
    expect(html).toContain("Tools metadata: UNKNOWN");
    expect(html).not.toContain("declared unsupported");
    expect(html).toContain('aria-label="Tools');
  });

  it("uses the provider snapshot rather than enriched pattern/default fields", () => {
    const html = renderCapabilities({
      capabilities: { vision: false, tools: false },
      metadataSources: { catalogSource: "pattern" },
      discoveredCapabilities: { tools: false },
    });
    expect(html).toContain("Vision metadata: UNKNOWN");
    expect(html).toContain("Tools metadata: declared unsupported");
  });

  it("keeps old enriched metadata without a declaration snapshot unknown", () => {
    const html = renderCapabilities({
      capabilities: { vision: false, tools: false }, metadataSources: { catalog: "default" },
    });
    expect(html).toContain("Vision metadata: UNKNOWN");
    expect(html).toContain("Tools metadata: UNKNOWN");
  });

  it.each([false, true])("applies saved provider-scoped overrides over declarations: %s", (value) => {
    const html = renderCapabilities({
      discoveredCapabilities: { vision: !value, tools: !value },
      metadataSources: { provider: true },
    }, { capabilities: { vision: value, tools: value } }, { vision: value, tools: value });
    const label = value ? "declared supported" : "declared unsupported";
    expect(html).toContain(`Vision metadata: ${label}`);
    expect(html).toContain(`Tools metadata: ${label}`);
    expect(html).toContain("Inference not tested");
  });
});
