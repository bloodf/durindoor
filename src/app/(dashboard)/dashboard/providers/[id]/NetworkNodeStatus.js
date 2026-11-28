"use client";

import api from "@/shared/utils/api";

import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Badge, Button } from "@/shared/components";
import { isObject, isString } from "@/shared/utils/typeChecks";
import { deleteConnection } from "./connectionDelete.js";

const HEALTH_VARIANT = { healthy: "success", unreachable: "error", error: "error", unknown: "default" };

/**
 * Map a /api/health/providers state onto the three operator-facing states.
 * down/blocked: the host did not answer. degraded/unconfigured: it answered
 * but rejected the request or has nothing to probe, so the operator needs to
 * look at the node's settings rather than its network.
 */
export function toNodeHealth(state) {
  if (state === "healthy") return "healthy";
  if (state === "down" || state === "blocked") return "unreachable";
  if (state === "degraded" || state === "unconfigured") return "error";
  return "unknown";
}

/**
 * Model id of one entry of a models payload: a bare id string, or an
 * OpenAI/Ollama model object carrying the id under `id`, `name` or `model`.
 * Parsed at the fetch boundary so the rest of the component only sees ids.
 */
export function modelIdOf(entry) {
  if (isString(entry)) return entry;
  if (entry === null || entry === undefined || !isObject(entry)) return "";
  const id = entry.id || entry.name || entry.model;
  return isString(id) ? id : "";
}

/** Model ids from either an array of strings or OpenAI/Ollama model objects. */
export function normalizeModelNames(models) {
  if (!Array.isArray(models)) return [];
  const names = models.map(modelIdOf).filter((name) => name.trim());
  return [...new Set(names)];
}

/** Preserve the node panel’s HTTP-specific fallback while using the shared client. */
function readError(error, fallback) {
  return error.status ? error.body?.error || `${fallback} (HTTP ${error.status})` : error.message;
}

/**
 * Models, health and Test / Remove actions for one network node connection
 * (a LAN OpenAI-compatible endpoint or an Ollama host).
 */
