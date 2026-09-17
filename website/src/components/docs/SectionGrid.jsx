import Link from "next/link";
import { DocsIcon } from "./icons.js";

export function DocsSectionGrid({ children }) {
  return <div className="dd-docs-sections">{children}</div>;
}

export function DocsSectionCard({ href, title, description, icon, pages }) {
  const count = Number(pages);
  const label = count === 1 ? "1 page" : `${count} pages`;
  return (
    <Link href={href} className="dd-docs-section-card">
      <span className="dd-docs-card-icon">
        <DocsIcon name={icon} size={18} />
      </span>
      <span className="dd-docs-section-card-title">{title}</span>
      <span className="dd-docs-section-card-desc">{description}</span>
      <span className="dd-docs-section-card-count">{label}</span>
    </Link>
  );
}
