import Link from "next/link";

export function DocsPopularList({ children }) {
  return <ul className="dd-docs-popular">{children}</ul>;
}

export function DocsPopularLink({ href, title }) {
  return (
    <li>
      <Link href={href} className="dd-docs-popular-link">
        {title}
      </Link>
    </li>
  );
}
