"use client";

import { useEffect, useState } from "react";
import { DEMO_PASSWORD } from "@site/mock/demoPassword.js";
import styles from "./DemoPasswordNotice.module.css";

// The login form is the real dashboard's, so it cannot carry demo copy. The
// password has to be readable right where it is typed: this notice sits above
// the form and, unlike DemoBanner, cannot be dismissed.
export default function DemoPasswordNotice() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(DEMO_PASSWORD);
      setCopied(true);
    } catch {
      // Clipboard is unavailable (insecure origin or denied permission); the
      // password stays visible next to the button, so nothing is lost.
    }
  };

  return (
    <div className={styles.notice} role="note">
      <span aria-hidden="true" className={`material-symbols-outlined ${styles.icon}`}>key</span>
      <span>
        <span className={styles.label}>Demo password</span> — sign in with
      </span>
      <code className={styles.password}>{DEMO_PASSWORD}</code>
      <button type="button" onClick={copy} className={styles.copy}>
        <span aria-hidden="true" className={`material-symbols-outlined ${styles.copyIcon}`}>
          {copied ? "check" : "content_copy"}
        </span>
        {copied ? "Copied" : "Copy"}
      </button>
      <span aria-live="polite" className={styles.srOnly}>{copied ? `${DEMO_PASSWORD} copied to clipboard` : ""}</span>
    </div>
  );
}
