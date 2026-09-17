import Link from "next/link";
import { DocsSearchTrigger } from "./SearchTrigger.jsx";
import { DOCS_SECTIONS } from "./sections.js";

function pageCountLabel(count) {
  return count === 1 ? "1 page" : `${count} pages`;
}

export function DocsHero({ title, pitch, quickStartHref, apiHref }) {
  return (
    <section className="dd-docs-hero" aria-labelledby="docs-hero-title">
      <div className="dd-docs-hero-main">
        <p className="dd-docs-hero-overline">Documentation</p>
        <div className="dd-docs-hero-brand">
          <img src="/icons/icon-512.png" alt="" width={64} height={64} />
          <h1 id="docs-hero-title" className="dd-docs-hero-title">
            {title}
          </h1>
        </div>
        <p className="dd-docs-hero-pitch">{pitch}</p>
        <div className="dd-docs-hero-tools">
          <DocsSearchTrigger />
          <div className="dd-docs-hero-actions">
            <Link href={quickStartHref} className="dd-docs-btn dd-docs-btn-primary">
              Quick start
            </Link>
            <Link href={apiHref} className="dd-docs-btn dd-docs-btn-ghost">
              API reference
            </Link>
          </div>
        </div>
      </div>
      <nav className="dd-docs-whats-here" aria-label="What's here">
        <h2 className="dd-docs-whats-here-title">What's here</h2>
        <ul className="dd-docs-whats-here-list">
          {DOCS_SECTIONS.map((section) => (
            <li key={section.href}>
              <Link href={section.href} className="dd-docs-whats-here-link">
                <span>{section.title}</span>
                <span className="dd-docs-whats-here-count">{pageCountLabel(section.pages)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
