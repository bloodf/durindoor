import React from "react";
import { CAPABILITY_LABELS, CAPABILITY_ICONS, compactTokenCount } from "./model.js";
/** Compact visual capability marks expose their exact meaning through labels and titles. */
export default function CapabilityIcons({ caps }) {
  const supported = Object.keys(CAPABILITY_LABELS).filter((key) => caps?.[key] === true);
  const limits = [{ key: "contextWindow", label: "Context", icon: "data_object" }, { key: "maxOutput", label: "Output", icon: "output" }].filter(({ key }) => caps?.[key]);
  if (supported.length === 0 && limits.length === 0) return null;
  return <span className="v5-capability-strip">
    {supported.length > 0 ? <span className="v5-capability-icons">{supported.map((key) => <span key={key} className="v5-capability-mark" role="img" aria-label={CAPABILITY_LABELS[key]} title={CAPABILITY_LABELS[key]}><span aria-hidden="true" className="material-symbols-outlined">{CAPABILITY_ICONS[key]}</span></span>)}</span> : null}
    {limits.map(({ key, label, icon }) => <span key={key} className="v5-capability-limit" title={`${label}: ${caps[key].toLocaleString()} tokens`} aria-label={`${label}: ${caps[key].toLocaleString()} tokens`}><span aria-hidden="true" className="material-symbols-outlined">{icon}</span><span>{label}<b>{compactTokenCount(caps[key])}</b></span></span>)}
  </span>;
}
