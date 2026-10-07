import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function DocsStartRow({ children }) {
  return <div className="dd-docs-start">{children}</div>;
}

export function DocsStartCard({ href, title, description, step }) {
  return (
    <Link href={href} className="dd-docs-start-card">
      <span className="dd-docs-start-step">Step {step}</span>
      <span className="dd-docs-start-card-title">
        {title}
        <ArrowRight size={18} aria-hidden="true" />
      </span>
      <span className="dd-docs-start-card-desc">{description}</span>
    </Link>
  );
}
