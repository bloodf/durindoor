import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DocsIcon } from "./icons.js";

export function DocsSectionGrid({ children }) {
  return <div className="dd-docs-sections">{children}</div>;
}

export function DocsSectionCard({ href, title, description, icon }) {
  return (
    <Link href={href} className="dd-docs-section-card">
      <DocsIcon name={icon} size={20} className="dd-docs-directory-icon" />
      <span className="dd-docs-directory-copy">
        <span className="dd-docs-section-card-title">{title}</span>
        <span className="dd-docs-section-card-desc">{description}</span>
      </span>
      <ArrowUpRight size={16} aria-hidden="true" />
    </Link>
  );
}
