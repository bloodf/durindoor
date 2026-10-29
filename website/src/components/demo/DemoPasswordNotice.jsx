"use client";

import { useEffect, useRef, useState } from "react";
import { DEMO_PASSWORD } from "@site/mock/demoPassword.js";
import styles from "./DemoPasswordNotice.module.css";

// The login form is the real dashboard's, so it cannot carry demo copy. The
// password has to be readable right where it is typed: this notice sits above
// the form and, unlike DemoBanner, cannot be dismissed.
export default function DemoPasswordNotice() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const request = ++generation.current;
    setFailed(false);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(DEMO_PASSWORD);
      if (mounted.current && request === generation.current) setCopied(true);
    } catch {
      if (mounted.current && request === generation.current) setFailed(true);
    }
  };

  return (
    <div className={styles.notice} role="note" lang="en">
      <span aria-hidden="true" className={`material-symbols-outlined ${styles.icon}`}>key</span>
      <span>
        <span className={styles.label}>Demo password</span>. Sign in with
      </span>
      <code className={styles.password}>{DEMO_PASSWORD}</code>
      <button type="button" onClick={copy} className={styles.copy}>
        <span aria-hidden="true" className={`material-symbols-outlined ${styles.copyIcon}`}>
          {copied ? "check" : "content_copy"}
        </span>
        {copied ? "Copied" : "Copy"}
      </button>
      <span aria-live="polite" className={failed ? styles.error : styles.srOnly}>{failed ? "Copy failed. Select the visible password and copy it manually." : copied ? `${DEMO_PASSWORD} copied to clipboard` : ""}</span>
    </div>
  );
}
