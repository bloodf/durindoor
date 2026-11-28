"use client";

import { requestSettings } from "@/store/settingsStore";

import { useState } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import api from "@/shared/utils/api";
import { statusClass } from "./profileHelpers.js";

/**
 * Network tab: outbound proxy, proxy test URL, and Firecrawl endpoint. Mounts
 * only after saved settings load, so the drafts start from that snapshot.
 */
export default function NetworkSettingsSection({ activeTab, settings, setSettings, loading, confirmPassword }) {
  const [proxyForm, setProxyForm] = useState(() => ({
    outboundProxyEnabled: settings?.outboundProxyEnabled === true,
    outboundProxyUrl: settings?.outboundProxyUrl || "",
    outboundNoProxy: settings?.outboundNoProxy || "",
    proxyTestUrl: settings?.proxyTestUrl || ""
  }));
  const [firecrawlUrl, setFirecrawlUrl] = useState(() => settings?.firecrawlBaseUrl || "");
  const [firecrawlUrlStatus, setFirecrawlUrlStatus] = useState({ type: "", message: "" });
  const [firecrawlUrlLoading, setFirecrawlUrlLoading] = useState(false);
  const [proxyStatus, setProxyStatus] = useState({ type: "", message: "" });
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyTestLoading, setProxyTestLoading] = useState(false);

  const updateFirecrawlUrl = async (e) => {
    e.preventDefault();
    const value = firecrawlUrl.trim();
    if (value) {
      try {
        new URL(value);
      } catch {
        setFirecrawlUrlStatus({ type: "error", message: "Invalid URL" });
        return;
      }
    }
    setFirecrawlUrlLoading(true);
    setFirecrawlUrlStatus({ type: "", message: "" });
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firecrawlBaseUrl: value || "" })
      });
      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, firecrawlBaseUrl: data?.firecrawlBaseUrl || "" }));
        setFirecrawlUrl(data?.firecrawlBaseUrl || "");
        setFirecrawlUrlStatus({ type: "success", message: "Firecrawl URL saved" });
      } else {
        setFirecrawlUrlStatus({ type: "error", message: data.error || "Failed to save Firecrawl URL" });
      }
    } catch (err) {
      setFirecrawlUrlStatus({ type: "error", message: "An error occurred" });
    } finally {
      setFirecrawlUrlLoading(false);
    }
  };

  const updateOutboundProxy = async (e) => {
    e.preventDefault();
    if (settings.outboundProxyEnabled !== true) return;
    setProxyLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outboundProxyUrl: proxyForm.outboundProxyUrl,
          outboundNoProxy: proxyForm.outboundNoProxy,
          proxyTestUrl: proxyForm.proxyTestUrl
        }),
        confirmPassword
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyStatus({ type: "success", message: "Proxy settings applied" });
      } else {
        setProxyStatus({ type: "error", message: data.error || "Failed to update proxy settings" });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setProxyLoading(false);
    }
  };

  const saveProxyTestUrl = async (event) => {
    event.preventDefault();
    setProxyLoading(true);
    setProxyStatus({ type: "", message: "" });
    try {
      const response = await requestSettings( {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyTestUrl: proxyForm.proxyTestUrl.trim() })
      });
      const data = await response.json();
      setProxyStatus(response.ok
        ? { type: "success", message: "Test URL saved" }
        : { type: "error", message: data.error || "Failed to save test URL" });
    } catch {
      setProxyStatus({ type: "error", message: "Failed to save test URL" });
    } finally {
      setProxyLoading(false);
    }
  };

  const testOutboundProxy = async () => {
    if (settings.outboundProxyEnabled !== true) return;

    const proxyUrl = (proxyForm.outboundProxyUrl || "").trim();
    if (!proxyUrl) {
      setProxyStatus({ type: "error", message: "Please enter a Proxy URL to test" });
      return;
    }

    setProxyTestLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const data = await api.post("/api/settings/proxy-test", { proxyUrl, testUrl: proxyForm.proxyTestUrl });
      if (data?.ok) {
        setProxyStatus({
          type: "success",
          message: `Proxy test OK (${data.status}) in ${data.elapsedMs}ms`
        });
      } else {
        setProxyStatus({
          type: "error",
          message: data?.error || "Proxy test failed"
        });
      }
    } catch (err) {
      setProxyStatus({
        type: "error",
        message: err?.status !== undefined ? (err.body?.error || "Proxy test failed") : "An error occurred"
      });
    } finally {
      setProxyTestLoading(false);
    }
  };

  const updateOutboundProxyEnabled = async (outboundProxyEnabled) => {
    setProxyLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outboundProxyEnabled }),
        confirmPassword
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyForm((prev) => ({ ...prev, outboundProxyEnabled: data?.outboundProxyEnabled === true }));
        setProxyStatus({
          type: "success",
          message: outboundProxyEnabled ? "Proxy enabled" : "Proxy disabled"
        });
      } else {
        setProxyStatus({ type: "error", message: data.error || "Failed to update proxy settings" });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setProxyLoading(false);
    }
  };

  return (
      <section role="tabpanel" aria-label="Network settings" hidden={activeTab !== "network"} className="flex flex-col gap-5">

      <Card padding={false}><CardHeader icon="lan" title="Network" subtitle="Outbound services and proxy behavior" /><CardContent className="flex flex-col gap-5"><Toggle label="Outbound Proxy" description="Enable proxy for OAuth and provider outbound requests." checked={settings.outboundProxyEnabled === true} onChange={() => updateOutboundProxyEnabled(!(settings.outboundProxyEnabled === true))} disabled={loading || proxyLoading} />{settings.outboundProxyEnabled === true ? <form onSubmit={updateOutboundProxy} className="flex flex-col gap-4 border-t border-dd-border-subtle pt-5"><Input label="Proxy URL" hint="Leave empty to inherit existing environment proxy." placeholder="http://127.0.0.1:7897" value={proxyForm.outboundProxyUrl} onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundProxyUrl: e.target.value }))} disabled={loading || proxyLoading} /><Input label="No Proxy" hint="Comma-separated hostnames or domains to bypass proxy." placeholder="localhost,127.0.0.1" value={proxyForm.outboundNoProxy} onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundNoProxy: e.target.value }))} disabled={loading || proxyLoading} /><div className="flex flex-wrap gap-2"><Button variant="secondary" loading={proxyTestLoading} disabled={loading || proxyLoading} onClick={testOutboundProxy}>Test proxy URL</Button><Button type="submit" variant="primary" loading={proxyLoading}>Apply</Button></div></form> : null}<form onSubmit={saveProxyTestUrl} className="flex flex-col gap-3 border-t border-dd-border-subtle pt-5"><Input label="Test URL" hint="HTTPS destination for proxy tests. Leave empty for the default." placeholder="https://google.com/" value={proxyForm.proxyTestUrl} onChange={(e) => setProxyForm((prev) => ({ ...prev, proxyTestUrl: e.target.value }))} disabled={loading || proxyLoading} /><div><Button type="submit" variant="primary" loading={proxyLoading}>Save test URL</Button></div></form>{proxyStatus.message ? <p role="status" className={`text-xs ${statusClass(proxyStatus)}`}>{proxyStatus.message}</p> : null}<form onSubmit={updateFirecrawlUrl} className="flex flex-col gap-3 border-t border-dd-border-subtle pt-5"><Input label="Firecrawl URL" hint="Custom Firecrawl or self-hosted endpoint. Falls back to FIRECRAWL_BASE_URL." placeholder="https://api.firecrawl.dev" value={firecrawlUrl} onChange={(e) => setFirecrawlUrl(e.target.value)} disabled={loading || firecrawlUrlLoading} /><div><Button type="submit" variant="primary" loading={firecrawlUrlLoading}>Save</Button></div>{firecrawlUrlStatus.message ? <p role="status" className={`text-xs ${statusClass(firecrawlUrlStatus)}`}>{firecrawlUrlStatus.message}</p> : null}</form></CardContent></Card>
      </section>
  );
}
