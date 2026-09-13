"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { RESOLUTIONS } from "../data.js";

const TYPE_MS = 45;
const LINE_MS = 420;
const HOLD_MS = 2600;

// Terminal that types a model string and prints how DurinDoor resolves it.
export default function ModelResolver() {
  const ref = useRef(null);
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
    if (!inView) return undefined;
    let delay;
    let step;
    if (typed < current.input.length) {
      delay = TYPE_MS;
      step = () => setTyped((t) => t + 1);
    } else if (shown < current.lines.length) {
      delay = LINE_MS;
      step = () => setShown((s) => s + 1);
    } else if (auto) {
      delay = HOLD_MS;
      step = () => select((index + 1) % RESOLUTIONS.length, true);
    } else {
      return undefined;
    }
    const timer = setTimeout(step, delay);
    return () => clearTimeout(timer);
  }, [inView, reduce, typed, shown, index, auto, current]);

  function select(next, keepAuto = false) {
    setIndex(next);
    setTyped(0);
    setShown(0);
    if (!keepAuto) setAuto(false);
  }

  return (
    <div className="terminal" ref={ref}>
      <div className="terminal-bar">
        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="terminal-title">model resolution</span>
      </div>
      <div className="terminal-tabs" role="tablist" aria-label="Model string shapes">
        {RESOLUTIONS.map((r, i) => (
          <button
            key={r.kind}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={`terminal-tab ${i === index ? "is-active" : ""}`}
            onClick={() => select(i)}
          >
            {r.kind}
          </button>
        ))}
      </div>
      <div className="terminal-body" role="tabpanel" aria-label={`${current.kind}: ${current.input}`}>
        <p className="terminal-line">
          <span className="t-prompt">&quot;model&quot;:</span>{" "}
          <span className="t-string">&quot;{current.input.slice(0, typed)}</span>
          {typed >= current.input.length ? <span className="t-string">&quot;</span> : null}
          {!done ? <span className="caret" aria-hidden="true" /> : null}
        </p>
        <ul className="terminal-output">
          {current.lines.map((line, i) => (
            <li key={line.text} className={`t-${line.tone} ${i < shown ? "is-shown" : ""}`}>
              {line.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
