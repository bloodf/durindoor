"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DEPLOYMENTS } from "../content.js";
import { CopyButton } from "../ui/primitives.jsx";

// WAI-ARIA tabs: arrow keys, Home and End move between deployment methods.
export default function DeployTabs() {
  const { t } = useHomeLocale();
  const [active, setActive] = useState(0);
  const tabs = useRef([]);
  const current = DEPLOYMENTS[active];

  const focusTab = (index) => {
    const next = (index + DEPLOYMENTS.length) % DEPLOYMENTS.length;
    setActive(next);
    tabs.current[next]?.focus();
  };

  const onKeyDown = (event) => {
    const moves = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: DEPLOYMENTS.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    focusTab(moves[event.key]);
  };

  return (
    <div className="deploy">
      <div className="deploy-head">
        <p className="connect-title">{t("Other ways through")}</p>
        <div className="deploy-tabs" role="tablist" aria-label={t("Deployment method")} onKeyDown={onKeyDown}>
          {DEPLOYMENTS.map((method, i) => (
            <button
              key={method.id}
              ref={(node) => {
                tabs.current[i] = node;
              }}
              type="button"
              role="tab"
              id={`deploy-tab-${method.id}`}
              aria-selected={i === active}
              aria-controls={i === active ? `deploy-panel-${method.id}` : undefined}
              tabIndex={i === active ? 0 : -1}
              className={`deploy-tab ${i === active ? "is-active" : ""}`}
              onClick={() => setActive(i)}
            >
              {i === active ? <motion.span layoutId="deploy-pill" className="deploy-pill" /> : null}
              <span className="deploy-tab-text">{t(method.label)}</span>
            </button>
          ))}
        </div>
      </div>
      <div
        className="code-block deploy-panel"
        role="tabpanel"
        id={`deploy-panel-${current.id}`}
        aria-labelledby={`deploy-tab-${current.id}`}
      >
        <div className="code-bar">
          <span className="code-label">{t(current.note)}</span>
          <CopyButton text={current.command} />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.pre
            key={current.id}
            tabIndex={0}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            <code>
              {current.command.split("\n").map((line, i) => (
                <span key={i}>
                  {i === 0 || !current.command.split("\n")[i - 1].endsWith("\\") ? <span className="c-dim">$ </span> : "  "}
                  {line.trimStart()}
                  {"\n"}
                </span>
              ))}
            </code>
          </motion.pre>
        </AnimatePresence>
      </div>
    </div>
  );
}
