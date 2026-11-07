import React from "react";
import { aggregateComboCapabilities, overlayComboCapabilities } from "open-sse/providers/capabilities.js";
import CapabilityIcons from "./CapabilityIcons.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import { splitModelIdentity } from "./model.js";
/** Readable member rows replace capacity-icon badges. Every member stays inspectable. */
export default function ModelSummary({ models = [], getCaps, comboByName = {} }) {
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? models : models.slice(0, 3);
  return <div className="v5-combo-members">
    {models.length === 0 ? <p className="text-xs text-dd-muted">No models</p> : <ol aria-label="Model members">{visible.map((value, index) => {
      const nested = comboByName[value];
      const caps = nested ? overlayComboCapabilities(aggregateComboCapabilities(nested.models, comboByName), nested.capabilities) : getCaps?.(value);
      const identity = splitModelIdentity(value, !!nested);

      return <li key={`${value}-${index}`}>
        <span className="v5-combo-member-order" aria-label={`Priority ${index + 1}`}>{index + 1}</span>
        <ProviderLogo provider={nested ? "combo" : identity.provider === "google" ? "gemini" : identity.provider} size={20} />
        <div className="v5-combo-member-name"><code title={value}>{value}</code><CapabilityIcons caps={caps} /></div>
      </li>;
    })}</ol>}
    {models.length > 3 ? <button type="button" className="v5-combo-more" onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer models" : `Show all ${models.length} models`}</button> : null}
  </div>;
}
