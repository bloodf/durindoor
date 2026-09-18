import Link from "next/link";
import { DocsIcon } from "./icons.js";

export function DocsStartRow({ children }) {
  return <div className="dd-docs-start">{children}</div>;
}

export function DocsStartCard({ href, title, description, icon }) {
  return (
    <Link href={href} className="dd-docs-start-card">
      <span className="dd-docs-card-icon">
        <DocsIcon name={icon} size={22} />
      </span>
      <span className="dd-docs-start-card-title">{title}</span>
      <span className="dd-docs-start-card-desc">{description}</span>
    </Link>
  );
}
