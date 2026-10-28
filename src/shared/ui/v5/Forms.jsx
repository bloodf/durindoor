import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  Field,
  Icon,
  Notice,
  Panel,
  Switch,
} from "./components.jsx";
import { validateConnection } from "./model.js";

/** Connection testing and saves are simulated locally; no entered value leaves Storybook. */
export function ConnectionForm({
  onSave,
  onCancel,
  initialState = "idle",
  readOnly = false,
  inline = false,
  onDirtyChange,
  onPendingChange,
}) {
  const [values, setValues] = useState({
    name: ["idle", "invalid"].includes(initialState)
      ? ""
      : "Anthropic production",
    provider: "Anthropic",
    secret: ["idle", "invalid"].includes(initialState) ? "" : "sample-key-only",
    endpoint: "https://api.example.com/v1",
  });
  const [errors, setErrors] = useState(
    initialState === "invalid"
      ? {
          name: "Enter a connection name.",
          secret: "Enter a sample API key to test this connection.",
        }
      : {},
  );
  const [state, setState] = useState(initialState);
  const [visible, setVisible] = useState(false);
  const [method, setMethod] = useState("key");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const timer = useRef(null);
  const errorSummary = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const update = (field, value) => {
    setDirty(true);
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setState("idle");
  };
  const pending = state === "saving" || state === "testing";
  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);
  const test = () => {
    const next = validateConnection(values);
    setErrors(next);
    if (Object.keys(next).length) {
      setState("invalid");
      queueMicrotask(() => errorSummary.current?.focus());
      return;
    }
    setState("testing");
    timer.current = setTimeout(
      () => setState(values.secret === "simulate-error" ? "error" : "tested"),
      650,
    );
  };
  const submit = (event) => {
    event.preventDefault();
    const next = validateConnection(values);
    setErrors(next);
    if (Object.keys(next).length) {
      setState("invalid");
      queueMicrotask(() => errorSummary.current?.focus());
      return;
    }
    setState("saving");
    timer.current = setTimeout(() => {
      setState("success");
      setDirty(false);
      onSave?.({ ...values, secret: "" });
    }, 650);
  };
  return (
    <form onSubmit={submit} noValidate className="v5-form">
      <Notice title="Use sample credentials only">
        This review prototype never contacts a provider or stores credentials.
      </Notice>
      {state === "invalid" && (
        <div
          ref={errorSummary}
          tabIndex={-1}
          role="alert"
          className="v5-validation-summary"
        >
          <strong>Check the highlighted fields</strong>
          <ul>
            {Object.entries(errors)
              .filter(([, message]) => message)
              .map(([field, message]) => (
                <li key={field}>
                  <a href={`#connection-${field}`}>{message}</a>
                </li>
              ))}
          </ul>
        </div>
      )}
      <fieldset disabled={pending || readOnly}>
        <Field label="Provider">
          {(props) => (
            <select
              {...props}
              value={values.provider}
              onChange={(event) => update("provider", event.target.value)}
            >
              <option>Anthropic</option>
              <option>OpenAI</option>
              <option>Google</option>
              <option>OpenAI-compatible</option>
            </select>
          )}
        </Field>
        <Field
          id="connection-name"
          label="Connection name"
          hint="A recognizable name for this account."
          error={errors.name}
        >
          {(props) => (
            <input
              {...props}
              id="connection-name"
              autoComplete="off"
              value={values.name}
              placeholder="e.g. Anthropic production"
              onChange={(event) => update("name", event.target.value)}
            />
          )}
        </Field>
        <div className="v5-segmented" aria-label="Authentication method">
          <button
            type="button"
            aria-pressed={method === "key"}
            onClick={() => setMethod("key")}
          >
            API key
          </button>
          <button
            type="button"
            aria-pressed={method === "oauth"}
            onClick={() => setMethod("oauth")}
          >
            OAuth preview
          </button>
        </div>
        {method === "oauth" && (
          <Notice
            title="OAuth connection preview"
            action={
              <Button
                onClick={() => {
                  update("secret", "sample-oauth-token");
                  setState("tested");
                }}
              >
                Simulate authorization
              </Button>
            }
          >
            Preview the authorized state without opening a real sign-in window.
          </Notice>
        )}
        <Field
          id="connection-secret"
          label="Sample API key"
          hint="Use simulate-error to preview a failed connection test."
          error={errors.secret}
        >
          {(props) => (
            <div className="v5-secret-field">
              <input
                {...props}
                id="connection-secret"
                type={visible ? "text" : "password"}
                autoComplete="off"
                value={values.secret}
                placeholder="Enter a sample key"
                onChange={(event) => update("secret", event.target.value)}
              />
              <Button
                aria-label={visible ? "Hide sample key" : "Show sample key"}
                icon={visible ? "visibility_off" : "visibility"}
                onClick={() => setVisible(!visible)}
              />
            </div>
          )}
        </Field>
        <Field
          id="connection-endpoint"
          label="Base URL"
          hint="Illustrative URL for the setup preview."
          error={errors.endpoint}
        >
          {(props) => (
            <input
              {...props}
              id="connection-endpoint"
              type="url"
              value={values.endpoint}
              onChange={(event) => update("endpoint", event.target.value)}
            />
          )}
        </Field>
      </fieldset>
      {state === "error" && (
        <Notice tone="danger" title="Connection test failed">
          The sample provider rejected this key. Check the credential and try
          again.
        </Notice>
      )}
      {state === "tested" && (
        <Notice tone="success" title="Sample connection verified">
          Authentication and model discovery completed in this simulation.
        </Notice>
      )}
      {state === "success" && (
        <Notice tone="success" title="Connection saved">
          The sample connection is ready to use in this preview.
        </Notice>
      )}
      <div
        className={`v5-form-actions ${inline ? "v5-inline-form-actions" : ""}`}
      >
        {onCancel && (
          <Button onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button
          icon="wifi_tethering"
          busy={state === "testing"}
          disabled={pending || readOnly}
          onClick={test}
        >
          Test connection
        </Button>
        <Button
          type="submit"
          tone="primary"
          busy={state === "saving"}
          disabled={pending || readOnly}
        >
          {state === "saving" ? "Saving…" : "Save connection"}
        </Button>
      </div>
    </form>
  );
}

const SETTINGS = {
  settings: {
    title: "Gateway defaults",
    fields: [
      [
        "Workspace name",
        "My workspace",
        "Visible in the navigation and command menu.",
      ],
      [
        "Request timeout (seconds)",
        "60",
        "Maximum time before a request is considered timed out.",
      ],
    ],
    switches: [
      ["Request logging", "Keep request metadata available for inspection."],
      [
        "Automatic fallback",
        "Try the next configured model after a provider failure.",
      ],
    ],
  },
  database: {
    title: "Storage configuration",
    fields: [
      [
        "Database engine",
        "SQLite",
        "Review an engine change before migrating data.",
      ],
      [
        "Connection URL",
        "postgresql://sample-host/durindoor",
        "Sample URL only. Do not enter live credentials.",
      ],
    ],
    switches: [
      ["Backups", "Create a backup before storage maintenance."],
      [
        "Connection diagnostics",
        "Include storage checks in gateway diagnostics.",
      ],
    ],
  },
  profile: {
    title: "Your profile",
    fields: [
      [
        "Display name",
        "Workspace administrator",
        "The name shown in this review workspace.",
      ],
      [
        "Email",
        "admin@example.com",
        "Sample address used for the profile preview.",
      ],
    ],
    switches: [
      ["Compact tables", "Show more rows when working with large inventories."],
      ["Reduce motion", "Prefer instant changes over animated transitions."],
    ],
  },
  "token-saver-settings": {
    title: "Compression behavior",
    fields: [
      [
        "Minimum result size (characters)",
        "2000",
        "Only compress tool results above this threshold.",
      ],
      [
        "Target reduction (%)",
        "35",
        "A sample target for the proposed configuration UI.",
      ],
    ],
    switches: [
      [
        "Compress tool results",
        "Reduce eligible tool-result bodies before forwarding.",
      ],
      ["Preserve errors", "Keep failed tool results untouched."],
    ],
  },
};
export function SettingsForm({
  pageId = "settings",
  readOnly,
  onNotify,
  initialDirty = false,
  onDirtyChange,
}) {
  const schema = SETTINGS[pageId] || SETTINGS.settings;
  const defaults = schema.fields.map(([, value]) => value);
  const [values, setValues] = useState(defaults);
  const [toggles, setToggles] = useState([true, true]);
  const [retention, setRetention] = useState("30");
  const saved = useRef({
    values: defaults,
    toggles: [true, true],
    retention: "30",
  });
  const [dirty, setDirty] = useState(initialDirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const [tab, setTab] = useState("General");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = (event) => {
    event.preventDefault();
    if (values.some((value) => !value.trim())) {
      setError("Complete all required fields before saving.");
      return;
    }
    if (
      !Number.isInteger(Number(retention)) ||
      Number(retention) < 1 ||
      Number(retention) > 365
    ) {
      setTab("Advanced");
      setError("Enter a log retention period between 1 and 365 days.");
      return;
    }
    setError("");
    setSaving(true);
    timer.current = setTimeout(() => {
      saved.current = { values: [...values], toggles: [...toggles], retention };
      setSaving(false);
      setDirty(false);
      onNotify("Settings saved in this preview session.");
    }, 650);
  };
  return (
    <form className="v5-settings-form" onSubmit={save}>
      <div className="v5-tabs" aria-label="Settings sections">
        {["General", "Behavior", "Advanced"].map((label) => (
          <button
            type="button"
            key={label}
            aria-pressed={tab === label}
            onClick={() => setTab(label)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <Notice tone="danger" title={error} />}
      <Panel
        title={
          tab === "General"
            ? schema.title
            : tab === "Behavior"
              ? "Preferences"
              : "Operational limits"
        }
        description="Changes here affect sample data in this review only."
      >
        <fieldset disabled={readOnly || saving}>
          {tab === "General" ? (
            schema.fields.map(([label, , hint], index) => (
              <Field key={label} label={label} hint={hint}>
                {(props) => (
                  <input
                    {...props}
                    value={values[index]}
                    onChange={(event) => {
                      setValues(
                        values.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      );
                      setDirty(true);
                    }}
                  />
                )}
              </Field>
            ))
          ) : tab === "Behavior" ? (
            schema.switches.map(([label, description], index) => (
              <Switch
                key={label}
                label={label}
                description={description}
                checked={toggles[index]}
                onChange={(checked) => {
                  setToggles(
                    toggles.map((value, i) => (i === index ? checked : value)),
                  );
                  setDirty(true);
                }}
              />
            ))
          ) : (
            <>
              <Field
                label="Log retention (days)"
                hint="Review storage requirements before changing retention."
              >
                {(props) => (
                  <input
                    {...props}
                    type="number"
                    min="1"
                    max="365"
                    value={retention}
                    onChange={(event) => {
                      setRetention(event.target.value);
                      setDirty(true);
                    }}
                  />
                )}
              </Field>
              <Notice tone="warning" title="Review operational changes">
                Storage migrations and live gateway changes require a separate
                implementation after design approval.
              </Notice>
            </>
          )}
        </fieldset>
      </Panel>
      <div className="v5-save-bar">
        <span>
          {readOnly
            ? "You have read-only access."
            : dirty
              ? "You have unsaved changes"
              : "All changes saved"}
        </span>
        <Button
          disabled={!dirty || saving}
          onClick={() => {
            setValues([...saved.current.values]);
            setToggles([...saved.current.toggles]);
            setRetention(saved.current.retention);
            setDirty(false);
            setError("");
          }}
        >
          Discard changes
        </Button>
        <Button
          type="submit"
          tone="primary"
          busy={saving}
          disabled={!dirty || readOnly}
        >
          Save changes
        </Button>
      </div>
    </form>
  );
}

export function ResourceEditor({ page, row, onSave, onClose, onDirtyChange }) {
  const [name, setName] = useState(row?.name || "");
  const [target, setTarget] = useState(row?.detail || "");
  const [enabled, setEnabled] = useState(true);
  const dirty =
    name !== (row?.name || "") || target !== (row?.detail || "") || !enabled;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const [error, setError] = useState("");
  const isKey = page.kind === "keys" || page.id === "endpoint";
  const isProxy = page.id === "proxy-pools" || page.id === "pxpipe";
  const save = (event) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter a name before saving.");
      return;
    }
    if (isProxy && !/^https?:\/\//.test(target)) {
      setError("Enter a complete HTTP or HTTPS proxy URL.");
      return;
    }
    onSave({
      id: row?.id || `preview-${name}`,
      name,
      detail:
        target ||
        (isKey ? "dd_preview_••••0000" : "Sample workspace configuration"),
      provider: "Workspace",
      value: isKey ? "Created just now" : "Configured",
      status: enabled ? "Active" : "Disabled",
      time: "Just now",
    });
  };
  return (
    <Dialog
      drawer
      title={row ? `Edit ${row.name}` : page.action}
      description="Sample configuration for design review."
      onClose={onClose}
    >
      <form className="v5-form" onSubmit={save}>
        {error && <Notice tone="danger" title={error} />}
        <Field label={isKey ? "Key name" : "Name"}>
          {(props) => (
            <input
              {...props}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                isKey
                  ? "e.g. Production client"
                  : "Give this configuration a name"
              }
            />
          )}
        </Field>
        <Field
          label={
            isKey
              ? "Expiration"
              : isProxy
                ? "Proxy URL"
                : page.id === "mcp-gateway"
                  ? "Server URL"
                  : "Description / target"
          }
          hint={
            isKey
              ? "Sample keys never grant gateway access."
              : "Sample values only."
          }
        >
          {(props) =>
            isKey ? (
              <select
                {...props}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Select expiration</option>
                <option>30 days</option>
                <option>90 days</option>
                <option>Never</option>
              </select>
            ) : (
              <input
                {...props}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder={
                  isProxy ? "http://localhost:8080" : "Configuration details"
                }
              />
            )
          }
        </Field>
        <Switch
          label="Enabled"
          description="Make this sample item available in the workspace."
          checked={enabled}
          onChange={setEnabled}
        />
        <div className="v5-form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" tone="primary">
            {isKey ? "Create sample key" : "Save changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ComboEditor({ readOnly, onNotify, onDirtyChange }) {
  const [chain, setChain] = useState([
    "Anthropic / claude-sonnet",
    "OpenAI / gpt-4.1",
    "Google / gemini-flash",
  ]);
  const [name, setName] = useState("coding-fallback");
  const [strategy, setStrategy] = useState("Ordered fallback");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const [added, setAdded] = useState("Ollama / local-model");
  const [tested, setTested] = useState(false);
  const move = (index, offset) => {
    const next = [...chain];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setChain(next);
    setDirty(true);
  };
  return (
    <div className="v5-two-column">
      <Panel
        title="Route configuration"
        description="One alias, a clear order of fallback models."
      >
        <fieldset disabled={readOnly}>
          <Field label="Combo name">
            {(props) => (
              <input
                {...props}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setDirty(true);
                }}
              />
            )}
          </Field>
          <Field label="Routing strategy">
            {(props) => (
              <select
                {...props}
                value={strategy}
                onChange={(event) => {
                  setStrategy(event.target.value);
                  setDirty(true);
                }}
              >
                <option>Ordered fallback</option>
                <option>Round robin</option>
              </select>
            )}
          </Field>
          <h3>Model chain</h3>
          <ol className="v5-route-chain">
            {chain.map((model, index) => (
              <li key={model}>
                <span className="v5-step-number">{index + 1}</span>
                <strong>{model}</strong>
                <div className="v5-inline">
                  <Button
                    aria-label={`Move ${model} up`}
                    icon="arrow_upward"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  />
                  <Button
                    aria-label={`Move ${model} down`}
                    icon="arrow_downward"
                    disabled={index === chain.length - 1}
                    onClick={() => move(index, 1)}
                  />
                  <Button
                    aria-label={`Remove ${model}`}
                    icon="close"
                    disabled={chain.length === 1}
                    onClick={() => {
                      setChain(chain.filter((item) => item !== model));
                      setDirty(true);
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
          <div className="v5-inline">
            <select
              aria-label="Model to add"
              value={added}
              onChange={(event) => setAdded(event.target.value)}
            >
              {[
                "Ollama / local-model",
                "Codex / coding-model",
                "OpenAI / gpt-4.1",
              ].map((model) => (
                <option key={model}>{model}</option>
              ))}
            </select>
            <Button
              icon="add"
              disabled={chain.includes(added)}
              onClick={() => {
                setChain([...chain, added]);
                setDirty(true);
              }}
            >
              Add model
            </Button>
          </div>
        </fieldset>
        <div className="v5-form-actions">
          <Button icon="play_arrow" onClick={() => setTested(true)}>
            Simulate route
          </Button>
          <Button
            tone="primary"
            disabled={readOnly || !dirty || !name.trim()}
            onClick={() => {
              setDirty(false);
              onNotify("Sample route saved.");
            }}
          >
            Save route
          </Button>
        </div>
      </Panel>
      <Panel
        title="Route preview"
        description="Sample failure and recovery through the configured chain."
      >
        <div className="v5-route-preview">
          {chain.map((model, index) => (
            <div key={model}>
              <Icon name={index === 0 ? "warning" : "check_circle"} />
              <div>
                <strong>{model}</strong>
                <p>
                  {index === 0
                    ? "Rate limit reached. Try the next model."
                    : index === 1
                      ? "Request completed successfully."
                      : "Available as a further fallback."}
                </p>
              </div>
              <Badge tone={index === 0 ? "warning" : "success"}>
                {index === 0 ? "429" : index === 1 ? "200" : "Ready"}
              </Badge>
            </div>
          ))}
        </div>
        {tested && (
          <Notice tone="success" title="Sample route simulation complete">
            The configured chain recovered from the first provider rate limit.
          </Notice>
        )}
      </Panel>
    </div>
  );
}
