"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";
import { useEffect, useId, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { RESOLUTIONS } from "../data.js";
import Icon from "../ui/Icon.jsx";

const TYPE_MS = 45;
const LINE_MS = 420;
const HOLD_MS = 2600;

/** Illustrative resolver. Visitors can stop its loop or inspect each example by keyboard. */
export default function ModelResolver() {
  const { t } = useHomeLocale();
  const ref = useRef(null);
  const tabs = useRef([]);
  const id = useId();
  const inView = useInView(ref, { margin: "-20% 0px" });
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [shown, setShown] = useState(0);
  const [auto, setAuto] = useState(true);
  const current = RESOLUTIONS[index];
  const done = typed >= current.input.length && shown >= current.lines.length;

  useEffect(() => {
    if (reduce) {
      setTyped(current.input.length);
      setShown(current.lines.length);
      return undefined;
    }
    if (!inView || !auto) return undefined;
    let step;
    let delay;
    if (typed < current.input.length) {
      delay = TYPE_MS;
      step = () => setTyped((value) => value + 1);
    } else if (shown < current.lines.length) {
      delay = LINE_MS;
      step = () => setShown((value) => value + 1);
    } else {
      delay = HOLD_MS;
      step = () => { setIndex((index + 1) % RESOLUTIONS.length); setTyped(0); setShown(0); };
    }
    const timer = setTimeout(step, delay);
    return () => clearTimeout(timer);
  }, [inView, reduce, typed, shown, index, auto, current]);

  function select(next) {
    setIndex(next);
    setTyped(RESOLUTIONS[next].input.length);
    setShown(RESOLUTIONS[next].lines.length);
    setAuto(false);
  }

  function onKeyDown(event) {
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: RESOLUTIONS.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (moves[event.key] + RESOLUTIONS.length) % RESOLUTIONS.length;
    select(next);
    tabs.current[next]?.focus();
  }

  return (
    <div className="terminal" ref={ref}>
      <div className="terminal-bar">
        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="terminal-title">{t("model resolution")}</span>
        {!reduce && <button type="button" className="terminal-playback" onClick={() => setAuto(!auto)}
          aria-label={t(auto ? "Pause examples" : "Play examples")} aria-pressed={!auto}>
          <Icon name={auto ? "pause" : "play"} size={14} />
          <span>{t(auto ? "Pause examples" : "Play examples")}</span>
        </button>}
      </div>
      <div className="terminal-tabs" role="tablist" aria-label={t("Model string shapes")} onKeyDown={onKeyDown}>
        {RESOLUTIONS.map((example, position) => (
          <button key={example.kind} ref={(node) => { tabs.current[position] = node; }} type="button" role="tab"
            id={`${id}-tab-${position}`} aria-controls={position === index ? `${id}-panel` : undefined}
            tabIndex={position === index ? 0 : -1} aria-selected={position === index}
            className={`terminal-tab ${position === index ? "is-active" : ""}`} onClick={() => select(position)}>
            {t(example.kind)}
          </button>
        ))}
      </div>
      <div className="terminal-body" role="tabpanel" id={`${id}-panel`} tabIndex={0} aria-labelledby={`${id}-tab-${index}`}>
        <p className="terminal-line"><span className="t-prompt">&quot;model&quot;:</span>{" "}
          <span className="t-string">&quot;{current.input.slice(0, typed)}</span>
          {typed >= current.input.length && <span className="t-string">&quot;</span>}
          {!done && auto && <span className="caret" aria-hidden="true" />}
        </p>
        <ul className="terminal-output">
          {current.lines.map((line, position) => (
            <li key={line.text} className={`t-${line.tone} ${position < shown ? "is-shown" : ""}`}>{t(line.text)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
