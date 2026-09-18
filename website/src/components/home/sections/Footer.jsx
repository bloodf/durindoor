"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import Link from "next/link";
import Icon, { GitHubMark } from "../ui/Icon.jsx";
import { BrandMark } from "../ui/chrome.jsx";
import { GITHUB_URL, NPM_URL } from "../data.js";
import { RuneDivider } from "../ui/primitives.jsx";

const LINKS = [
  { href: GITHUB_URL, label: "GitHub", icon: <GitHubMark size={16} />, external: true },
  { href: NPM_URL, label: "npm", icon: <Icon name="box" size={16} />, external: true },
  { href: "/docs", label: "Docs", icon: <Icon name="book" size={16} /> },
  { href: `${GITHUB_URL}/blob/main/LICENSE`, label: "MIT License", icon: <Icon name="scale" size={16} />, external: true },
];

export default function Footer() {
  const { t } = useHomeLocale();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-bottom">
          <div className="footer-brand">
            <Link href="/" className="nav-brand" aria-label={t("DurinDoor home")}>
              <BrandMark />
              <span>DurinDoor</span>
            </Link>
            <p>{t("Speak, friend, and enter. A fork of 9router.")}</p>
          </div>
          <nav aria-label={t("Footer")}>
            <ul className="footer-links">
              {LINKS.map((link) => (
                <li key={link.label}>
                  {link.external ? (
                    <a href={link.href} target="_blank" rel="noreferrer">
                      {link.icon}
                      {t(link.label)}
                    </a>
                  ) : (
                    <Link href={link.href}>
                      {link.icon}
                      {t(link.label)}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <RuneDivider className="is-small" />
        <p className="footer-fine">© {new Date().getFullYear()}{" "}{t("DurinDoor contributors.")}</p>
      </div>
    </footer>
  );
}
