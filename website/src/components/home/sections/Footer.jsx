import Link from "next/link";
import Icon, { GitHubMark } from "../ui/Icon.jsx";
import { BrandMark } from "../ui/chrome.jsx";
import { DOCS_URL, GITHUB_URL, NPM_URL } from "../data.js";
import { RuneDivider } from "../ui/primitives.jsx";

const LINKS = [
  { href: GITHUB_URL, label: "GitHub", icon: <GitHubMark size={16} /> },
  { href: NPM_URL, label: "npm", icon: <Icon name="box" size={16} /> },
  { href: DOCS_URL, label: "Docs", icon: <Icon name="book" size={16} /> },
  { href: `${GITHUB_URL}/blob/main/LICENSE`, label: "MIT License", icon: <Icon name="scale" size={16} /> },
];

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-bottom">
          <div className="footer-brand">
            <Link href="/" className="nav-brand" aria-label="DurinDoor home">
              <BrandMark />
              <span>DurinDoor</span>
            </Link>
            <p>Speak, friend, and enter. A fork of 9router, self-hosted and MIT licensed.</p>
          </div>
          <nav aria-label="Footer">
            <ul className="footer-links">
              {LINKS.map((link) => (
                <li key={link.label}>
                  <a href={link.href} target="_blank" rel="noreferrer">
                    {link.icon}
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <RuneDivider className="is-small" />
        <p className="footer-fine">© {new Date().getFullYear()} DurinDoor contributors.</p>
      </div>
    </footer>
  );
}
