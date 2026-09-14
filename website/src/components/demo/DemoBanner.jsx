"use client";

import { useState } from "react";
import Link from "next/link";
import { resetDemoData } from "@site/mock/store.js";
import styles from "./DemoBanner.module.css";

export default function DemoBanner({ hint = null }) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Show demo mode notice" className={styles.reopen}>
        <span aria-hidden="true" className="material-symbols-outlined">science</span>
      </button>
    );
  }

  const reset = () => {
    resetDemoData();
    window.location.reload();
  };

  return (
    <div role="status" className={styles.pill}>
      <span aria-hidden="true" className={`material-symbols-outlined ${styles.icon}`}>science</span>
      <span><strong className={styles.strong}>Demo mode</strong> — all data is mocked and lives in your browser{hint ? `. ${hint}` : ""}</span>
      <button type="button" onClick={reset} className={styles.action}>Reset demo data</button>
      <Link href="/" className={styles.link}>Back to site</Link>
      <button type="button" onClick={() => setOpen(false)} aria-label="Dismiss demo mode notice" className={styles.close}>
        <span aria-hidden="true" className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
      </button>
    </div>
  );
}
