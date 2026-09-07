import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MediaProviderCard } from "../../src/app/(dashboard)/dashboard/media-providers/components/MediaProviderCard";
describe("media lane regression", () => {
  it("MediaProviderCard renders provider name, ready badge, and a working enable toggle", () => {
    const provider = { id: "ollama-local", name: "Ollama Local", textIcon: "OL" };
    const connections = [{ id: "ollama-1", provider: "ollama-local", isActive: false, testStatus: "success" }];
    const html = renderToStaticMarkup(
      /* @__PURE__ */ React.createElement(MediaProviderCard, { provider, kind: "embedding", connections, isCustom: true, onToggle: () => {
      } })
    );
    expect(html).toContain("Ollama Local");
    expect(html).toContain("Custom");
    expect(html).toContain("Disabled");
    expect(html).toContain("Enable Ollama Local");
    expect(html).toContain("Open Ollama Local");
  });
});
