"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";

const NONE_PROXY_POOL_VALUE = "__none__";
const STRATEGIES = [
  { value: "none", label: "None (single pool)" },
  { value: "round-robin", label: "Round-robin" },
  { value: "random", label: "Random" },
];

export default function NoAuthProxyCard({ providerId }) {
  const [proxyPools, setProxyPools] = useState([]);
  const [proxyPoolId, setProxyPoolId] = useState(NONE_PROXY_POOL_VALUE);
  const [rotateStrategy, setRotateStrategy] = useState("none");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }).then((r) => r.ok ? r.json() : { proxyPools: [] }),
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.ok ? r.json() : {}),
    ]).then(([poolData, settingsData]) => {
      if (cancelled) return;
      setProxyPools(poolData.proxyPools || []);
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProxyPoolId(override.proxyPoolId || NONE_PROXY_POOL_VALUE);
      setRotateStrategy(override.rotateStrategy || "none");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [providerId]);

  const save = useCallback(async (poolId, strategy) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      const current = data.providerStrategies || {};
      const override = { ...(current[providerId] || {}) };
      if (poolId === NONE_PROXY_POOL_VALUE) delete override.proxyPoolId;
      else override.proxyPoolId = poolId;
      if (strategy === "none") delete override.rotateStrategy;
      else override.rotateStrategy = strategy;
      const updated = { ...current };
      if (Object.keys(override).length === 0) delete updated[providerId];
      else updated[providerId] = override;
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      console.log("Save proxy config error:", e);
    } finally {
      setSaving(false);
    }
  }, [providerId]);

  const handlePoolChange = (newPoolId) => {
    setProxyPoolId(newPoolId);
    save(newPoolId, rotateStrategy);
  };

  const handleStrategyChange = (newStrategy) => {
    setRotateStrategy(newStrategy);
    save(proxyPoolId, newStrategy);
  };

  const canRotate = proxyPools.length >= 2;
  const isRotation = rotateStrategy !== "none";

  return (
    <Card padding={false}>
      <CardHeader
        icon="lock_open"
        title="No authentication required"
        subtitle="This provider is ready to use. Optionally route requests through a proxy pool to bypass IP-based limits."
        actions={savedFlash ? <Badge tone="success" size="sm">Saved</Badge> : null}
      />
      <CardContent className="space-y-4">
        <Field
          label="Proxy Pool"
          hint={isRotation ? "Pool selector is ignored when rotation is active — all active pools are used." : undefined}
        >
          <Select
            aria-label="Proxy Pool"
            value={proxyPoolId}
            onChange={handlePoolChange}
            disabled={saving || isRotation}
            options={[
              { value: NONE_PROXY_POOL_VALUE, label: "None (direct)" },
              ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name })),
            ]}
          />
        </Field>

        <Field
          label="Rotation Strategy"
          hint={
            !canRotate
              ? "Need at least 2 active proxy pools for rotation."
              : isRotation
                ? rotateStrategy === "round-robin"
                  ? `Rotating through all ${proxyPools.length} active pools in order. State is in-memory (resets on restart).`
                  : `Picking a random pool from ${proxyPools.length} active pools each request.`
                : "Uses selected pool above. Set to Round-robin or Random to rotate across all active pools."
          }
        >
          <Select
            aria-label="Rotation Strategy"
            value={rotateStrategy}
            onChange={handleStrategyChange}
            disabled={saving}
            options={STRATEGIES.map((strategy) => ({
              ...strategy,
              disabled: strategy.value !== "none" && !canRotate,
            }))}
          />
        </Field>
      </CardContent>
    </Card>
  );
}

NoAuthProxyCard.propTypes = {
  providerId: PropTypes.string.isRequired,
};
