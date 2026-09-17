"use client";

import { Search } from "lucide-react";
import { useSearchContext } from "fumadocs-ui/contexts/search";

export function DocsSearchTrigger() {
  const { enabled, hotKey, setOpenSearch } = useSearchContext();
  if (!enabled) return null;
  return (
    <button
      type="button"
      className="dd-docs-search-lg"
      onClick={() => setOpenSearch(true)}
      aria-label="Open search"
    >
      <Search size={16} aria-hidden="true" />
      <span>Search the docs</span>
      <span className="dd-docs-search-keys">
        {hotKey.map((key, index) => (
          <kbd key={index}>{key.display}</kbd>
        ))}
      </span>
    </button>
  );
}
