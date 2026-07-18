import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: function Link({ children, href }) {
    return React.createElement("a", { href }, children);
  },
}));

vi.mock("@/shared/components", () => ({
  Card: function Card({ children }) {
    return React.createElement("div", { className: "card" }, children);
  },
  Badge: function Badge({ children }) {
    return React.createElement("span", { className: "badge" }, children);
  },
}));

vi.mock("@/shared/components/ProviderIcon", () => ({
  default: function ProviderIcon({ alt }) {
    return React.createElement("img", { alt });
  },
}));

import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import { MediaProviderCard } from "../../src/app/(dashboard)/dashboard/media-providers/components/MediaProviderCard.jsx";

describe("MediaProviderCard renders local Ollama embedding provider", () => {
  it("shows ollama-local card on embedding kind", () => {
    const provider = AI_PROVIDERS["ollama-local"];
    expect(provider).toBeDefined();
    const html = renderToStaticMarkup(
      React.createElement(MediaProviderCard, {
        provider,
        kind: "embedding",
        connections: [],
        onToggle: () => {},
      })
    );
    expect(html).toContain("Ollama Local");
    expect(html).toContain('/dashboard/media-providers/embedding/ollama-local');
  });
});
