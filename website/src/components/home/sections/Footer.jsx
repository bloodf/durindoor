"use client";
import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";
import Link from "next/link";
import { BrandMark } from "../ui/chrome.jsx";
import { GITHUB_URL, NPM_URL } from "../data.js";
const groups = [
  {
    label: "DurinDoor",
    links: [
      ["Live demo", "/demo-preview"],
      ["Quick start", "#quick-start"],
      ["Providers", "#providers"],
      ["Features", "#features"],
    ],
  },
  {
    label: "Docs",
    links: [
      ["Docs", "/docs"],
      ["Quick start", "/docs/getting-started"],
      ["API key", "/docs/reference/api"],
      ["Connect your tools", "/docs/integrations/other-tools"],
    ],
  },
  {
    label: "GitHub",
    links: [
      ["GitHub", GITHUB_URL],
      ["npm", NPM_URL],
      ["MIT License", `${GITHUB_URL}/blob/main/LICENSE`],
    ],
  },
];
export default function Footer() {
  const { t } = useHomeLocale();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-columns">
          <div className="footer-brand">
            <Link
              href="/"
              className="nav-brand"
              aria-label={t("DurinDoor home")}
            >
              <BrandMark />
              <span>DurinDoor</span>
            </Link>
            <p>{t("Speak, friend, and enter.")}</p>
          </div>
          <nav className="footer-nav" aria-label={t("Footer")}>
            {groups.map((group) => (
              <div key={group.label}>
                <h3>
                  {group.label === "DurinDoor" ? group.label : t(group.label)}
                </h3>
                <ul>
                  {group.links.map(([label, href]) => (
                    <li key={label}>
                      {href.startsWith("http") ? (
                        <a href={href} target="_blank" rel="noreferrer">
                          {t(label)}
                        </a>
                      ) : (
                        <Link href={href}>{t(label)}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <p className="footer-fine">
          © {new Date().getFullYear()} {t("DurinDoor contributors.")}
        </p>
      </div>
    </footer>
  );
}
