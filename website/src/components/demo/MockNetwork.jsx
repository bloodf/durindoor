"use client";

import { loader } from "@monaco-editor/react";
import { installMockNetwork } from "@site/mock/install.js";

// Runs at module evaluation, before any dashboard component mounts, so the
// very first fetch or EventSource is already served by the mock layer.
if (typeof window !== "undefined") {
  installMockNetwork();
  loader.config({ paths: { vs: "/monaco/vs" } });
  // The dashboard hides icon glyphs until the icon font is ready; the real
  // root layout sets this class with an inline script.
  const markFontsLoaded = () => document.documentElement.classList.add("fonts-loaded");
  if (document.fonts?.ready) document.fonts.ready.then(markFontsLoaded, markFontsLoaded);
  else markFontsLoaded();
}

export default function MockNetwork() {
  return null;
}
