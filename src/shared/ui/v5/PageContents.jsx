import { useRef, useState, useEffect } from "react";
import {
  Badge,
  Button,
  CopyButton,
  Field,
  Icon,
  Notice,
  Panel,
  Switch,
} from "./components.jsx";
import DataTable from "./DataTable.jsx";
import { ComboEditor, ConnectionForm, SettingsForm } from "./Forms.jsx";
import { connections } from "./catalog.js";
import { TrafficChart } from "./Dashboard.jsx";

export function RequestDetails({ row }) {
  const request = row || {
    name: "claude-sonnet",
    status: "Success",
    id: "req_8f2a",
    latency: "842 ms",
    value: "1,284 tokens",
  };
  const [tab, setTab] = useState("Overview");
  return (
    <>
      <div className="v5-detail-summary">
        <Badge>{request.status}</Badge>
        <code>{request.id}</code>
        <CopyButton value={request.id} label="Copy ID" />
      </div>
      <div className="v5-tabs">
        {["Overview", "Request", "Response"].map((label) => (
          <button
            key={label}
            aria-pressed={tab === label}
            onClick={() => setTab(label)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "Overview" ? (
        <>
          <dl className="v5-key-value">
            <dt>Model</dt>
            <dd>{request.name}</dd>
            <dt>Latency</dt>
            <dd>{request.latency || "624 ms"}</dd>
            <dt>Tokens</dt>
            <dd>{request.value}</dd>
            <dt>Protocol</dt>
            <dd>OpenAI-compatible</dd>
            <dt>Client</dt>
            <dd>Sample development key</dd>
          </dl>
          <h3>Request lifecycle</h3>
          <ol className="v5-event-list">
            {[
              ["Request received", "0 ms"],
              ["Route resolved", "4 ms"],
              ["Provider connected", "112 ms"],
              [
                request.status === "Failed"
                  ? "Provider timeout"
                  : "Response completed",
                request.latency || "624 ms",
              ],
            ].map(([label, value]) => (
              <li key={label}>
                <span className="v5-live-dot" />
                <strong>{label}</strong>
                <span>{value}</span>
              </li>
            ))}
          </ol>
          {request.status === "Failed" && (
            <Notice tone="danger" title="Provider timed out">
              Review the connection and timeout settings before retrying this
              request.
            </Notice>
          )}
        </>
      ) : (
        <>
          <p className="v5-muted">
            Sanitized illustrative payload. No real prompts or credentials.
          </p>
          <pre className="v5-code">
            {JSON.stringify(
              tab === "Request"
                ? {
                    model: request.name,
                    messages: [
                      {
                        role: "user",
                        content: "Explain ordered fallback routing.",
                      },
                    ],
                    stream: true,
                  }
                : {
                    id: request.id,
                    status: request.status,
                    usage: { input_tokens: 1024, output_tokens: 260 },
                    content:
                      "A fallback route tries the next configured model when a provider fails.",
                  },
              null,
              2,
            )}
          </pre>
        </>
      )}
    </>
  );
}
export function ResourceDetails({ row, onEdit, readOnly, onRevoke, onOpen }) {
  return (
    <>
      <div className="v5-detail-summary">
        <Badge>{row.status}</Badge>
        <Button icon="edit" disabled={readOnly} onClick={onEdit}>
          Edit configuration
        </Button>
        {onRevoke && (
          <Button
            tone="danger"
            icon="key_off"
            disabled={readOnly || row.status === "Disabled"}
            onClick={onRevoke}
          >
            Revoke key
          </Button>
        )}
        {onOpen && (
          <Button icon="open_in_new" onClick={onOpen}>
            Open full page
          </Button>
        )}
      </div>
      <dl className="v5-key-value">
        <dt>Name</dt>
        <dd>{row.name}</dd>
        <dt>Configuration</dt>
        <dd>{row.detail}</dd>
        <dt>Details</dt>
        <dd>{row.value}</dd>
        <dt>Last activity</dt>
        <dd>{row.time}</dd>
      </dl>
      <Notice title="Preview configuration">
        Changes affect the sample inventory only.
      </Notice>
    </>
  );
}
function Providers({ rows, readOnly, onInspect, onBulkChange }) {
  return (
    <>
      <div className="v5-provider-strip">
        {rows.slice(0, 4).map((row) => (
          <button
            key={row.id}
            className="v5-provider-tile"
            onClick={() => onInspect(row)}
          >
            <span
              className={`v5-provider-monogram v5-provider-${row.id}`}
              aria-hidden="true"
            >
              {row.name.slice(0, 1)}
            </span>
            <span>
              <strong>{row.name}</strong>
              <small>{row.value}</small>
            </span>
            <Badge>{row.status}</Badge>
          </button>
        ))}
      </div>
      <Panel
        title="Connected accounts"
        description="Credentials and account health across your configured providers."
      >
        <DataTable
          rows={rows}
          readOnly={readOnly}
          onInspect={onInspect}
          onBulkChange={onBulkChange}
        />
      </Panel>
    </>
  );
}
function Quota({ headroom }) {
  const [window, setWindow] = useState("Current window");
  return (
    <>
      <div className="v5-dashboard-toolbar">
        <span className="v5-muted">Sample capacity · Oct 8, 2026</span>
        <select
          aria-label="Capacity window"
          value={window}
          onChange={(event) => setWindow(event.target.value)}
        >
          <option>Current window</option>
          <option>Previous window</option>
        </select>
      </div>
      <Panel
        title={headroom ? "Context capacity by model" : "Account quota windows"}
        description={
          headroom
            ? "Sample context utilization. Capacity depends on the chosen model."
            : "Provider limits and reset windows shown as illustrative values."
        }
      >
        <div className="v5-capacity-list">
          {connections.slice(0, 4).map((row, index) => {
            const percent =
              [42, 68, 94, 21][index] *
              (window === "Previous window" ? 0.8 : 1);
            return (
              <div key={row.id}>
                <div className="v5-capacity-label">
                  <strong>{row.name}</strong>
                  <Badge tone={percent > 90 ? "warning" : "success"}>
                    {percent > 90 ? "Near limit" : "Available"}
                  </Badge>
                </div>
                <div className="v5-capacity-meter">
                  <meter
                    min="0"
                    max="100"
                    value={percent}
                    aria-label={`${row.name} capacity used`}
                    style={{
                      "--series":
                        percent > 90 ? "var(--v5-warning)" : "var(--v5-accent)",
                    }}
                  >
                    {percent}%
                  </meter>
                  <strong>{percent.toFixed(0)}%</strong>
                </div>
                <p>
                  {headroom
                    ? `${Math.round(128000 * (1 - percent / 100)).toLocaleString("en-US")} tokens remaining in a sample 128K context`
                    : "Resets in 2 hours · Sample provider-reported limit"}
                </p>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
function Health() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <>
      <Notice tone="warning" title="One connection needs attention">
        Google is currently rate limited in this sample. Configured fallback
        routes can keep requests moving.
      </Notice>
      <div className="v5-two-column">
        <Panel
          title="Connection checks"
          action={
            <Button
              busy={running}
              icon="refresh"
              onClick={() => {
                setRunning(true);
                timer.current = setTimeout(() => {
                  setRunning(false);
                  setDone(true);
                }, 700);
              }}
            >
              Run checks
            </Button>
          }
        >
          <div className="v5-health-list">
            {connections.slice(0, 4).map((row) => (
              <div key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <small>{row.latency} median response</small>
                </div>
                <Badge>{row.status}</Badge>
              </div>
            ))}
          </div>
          {done && (
            <Notice tone="success" title="Sample checks complete">
              Four configured connections checked.
            </Notice>
          )}
        </Panel>
        <Panel title="Gateway diagnostics">
          <dl className="v5-key-value">
            <dt>API gateway</dt>
            <dd>
              <Badge>Healthy</Badge>
            </dd>
            <dt>Database</dt>
            <dd>
              <Badge>Healthy</Badge>
            </dd>
            <dt>Request logger</dt>
            <dd>
              <Badge>Active</Badge>
            </dd>
            <dt>Version</dt>
            <dd>v5 design preview</dd>
            <dt>Uptime</dt>
            <dd>2d 14h · Sample</dd>
          </dl>
        </Panel>
      </div>
      <Panel title="Request volume">
        <TrafficChart />
      </Panel>
    </>
  );
}
function Playground() {
  const [model, setModel] = useState("coding-fallback");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const send = (event) => {
    event.preventDefault();
    if (!prompt.trim()) {
      setError("Enter a prompt before sending.");
      return;
    }
    const text = prompt;
    setError("");
    setRunning(true);
    setMessages([...messages, { role: "You", content: text }]);
    setPrompt("");
    timer.current = setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          role: "Sample assistant",
          content:
            "An ordered fallback route tries each configured model in sequence. If a provider returns a retryable failure, the next model handles the request. This is a local sample response for the v5 review.",
        },
      ]);
      setRunning(false);
    }, 900);
  };
  return (
    <div className="v5-playground">
      <aside>
        <h2>Session settings</h2>
        <Field label="Model / combo">
          {(props) => (
            <select
              {...props}
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              <option>coding-fallback</option>
              <option>claude-sonnet</option>
              <option>gpt-4.1</option>
            </select>
          )}
        </Field>
        <Field label="System instruction">
          {(props) => (
            <textarea
              {...props}
              rows="5"
              defaultValue="You are a concise, helpful assistant."
            />
          )}
        </Field>
        <Field label="Temperature">
          {(props) => (
            <input
              {...props}
              type="number"
              min="0"
              max="2"
              step="0.1"
              defaultValue="0.7"
            />
          )}
        </Field>
        <Switch
          label="Streaming"
          description="Preview a streaming-compatible conversation."
          checked={!running}
          onChange={() => setError("Streaming is simulated in this review.")}
        />
        <Notice title="Local simulation">
          No prompt is sent to a provider.
        </Notice>
      </aside>
      <section>
        <div className="v5-chat-heading">
          <Badge>{model}</Badge>
          <Button
            icon="delete_sweep"
            disabled={running || !messages.length}
            onClick={() => setMessages([])}
          >
            Clear session
          </Button>
        </div>
        <div
          className="v5-chat-messages"
          role="log"
          aria-label="Sample conversation"
        >
          {messages.length === 0 ? (
            <div className="v5-chat-intro">
              <Icon name="chat_bubble" size={32} />
              <h2>Try your gateway</h2>
              <p>Start with a prompt or use the sample below.</p>
              <Button
                onClick={() => setPrompt("Explain ordered fallback routing.")}
              >
                Explain fallback routing
              </Button>
            </div>
          ) : (
            messages.map((message, index) => (
              <article
                key={index}
                className={
                  message.role === "You"
                    ? "v5-message-user"
                    : "v5-message-assistant"
                }
              >
                <strong>{message.role}</strong>
                <p>{message.content}</p>
              </article>
            ))
          )}
          {running && (
            <p role="status" className="v5-muted">
              Generating sample response…
            </p>
          )}
        </div>
        <form onSubmit={send} className="v5-chat-composer">
          <label className="v5-sr-only" htmlFor="sample-prompt">
            Prompt
          </label>
          <textarea
            id="sample-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask anything to try the sample response…"
            rows="3"
          />
          {error && (
            <p role="alert" className="v5-error-text">
              {error}
            </p>
          )}
          <div>
            <span className="v5-muted">Sample session</span>
            {running ? (
              <Button
                onClick={() => {
                  clearTimeout(timer.current);
                  setRunning(false);
                }}
              >
                Stop generation
              </Button>
            ) : (
              <Button type="submit" tone="primary" icon="arrow_upward">
                Send prompt
              </Button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
function Compare({ translator }) {
  const sample = JSON.stringify(
    {
      role: "tool",
      content:
        "Sample tool result with repeated whitespace and repository metadata.",
    },
    null,
    2,
  );
  const [source, setSource] = useState(sample);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [format, setFormat] = useState("Anthropic");
  const run = () => {
    try {
      const parsed = JSON.parse(source);
      setError("");
      setOutput(
        translator
          ? JSON.stringify(
              { preview: true, target: format, sample: parsed },
              null,
              2,
            )
          : JSON.stringify(parsed),
      );
    } catch {
      setError("The source is not valid JSON. Check the syntax and try again.");
    }
  };
  return (
    <>
      <Notice title="Illustrative comparison">
        This prototype previews the interaction. The real translator and
        compression engines are not called.
      </Notice>
      <div className="v5-dashboard-toolbar">
        <div className="v5-inline">
          <Badge>OpenAI source</Badge>
          {translator && (
            <select
              aria-label="Target protocol"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
            >
              <option>Anthropic</option>
              <option>OpenAI</option>
            </select>
          )}
        </div>
        <Button tone="primary" icon="play_arrow" onClick={run}>
          {translator ? "Translate sample" : "Run comparison"}
        </Button>
      </div>
      {error && <Notice tone="danger" title={error} />}
      <div className="v5-two-column">
        <Panel title={translator ? "Source request" : "Original tool result"}>
          <Field label="JSON input">
            {(props) => (
              <textarea
                {...props}
                className="v5-code-input"
                rows="14"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                spellCheck="false"
              />
            )}
          </Field>
        </Panel>
        <Panel
          title={translator ? "Target preview" : "Compressed preview"}
          action={output && <CopyButton value={output} />}
        >
          <pre className="v5-code v5-comparison-output">
            {output || "Run the sample to see the output here."}
          </pre>
          {output && !translator && (
            <Badge tone="success">
              {Math.max(
                0,
                Math.round((1 - output.length / source.length) * 100),
              )}
              % smaller · JSON whitespace only
            </Badge>
          )}
        </Panel>
      </div>
    </>
  );
}
function Setup({ page }) {
  const [step, setStep] = useState(0);
  const [client, setClient] = useState("Claude Code");
  const [applied, setApplied] = useState(false);
  const code = JSON.stringify(
    {
      client,
      baseURL: "http://localhost:20128/v1",
      apiKey: "SAMPLE_KEY_DO_NOT_USE",
    },
    null,
    2,
  );
  return (
    <div className="v5-setup">
      <ol className="v5-setup-steps">
        {["Choose client", "Review configuration", "Verify connection"].map(
          (label, index) => (
            <li key={label}>
              <button
                aria-current={step === index ? "step" : undefined}
                onClick={() => setStep(index)}
              >
                <span>{index + 1}</span>
                {label}
              </button>
            </li>
          ),
        )}
      </ol>
      <Panel
        title={
          [
            "Choose your client",
            "Review the proposed configuration",
            "Verify the sample setup",
          ][step]
        }
        description="Review-only workflow. No system files, certificates, or client settings are changed."
      >
        {step === 0 ? (
          <>
            <Field label={page.id === "mitm" ? "Local client" : "Client"}>
              {(props) => (
                <select
                  {...props}
                  value={client}
                  onChange={(event) => setClient(event.target.value)}
                >
                  <option>Claude Code</option>
                  <option>Cursor</option>
                  <option>Cline</option>
                </select>
              )}
            </Field>
            <Notice title="Prerequisites">
              Have a gateway endpoint and a client-specific access key ready
              before real setup.
            </Notice>
          </>
        ) : step === 1 ? (
          <>
            <pre className="v5-code">{code}</pre>
            <CopyButton value={code} label="Copy sample configuration" />
            {page.id === "mitm" && (
              <Notice
                tone="warning"
                title="Local interception requires explicit setup"
              >
                Review certificate trust and proxy settings separately before
                enabling live interception.
              </Notice>
            )}
          </>
        ) : (
          <>
            <div className="v5-checklist">
              <div>
                <Icon name="check_circle" />
                Endpoint configured
              </div>
              <div>
                <Icon name="check_circle" />
                Sample access key present
              </div>
              <div>
                <Icon name="check_circle" />
                Client configuration reviewed
              </div>
            </div>
            {applied && (
              <Notice tone="success" title="Sample setup complete">
                The local preview is configured. No real client files were
                changed.
              </Notice>
            )}
          </>
        )}
        <div className="v5-form-actions">
          <Button disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          <Button
            tone="primary"
            onClick={() => (step < 2 ? setStep(step + 1) : setApplied(true))}
          >
            {step < 2 ? "Continue" : "Complete sample setup"}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
function Endpoint({ onCreate, readOnly }) {
  const [protocol, setProtocol] = useState("OpenAI");
  const endpoint =
    protocol === "OpenAI"
      ? "http://localhost:20128/v1"
      : "http://localhost:20128";
  return (
    <>
      <Panel
        title="Gateway endpoint"
        description="Illustrative local endpoint. Check your actual configured port before use."
      >
        <div className="v5-tabs">
          {["OpenAI", "Anthropic"].map((label) => (
            <button
              key={label}
              aria-pressed={protocol === label}
              onClick={() => setProtocol(label)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="v5-endpoint">
          <code>{endpoint}</code>
          <CopyButton value={endpoint} label="Copy endpoint" />
        </div>
        <Notice title={`${protocol} protocol`}>
          {protocol === "OpenAI"
            ? "Chat completions and responses-compatible clients can use this endpoint."
            : "Anthropic Messages-compatible clients can use the gateway base URL."}
        </Notice>
      </Panel>
      <div className="v5-two-column">
        <Panel
          title="Client access"
          description="Use a separate key per client to identify usage."
        >
          <div className="v5-form-actions">
            <Button
              tone="primary"
              icon="add"
              disabled={readOnly}
              onClick={onCreate}
            >
              Create API key
            </Button>
          </div>
          <p className="v5-muted">
            Sample keys created here are inactive outside this prototype.
          </p>
        </Panel>
        <Panel title="Request example">
          <pre className="v5-code">
            {JSON.stringify(
              {
                model: "coding-fallback",
                messages: [{ role: "user", content: "Hello" }],
                stream: true,
              },
              null,
              2,
            )}
          </pre>
        </Panel>
      </div>
    </>
  );
}
function ConsoleLog() {
  const [filter, setFilter] = useState("all");
  const [paused, setPaused] = useState(false);
  const events = [
    {
      level: "info",
      time: "14:32:08",
      text: "Request req_8f2a completed · Anthropic · 842 ms",
    },
    {
      level: "warn",
      time: "14:31:41",
      text: "Google quota reached · trying configured fallback",
    },
    {
      level: "info",
      time: "14:31:30",
      text: "Fallback resolved · OpenAI · coding-fallback",
    },
    {
      level: "error",
      time: "14:31:12",
      text: "Provider timeout · request req_8f26 · 30,000 ms",
    },
    {
      level: "info",
      time: "14:30:58",
      text: "Responses request completed · OpenAI · 512 ms",
    },
  ];
  return (
    <Panel
      title="Gateway events"
      action={
        <Button
          icon={paused ? "play_arrow" : "pause"}
          onClick={() => setPaused(!paused)}
        >
          {paused ? "Resume view" : "Pause view"}
        </Button>
      }
    >
      <div className="v5-table-toolbar">
        <select
          aria-label="Log level"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <Badge tone={paused ? "warning" : "info"}>
          {paused ? "Paused" : "Sample events"}
        </Badge>
      </div>
      <div className="v5-console" role="log" aria-label="Gateway events">
        {events
          .filter((event) => filter === "all" || event.level === filter)
          .map((event) => (
            <div key={event.time}>
              <time>{event.time}</time>
              <Badge
                tone={
                  event.level === "error"
                    ? "danger"
                    : event.level === "warn"
                      ? "warning"
                      : "neutral"
                }
              >
                {event.level}
              </Badge>
              <code>{event.text}</code>
            </div>
          ))}
      </div>
    </Panel>
  );
}
function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  return (
    <div className="v5-login">
      <div>
        <Icon name="door_front" size={38} />
        <h1>Welcome to DurinDoor</h1>
        <p>One workspace for your AI gateway.</p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (password.length < 6) {
            setError("Use a sample password with at least 6 characters.");
            return;
          }
          setError("");
          setSuccess(true);
        }}
      >
        <Field
          label="Sample administrator password"
          error={error}
          hint="Use a sample password only. No authentication request is sent."
        >
          {(props) => (
            <input
              {...props}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Button type="submit" tone="primary" icon="arrow_forward">
          Sign in to preview
        </Button>
        {success && (
          <Notice tone="success" title="Sample sign-in complete">
            This is the signed-in state preview.
          </Notice>
        )}
      </form>
    </div>
  );
}
export default function PageContents({
  page,
  rows,
  readOnly,
  onInspect,
  onBulkChange,
  onCreate,
  onNotify,
  onNavigate,
  onDirtyChange,
}) {
  if (page.kind === "providers")
    return <Providers {...{ rows, readOnly, onInspect, onBulkChange }} />;
  if (page.kind === "resource" || page.kind === "keys" || page.kind === "logs")
    return (
      <Panel
        title={
          page.kind === "logs"
            ? "Requests"
            : page.kind === "keys"
              ? "Client keys"
              : {
                  combos: "Fallback routes",
                  "proxy-pools": "Outbound proxy pools",
                  "mcp-gateway": "Connected MCP servers",
                  "cli-tools": "Client configuration",
                  skills: "Installed skills",
                  pricing: "Model price overrides",
                  "media-routes": "Media aliases",
                  pxpipe: "Proxy instances",
                }[page.id] || "Configured connections"
        }
        description={
          page.kind === "keys"
            ? "Sample secrets are masked. Inspect a key to review its access."
            : undefined
        }
      >
        <DataTable
          {...{ rows, readOnly, onInspect, onBulkChange }}
          requestTable={page.kind === "logs"}
          valueLabel={
            page.id === "pricing"
              ? "Input / output per 1M"
              : page.kind === "keys"
                ? "Last used"
                : page.id === "combos"
                  ? "Models"
                  : page.id === "mcp-gateway"
                    ? "Tools"
                    : "Details"
          }
        />
      </Panel>
    );
  if (page.kind === "connection")
    return (
      <div className="v5-two-column">
        <Panel title="Connection configuration">
          <ConnectionForm
            inline
            initialState="tested"
            readOnly={readOnly}
            onDirtyChange={onDirtyChange}
            onSave={() => onNotify("Sample connection saved.")}
          />
        </Panel>
        <Panel
          title="Available models"
          description="Illustrative model inventory."
        >
          <div className="v5-health-list">
            {["claude-sonnet", "claude-opus", "claude-haiku"].map((name) => (
              <div key={name}>
                <strong>{name}</strong>
                <Badge>Available</Badge>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    );
  if (page.kind === "settings")
    return (
      <SettingsForm
        pageId={page.id}
        readOnly={readOnly}
        onNotify={onNotify}
        onDirtyChange={onDirtyChange}
      />
    );
  if (page.kind === "combo")
    return (
      <ComboEditor
        readOnly={readOnly}
        onNotify={onNotify}
        onDirtyChange={onDirtyChange}
      />
    );
  if (page.kind === "quota") return <Quota headroom={page.id === "headroom"} />;
  if (page.kind === "health") return <Health />;
  if (page.kind === "playground") return <Playground />;
  if (page.kind === "compare")
    return <Compare translator={page.id === "translator"} />;
  if (page.kind === "setup") return <Setup page={page} />;
  if (page.kind === "endpoint")
    return <Endpoint onCreate={onCreate} readOnly={readOnly} />;
  if (page.kind === "console") return <ConsoleLog />;
  if (page.kind === "request")
    return (
      <Panel title="Request inspection">
        <RequestDetails />
      </Panel>
    );
  if (page.kind === "login") return <Login />;
  if (page.kind === "saver")
    return (
      <>
        <div className="v5-summary-strip">
          {[
            ["Input tokens", "4.82M"],
            ["Saved tokens", "1.68M"],
            ["Reduction", "34.9%"],
            ["Eligible results", "2,406"],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>Illustrative</small>
            </div>
          ))}
        </div>
        <Panel
          title="Compression activity"
          action={
            <Button
              icon="tune"
              onClick={() => onNavigate("token-saver-settings")}
            >
              Saver settings
            </Button>
          }
        >
          <TrafficChart />
        </Panel>
        <Notice title="Compression preserves failed tool results">
          The current RTK implementation skips tool results marked as errors and
          fails open.
        </Notice>
      </>
    );
  return null;
}
