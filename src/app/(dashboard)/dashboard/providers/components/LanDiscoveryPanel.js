"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Badge } from "@/shared/components";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";

const MAX_LISTED_MODELS = 6;

/** Split the operator's input into the request body: a CIDR when it holds "/", otherwise hosts. */
export function buildDiscoveryRequest(target, portsText) {
  const text = String(target || "").trim();
  if (!text) return { error: "Enter one or more hosts, or a CIDR range such as 192.168.1.0/24." };
  const body = text.includes("/")
    ? { cidr: text }
    : { hosts: text.split(/[\s,]+/).filter(Boolean) };
  const portTokens = String(portsText || "").split(/[\s,]+/).filter(Boolean);
  if (portTokens.length) {
    const ports = portTokens.map(Number);
    if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
      return { error: "Ports must be whole numbers between 1 and 65535." };
    }
    body.ports = ports;
  }
  return { body };
}

function candidateName(candidate) {
  return `${candidate.kind === "ollama" ? "Ollama" : "LAN"} ${candidate.host}:${candidate.port}`;
}

function candidatePrefix(candidate) {
  const slug = `${candidate.host}-${candidate.port}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `lan-${slug}`;
}

/** Create the node (OpenAI-compatible) or connection (Ollama) a discovered candidate stands for. */
async function addCandidate(candidate) {
  const request = candidate.kind === "ollama"
    ? ["/api/providers", {
      provider: "ollama-local",
      name: candidateName(candidate),
      apiKey: "",
      testStatus: "unknown",
      providerSpecificData: { baseUrl: candidate.baseUrl },
    }]
    : ["/api/provider-nodes", {
      name: candidateName(candidate),
      prefix: candidatePrefix(candidate),
      apiType: "chat",
      baseUrl: candidate.baseUrl,
      type: "openai-compatible",
    }];
  const res = await fetch(request[0], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request[1]),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Could not add ${candidate.baseUrl} (HTTP ${res.status})`);
}

/**
 * Opt-in LAN discovery: scans operator-named hosts or one CIDR range and lets
 * the operator add a found Ollama host or OpenAI-compatible node. Nothing runs
 * until the operator presses Discover.
 */
export default function LanDiscoveryPanel({ onAdded = null }) {
  const [target, setTarget] = useState("");
  const [portsText, setPortsText] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | scanning | done | disabled | error
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [adds, setAdds] = useState({}); // baseUrl -> { status: "adding"|"added"|"error", error }

  const handleDiscover = async () => {
    const request = buildDiscoveryRequest(target, portsText);
    if (request.error) {
      setPhase("error");
      setMessage(request.error);
      return;
    }
    setPhase("scanning");
    setMessage("");
    setCandidates([]);
    setAdds({});
    try {
      const res = await fetch("/api/providers/lan-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data?.error === "lan_discovery_disabled") {
        setPhase("disabled");
        return;
      }
      if (!res.ok) throw new Error(data?.error || `Discovery failed (HTTP ${res.status})`);
      setCandidates(Array.isArray(data?.candidates) ? data.candidates : []);
      setPhase("done");
    } catch (error) {
      setPhase("error");
      setMessage(error?.message || "Discovery failed");
    }
  };

  const handleAdd = async (candidate) => {
    setAdds((prev) => ({ ...prev, [candidate.baseUrl]: { status: "adding", error: "" } }));
    try {
      await addCandidate(candidate);
      setAdds((prev) => ({ ...prev, [candidate.baseUrl]: { status: "added", error: "" } }));
      if (onAdded) onAdded(candidate);
    } catch (error) {
      setAdds((prev) => ({ ...prev, [candidate.baseUrl]: { status: "error", error: error?.message || "Could not add" } }));
    }
  };

  return (
    <section aria-label="LAN discovery" className="flex flex-col gap-3 rounded-dd-lg border border-dd-border p-4">
      <div>
        <h2 className="text-lg font-semibold leading-tight sm:text-xl">Discover on LAN</h2>
        <p className="mt-1 text-sm text-dd-muted">
          Scan hosts you name, or one CIDR range, for Ollama and OpenAI-compatible endpoints. Nothing is scanned until you press Discover.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <Input
          label="Hosts or CIDR"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="192.168.1.20, nas.local  or  192.168.1.0/24"
          hint="Comma-separated hosts, or a single CIDR range."
        />
        <Input
          label="Ports (optional)"
          value={portsText}
          onChange={(e) => setPortsText(e.target.value)}
          placeholder="11434, 1234"
          hint="Leave blank for the default ports."
        />
        <Button onClick={handleDiscover} loading={phase === "scanning"} disabled={phase === "scanning"} className="w-full sm:w-auto">
          {phase === "scanning" ? "Scanning…" : "Discover"}
        </Button>
      </div>

      <div aria-live="polite">
        {phase === "scanning" ? (
          <p className="text-sm text-dd-muted" role="status">Scanning for network LLM nodes…</p>
        ) : null}

        {phase === "disabled" ? (
          <div className="rounded-dd border border-dd-warning/30 bg-dd-warning/10 p-3 text-sm" role="status" data-testid="lan-discovery-disabled">
            <p className="font-medium text-dd-text">LAN discovery is turned off.</p>
            <p className="mt-1 text-dd-muted">
              To turn it on, an operator signed in to the dashboard sets <code>lanDiscoveryEnabled</code> to <code>true</code> in settings
              (<code>PATCH /api/settings</code> with <code>{'{"lanDiscoveryEnabled": true, "currentPassword": "<dashboard password>"}'}</code>,
              plus <code>mfaCode</code> when MFA is on), then presses Discover again.
            </p>
          </div>
        ) : null}

        {phase === "error" ? (
          <p className="text-sm text-dd-danger" role="alert">{message}</p>
        ) : null}

        {phase === "done" && candidates.length === 0 ? (
          <p className="text-sm text-dd-muted" data-testid="lan-discovery-empty">
            No Ollama or OpenAI-compatible endpoints answered on those hosts and ports.
          </p>
        ) : null}

        {phase === "done" && candidates.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Discovered candidates">
            {candidates.map((candidate) => {
              const add = adds[candidate.baseUrl];
              const models = Array.isArray(candidate.models) ? candidate.models : [];
              return (
                <li key={`${candidate.kind}:${candidate.baseUrl}`} className="flex flex-col gap-2 rounded-dd border border-dd-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="break-all text-sm">{candidate.baseUrl}</code>
                      <Badge variant={candidate.kind === "ollama" ? "primary" : "info"} size="sm">
                        {candidate.kind === "ollama" ? "Ollama" : "OpenAI-compatible"}
                      </Badge>
                    </div>
                    <p className="mt-1 break-words text-xs text-dd-muted">
                      {models.length === 0
                        ? "No models listed"
                        : `${models.length} model${models.length === 1 ? "" : "s"}: ${models.slice(0, MAX_LISTED_MODELS).join(", ")}${models.length > MAX_LISTED_MODELS ? ", …" : ""}`}
                    </p>
                    {add?.status === "error" ? <p className="mt-1 text-xs text-dd-danger" role="alert">{add.error}</p> : null}
                  </div>
                  {add?.status === "added" ? (
                    <Badge variant="success" size="sm">Added</Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleAdd(candidate)}
                      loading={add?.status === "adding"}
                      disabled={add?.status === "adding"}
                      aria-label={`Add ${candidate.baseUrl}`}
                      className="w-full sm:w-auto"
                    >
                      {add?.status === "adding" ? "Adding…" : candidate.kind === "ollama" ? "Add connection" : "Add node"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

LanDiscoveryPanel.propTypes = {
  onAdded: PropTypes.func,
};
