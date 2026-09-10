"use client";

import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";

/**
 * Per-feature toggle table with effective state.
 *
 * The `features` prop is the operator's `databasePgFeatures` map (the
 * one the operator can edit). The `effective` prop is the per-feature
 * state computed by the capability gate on the server (the actual
 * state the runtime honors). The component renders a row per feature
 * with the operator's `enabled` toggle on the left and the effective
 * state on the right.
 *
 * The component is intentionally read-only in this PR: toggling
 * features requires an additional `POST` to `/api/settings/database/engine`
 * with the new map. A follow-up PR can wire the toggle to a local
 * `useState` + debounced save.
 */
export function CapabilityMatrix({ features, effective }) {
  const ids = Object.keys(features || {});
  if (!ids.length) {
    return (
      <Card padding={false}>
        <CardHeader icon="tune" title="Feature matrix" subtitle="No features configured" />
        <CardContent>
          <p className="text-[13px] text-dd-muted">
            The capability matrix is empty. Save the settings page to populate the defaults.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card padding={false}>
      <CardHeader
        icon="tune"
        title="Feature matrix"
        subtitle="Each row is gated by `enabled && clusterMajor >= requires`. The Effective column reflects what the runtime actually honors."
      />
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" aria-label="Per-feature capability matrix">
            <thead>
              <tr className="text-left text-dd-muted">
                <th className="px-2 py-2 font-medium">Feature</th>
                <th className="px-2 py-2 font-medium">Operator</th>
                <th className="px-2 py-2 font-medium">Requires</th>
                <th className="px-2 py-2 font-medium">Effective</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dd-border-subtle">
              {ids.map((id) => {
                const def = features[id] || {};
                const eff = effective[id] || {};
                const enabled = eff.enabled;
                return (
                  <tr key={id}>
                    <td className="px-2 py-2 font-mono text-dd-text">{id}</td>
                    <td className="px-2 py-2">{def.enabled ? "on" : "off"}</td>
                    <td className="px-2 py-2 font-mono text-dd-muted">{def.requires || "-"}</td>
                    <td className="px-2 py-2">
                      <span
                        className={
                          enabled
                            ? "inline-flex items-center gap-1 rounded-full bg-dd-success/10 px-2 py-0.5 text-dd-success"
                            : "inline-flex items-center gap-1 rounded-full bg-dd-muted/10 px-2 py-0.5 text-dd-muted"
                        }
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {enabled ? "check_circle" : "remove"}
                        </span>
                        {enabled ? "active" : "off"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
