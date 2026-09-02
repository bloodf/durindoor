import React, { useState } from "react";

import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardFooter, CardHeader } from "@/shared/ui/components/Card.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";

import {
  AUTH_MODE_OPTIONS,
  LANGUAGE_OPTIONS,
  RETENTION_OPTIONS,
  SECTION_LINKS,
  SETTINGS_DEFAULTS,
  THEME_OPTIONS,
} from "./mockData.js";

function SettingRow({ children, className = "" }) {
  return (
    <div
      className={`flex flex-col gap-3 border-b border-dd-border-subtle py-4 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      {children}
    </div>
  );
}

function SectionCard({ id, icon, title, subtitle, actions, children, footer }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <Card padding={false}>
        <CardHeader
          icon={icon}
          title={<span id={`${id}-title`}>{title}</span>}
          subtitle={subtitle}
          actions={actions}
        />
        <CardContent>{children}</CardContent>
        {footer ? <CardFooter className="justify-end">{footer}</CardFooter> : null}
      </Card>
    </section>
  );
}

function SectionNav({ activeSection, onSelect }) {
  return (
    <nav aria-label="Settings sections" className="sticky top-6 rounded-dd-lg border border-dd-border bg-dd-surface p-2">
      <p className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-dd-subtle">
        On this page
      </p>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {SECTION_LINKS.map((section) => {
          const active = activeSection === section.id;
          return (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                aria-current={active ? "location" : undefined}
                onClick={() => onSelect(section.id)}
                className={
                  active
                    ? "flex items-center gap-2 rounded-dd border-l-2 border-dd-accent bg-dd-accent-soft px-3 py-2 text-[13px] font-medium text-dd-accent outline-none focus-visible:shadow-dd-focus"
                    : "flex items-center gap-2 rounded-dd border-l-2 border-transparent px-3 py-2 text-[13px] text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
                }
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[17px] leading-none">
                  {section.icon}
                </span>
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function CopyValue({ value }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 truncate font-mono text-xs text-dd-text" title={value}>
        {value}
      </code>
      <IconButton
        icon={copied ? "check" : "content_copy"}
        label={copied ? "Copied" : "Copy value"}
        size="sm"
        onClick={copy}
      />
    </div>
  );
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("appearance");
  const [theme, setTheme] = useState(SETTINGS_DEFAULTS.theme);
  const [language, setLanguage] = useState(SETTINGS_DEFAULTS.language);
  const [authMode, setAuthMode] = useState(SETTINGS_DEFAULTS.authMode);
  const [retention, setRetention] = useState(SETTINGS_DEFAULTS.retention);
  const [toggles, setToggles] = useState({
    combosOnly: false,
    hidePaid: false,
    requireLogin: true,
    roundRobin: false,
    visionBridge: true,
    outboundProxy: false,
    observability: true,
    proxyTimeline: true,
  });

  const updateToggle = (key) => (checked) => {
    setToggles((current) => ({ ...current, [key]: checked }));
  };

  const activeAuthDescription = AUTH_MODE_OPTIONS.find(
    (option) => option.value === authMode,
  )?.description;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader icon="settings" title="Settings" subtitle="Manage your preferences" />
      <div className="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <SectionNav activeSection={activeSection} onSelect={setActiveSection} />

        <div className="flex min-w-0 flex-col gap-5">
        <SectionCard
          id="appearance"
          icon="computer"
          title="Local Mode"
          subtitle="Appearance, local data, and backups"
          actions={
            <span className="inline-flex items-center gap-1.5 text-xs text-dd-success">
              <span aria-hidden="true" className="material-symbols-outlined text-[15px] leading-none">
                check_circle
              </span>
              Local
            </span>
          }
        >
          <SettingRow>
            <div>
              <p className="text-[13px] font-medium text-dd-text">Theme</p>
              <p className="mt-0.5 text-xs text-dd-muted">Choose how DurinDoor looks on this device.</p>
            </div>
            <SegmentedControl
              options={THEME_OPTIONS}
              value={theme}
              onChange={setTheme}
              aria-label="Theme"
            />
          </SettingRow>
          <SettingRow>
            <div>
              <p className="text-[13px] font-medium text-dd-text">Database location</p>
              <p className="mt-0.5 text-xs text-dd-muted">DurinDoor data directory</p>
            </div>
            <CopyValue value={SETTINGS_DEFAULTS.databasePath} />
          </SettingRow>
          <SettingRow>
            <div>
              <p className="text-[13px] font-medium text-dd-text">Backup</p>
              <p className="mt-0.5 text-xs text-dd-muted">Export or restore your local configuration and history.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" icon="download">Download Backup</Button>
              <Button variant="ghost" size="sm" icon="upload_file">Import Backup</Button>
            </div>
          </SettingRow>
        </SectionCard>

        <SectionCard
          id="language"
          icon="language"
          title="Language"
          subtitle="Regional display preferences"
        >
          <Field label="Display language" hint="Changes dashboard labels only; provider responses are unaffected.">
            <Select options={LANGUAGE_OPTIONS} value={language} onChange={setLanguage} />
          </Field>
        </SectionCard>

        <SectionCard
          id="model-catalog"
          icon="view_list"
          title="Model catalog"
          subtitle="Control which models appear in selectors and API discovery"
        >
          <div className="divide-y divide-dd-border-subtle">
            <div className="pb-4">
              <Toggle
                label="Expose combos only"
                description="Hide direct provider models and show only configured combo routes."
                checked={toggles.combosOnly}
                onChange={updateToggle("combosOnly")}
              />
            </div>
            <div className="pt-4">
              <Toggle
                label="Hide paid models"
                description="Remove models with known per-token pricing from the catalog."
                checked={toggles.hidePaid}
                onChange={updateToggle("hidePaid")}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          id="security"
          icon="shield_lock"
          title="Security"
          subtitle="Protect access to the local dashboard"
          actions={
            <span className="inline-flex items-center gap-1.5 text-xs text-dd-success">
              <span aria-hidden="true" className="material-symbols-outlined text-[15px] leading-none">lock</span>
              Protected
            </span>
          }
        >
          <div className="space-y-5">
            <Toggle
              label="Require login"
              description="Ask for authentication before opening the dashboard."
              checked={toggles.requireLogin}
              onChange={updateToggle("requireLogin")}
            />
            <div className="grid gap-4 border-t border-dd-border-subtle pt-5 md:grid-cols-3">
              <Input label="Current password" type="password" autoComplete="current-password" placeholder="Current password" />
              <Input label="New password" type="password" autoComplete="new-password" placeholder="New password" />
              <Input label="Confirm password" type="password" autoComplete="new-password" placeholder="Confirm password" />
            </div>
            <div className="flex justify-end">
              <Button variant="primary" icon="password">Update Password</Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          id="oidc"
          icon="badge"
          title="OIDC Dashboard Login"
          subtitle="Connect DurinDoor to your identity provider"
          actions={<Button variant="ghost" size="sm" icon="open_in_new">Provider docs</Button>}
          footer={
            <>
              <Button variant="ghost" icon="network_check">Test connection</Button>
              <Button variant="primary" icon="save">Save auth mode</Button>
            </>
          }
        >
          <div className="space-y-5">
            <Field label="Auth mode" hint={activeAuthDescription}>
              <SegmentedControl
                options={AUTH_MODE_OPTIONS}
                value={authMode}
                onChange={setAuthMode}
                aria-label="Dashboard authentication mode"
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Issuer URL" defaultValue={SETTINGS_DEFAULTS.issuerUrl} icon="link" />
              <Input label="Client ID" defaultValue={SETTINGS_DEFAULTS.clientId} />
              <Input label="Client Secret" type="password" defaultValue={SETTINGS_DEFAULTS.clientSecret} autoComplete="off" />
              <Input label="Scopes" defaultValue={SETTINGS_DEFAULTS.scopes} hint="Space-separated OIDC scopes." />
              <div className="md:col-span-2">
                <Input label="Login Button Label" defaultValue={SETTINGS_DEFAULTS.loginButtonLabel} />
              </div>
            </div>
            <div className="rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-3 py-2.5">
              <p className="mb-1 text-xs font-medium text-dd-muted">Redirect URI</p>
              <CopyValue value={SETTINGS_DEFAULTS.redirectUri} />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          id="routing"
          icon="route"
          title="Routing Strategy"
          subtitle="Defaults used when DurinDoor selects an upstream model"
        >
          <div className="space-y-5">
            <Toggle
              label="Combo Round Robin"
              description="Rotate evenly through healthy providers in each combo."
              checked={toggles.roundRobin}
              onChange={updateToggle("roundRobin")}
            />
            <div className="border-t border-dd-border-subtle pt-5">
              <Input
                label="Vision Model"
                hint="Fallback model for requests containing image input."
                defaultValue={SETTINGS_DEFAULTS.visionModel}
                icon="visibility"
              />
            </div>
            <div className="border-t border-dd-border-subtle pt-5">
              <Toggle
                label="Vision Bridge"
                description="Route image inputs through the vision model when the selected model cannot inspect images."
                checked={toggles.visionBridge}
                onChange={updateToggle("visionBridge")}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          id="network"
          icon="lan"
          title="Network"
          subtitle="Outbound services and proxy behavior"
          footer={<Button variant="primary" icon="save">Save network settings</Button>}
        >
          <div className="space-y-5">
            <Toggle
              label="Outbound Proxy"
              description="Send provider traffic through the configured HTTP proxy."
              checked={toggles.outboundProxy}
              onChange={updateToggle("outboundProxy")}
            />
            <div className="border-t border-dd-border-subtle pt-5">
              <Input
                label="Firecrawl URL"
                hint="Endpoint used by search and page extraction tools."
                defaultValue={SETTINGS_DEFAULTS.firecrawlUrl}
                icon="travel_explore"
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          id="observability"
          icon="monitoring"
          title="Observability"
          subtitle="Local request diagnostics and retention"
        >
          <div className="space-y-5">
            <Toggle
              label="Enable Observability"
              description="Collect local request health, latency, and usage signals."
              checked={toggles.observability}
              onChange={updateToggle("observability")}
            />
            <div className="border-t border-dd-border-subtle pt-5">
              <Toggle
                label="Proxy timeline"
                description="Record each gateway hop for troubleshooting and audit history."
                checked={toggles.proxyTimeline}
                onChange={updateToggle("proxyTimeline")}
              />
            </div>
            <div className="border-t border-dd-border-subtle pt-5">
              <Field
                label="Timeline retention"
                hint="Older timeline events are removed automatically from the local database."
              >
                <Select
                  options={RETENTION_OPTIONS}
                  value={retention}
                  onChange={setRetention}
                  className="sm:max-w-56"
                />
              </Field>
            </div>
          </div>
        </SectionCard>

        <footer className="flex flex-col gap-4 rounded-dd-lg border border-dd-border bg-dd-surface px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" icon="power_settings_new" className="text-dd-danger hover:text-dd-danger">
              Shutdown
            </Button>
            <Button variant="ghost" icon="logout">Logout</Button>
          </div>
          <div className="sm:ml-auto sm:text-right">
            <p className="dd-tnum text-xs font-medium text-dd-text">DurinDoor v3.18.1</p>
            <p className="mt-0.5 text-xs text-dd-muted">Local Mode - All data stored on your machine</p>
          </div>
        </footer>
        </div>
      </div>
    </div>
  );
}
