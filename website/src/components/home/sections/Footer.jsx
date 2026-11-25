"use client";
import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";
import Link from "next/link";
import { BrandMark } from "../ui/chrome.jsx";
import { FOOTER_GROUPS } from "../data.js";
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
            {FOOTER_GROUPS.map((group) => (
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