export default function NetworkNodeStatus({ connection, onRemoved = null }) {
  const id = connection.id;
  const label = connection.name || id;
  const [models, setModels] = useState({ status: "loading", items: [], error: "" });
  const [health, setHealth] = useState({ status: "loading", state: "unknown", checkedAt: null, error: "" });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const loadModels = useCallback(async () => {
    setModels((prev) => ({ ...prev, status: "loading", error: "" }));
    try {
      const data = await api.get(`/api/providers/${encodeURIComponent(id)}/models`, { defaultHeaders: false }).catch((error) => { throw new Error(readError(error, "Could not load models")); });
      const items = normalizeModelNames(data?.models);
      if (mounted.current) setModels({ status: items.length ? "ready" : "empty", items, error: "" });
    } catch (error) {
      if (mounted.current) setModels({ status: "error", items: [], error: error?.message || "Could not load models" });
    }
  }, [id]);

  const loadHealth = useCallback(async ({ force = false } = {}) => {
    setHealth((prev) => ({ ...prev, status: "loading", error: "" }));
    try {
      const data = await api.get(`/api/health/providers${force ? "?force=1" : ""}`, { defaultHeaders: false }).catch((error) => { throw new Error(readError(error, "Could not load health")); });
      const entry = Array.isArray(data?.providers) ? data.providers.find((item) => item.id === id) : null;
      if (mounted.current) {
        setHealth({
          status: "ready",
          state: toNodeHealth(entry?.state),
          checkedAt: entry ? data.timestamp || null : null,
          error: entry?.error || "",
        });
      }
      return true;
    } catch (error) {
      if (mounted.current) setHealth({ status: "error", state: "unknown", checkedAt: null, error: error?.message || "Could not load health" });
      return false;
    }
  }, [id]);

  useEffect(() => {
    loadModels();
    loadHealth();
  }, [loadModels, loadHealth]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await api.post(`/api/providers/${encodeURIComponent(id)}/test`, undefined, { defaultHeaders: false }).catch((error) => { throw new Error(readError(error, "Test failed")); }) || {};
      if (!mounted.current) return;
      setTestResult({ ok: data.valid === true, message: data.valid === true ? "Test passed" : data.error || "Test failed" });
      const refreshed = await loadHealth({ force: true });
      if (!refreshed && mounted.current) {
        setHealth({ status: "ready", state: data.valid === true ? "healthy" : "error", checkedAt: new Date().toISOString(), error: data.valid === true ? "" : data.error || "" });
      }
      if (data.valid === true) await loadModels();
    } catch (error) {
      if (mounted.current) setTestResult({ ok: false, message: error?.message || "Test failed" });
    } finally {
      if (mounted.current) setTesting(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setRemoveError("");
    const result = await deleteConnection(id);
    if (!mounted.current) return;
    setRemoving(false);
    if (result.ok) {
      setConfirmingRemove(false);
      if (onRemoved) onRemoved(id);
    } else {
      setRemoveError(result.error);
    }
  };

  const healthLabel = health.status === "loading" ? "checking" : health.state === "unknown" ? "not checked" : health.state;
  const healthVariant = health.status === "loading" ? "default" : HEALTH_VARIANT[health.state];

  return (
    <section
      aria-label={`Network node ${label}`}
      className="mb-2 ml-2 flex min-w-0 flex-col gap-2 rounded-lg border border-dd-border bg-dd-surface-2/[0.02] p-3 sm:ml-12"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={healthVariant} size="sm" dot>{`Health: ${healthLabel}`}</Badge>
        {health.checkedAt ? (
          <span className="text-xs text-dd-muted">
            Last checked <time dateTime={health.checkedAt}>{new Date(health.checkedAt).toLocaleString()}</time>
          </span>
        ) : health.status === "ready" ? (
          <span className="text-xs text-dd-muted">Last checked: never</span>
        ) : null}
        {health.status === "error" ? (
          <span className="text-xs text-dd-danger" role="alert">{health.error}</span>
        ) : health.error && (health.state === "unreachable" || health.state === "error") ? (
          <span className="max-w-full truncate text-xs text-dd-danger" title={health.error}>{health.error}</span>
        ) : null}
      </div>

      <div className="min-w-0" aria-live="polite">
        {models.status === "loading" ? (
          <p className="text-xs text-dd-muted" role="status">Loading models…</p>
        ) : models.status === "error" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-dd-danger" role="alert">{models.error}</span>
            <Button size="sm" variant="ghost" onClick={loadModels}>Retry</Button>
          </div>
        ) : models.status === "empty" ? (
          <p className="text-xs text-dd-muted">No models found on this node.</p>
        ) : (
          <div>
            <p className="text-xs font-medium text-dd-text">{`Models (${models.items.length})`}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Models on ${label}`}>
              {models.items.map((name) => (
                <li key={name} className="rounded bg-dd-text/5 px-1.5 py-0.5 font-mono text-[11px] text-dd-muted dark:bg-dd-surface/5">{name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {testResult ? (
        <p className={`text-xs ${testResult.ok ? "text-dd-success" : "text-dd-danger"}`} role={testResult.ok ? "status" : "alert"}>
          {testResult.message}
        </p>
      ) : null}
      {removeError ? <p className="text-xs text-dd-danger" role="alert">{removeError}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={handleTest} loading={testing} disabled={testing || removing} aria-label={`Test ${label}`}>
          {testing ? "Testing…" : "Test"}
        </Button>
        {confirmingRemove ? (
          <>
            <span className="text-xs text-dd-muted">{`Remove ${label}?`}</span>
            <Button size="sm" variant="danger" onClick={handleRemove} loading={removing} disabled={removing} aria-label={`Confirm remove ${label}`}>
              {removing ? "Removing…" : "Confirm"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setConfirmingRemove(false); setRemoveError(""); }} disabled={removing}>Cancel</Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setConfirmingRemove(true)} disabled={testing} aria-label={`Remove ${label}`}>
            Remove
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * Prop contract for the connection this panel owns: a network node needs a
 * stable id, and may carry a display name. Named for the domain role it
 * guards rather than for the structure it happens to have.
 */
function networkNodeConnection(props, propName, componentName) {
  const value = props[propName];
  if (value === null || value === undefined) {
    return new Error(`The prop \`${propName}\` is marked as required in \`${componentName}\`, but its value is \`${value}\`.`);
  }
  if (!isObject(value) || Array.isArray(value)) {
    return new Error(`Invalid prop \`${propName}\` supplied to \`${componentName}\`: expected a connection object.`);
  }
  if (!isString(value.id) || !value.id.trim()) {
    return new Error(`Invalid prop \`${propName}\` supplied to \`${componentName}\`: expected a connection with a non-empty id.`);
  }
  if (value.name !== undefined && !isString(value.name)) {
    return new Error(`Invalid prop \`${propName}\` supplied to \`${componentName}\`: expected a string connection name.`);
  }
  return null;
}

NetworkNodeStatus.propTypes = {
  connection: networkNodeConnection,
  onRemoved: PropTypes.func,
};
