"use client";

import { DocsThemeToggle } from "./ThemeToggle.jsx";

export function DocsSidebarFooter({ version }) {
  return (
    <div className="dd-docs-sidebar-footer">
      <a
        href="https://github.com/bloodf/durindoor"
        target="_blank"
        rel="noreferrer noopener"
        className="dd-docs-sidebar-github"
      >
        GitHub
      </a>
      {version ? <span className="dd-docs-sidebar-version">v{version}</span> : null}
      <DocsThemeToggle />
    </div>
  );
}
