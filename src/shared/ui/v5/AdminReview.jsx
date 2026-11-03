import { useEffect, useState } from "react";
import { useTheme } from "@/shared/hooks/useTheme.js";
import useThemeStore from "@/store/themeStore.js";
import {
  Badge,
  Button,
  CopyButton,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  Notice,
  Skeleton,
} from "./components.jsx";
import Dashboard from "./Dashboard.jsx";
import { ConnectionForm, ResourceEditor } from "./Forms.jsx";
import PageContents, {
  RequestDetails,
  ResourceDetails,
} from "./PageContents.jsx";
import { PAGES, pageById, requests } from "./catalog.js";
import { PAGE_STATES } from "./model.js";
import "./v5.css";

function Navigation({ current, onNavigate, collapsed, onCollapse }) {
  const [groups, setGroups] = useState([
    "Workspace",
    "Routing",
    "Observability",
    current.group,
  ]);
  const [closed, setClosed] = useState([]);
  const isExpanded = (group) =>
    !closed.includes(group) &&
    (groups.includes(group) || current.group === group);
  return (
    <>
      <div className="v5-brand">
        <svg viewBox="0 0 28 30" role="img" aria-label="DurinDoor">
          <path
            d="M3 27V10L14 3l11 7v17h-7V14l-4-3-4 3v13Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <path d="M14 11v17" stroke="currentColor" strokeWidth="2" />
        </svg>
        {!collapsed && (
          <span>
            DurinDoor <small>v5 preview</small>
          </span>
        )}
      </div>
      <nav aria-label="Admin navigation">
        {[
          ...new Set(
            PAGES.filter((page) => !page.parent && page.id !== "login").map(
              (page) => page.group,
            ),
          ),
        ].map((group) => (
          <section key={group}>
            {!collapsed && (
              <button
                className="v5-nav-group"
                aria-expanded={isExpanded(group)}
                onClick={() => {
                  if (isExpanded(group)) setClosed([...closed, group]);
                  else {
                    setClosed(closed.filter((item) => item !== group));
                    setGroups([...new Set([...groups, group])]);
                  }
                }}
              >
                {group}
                <Icon name="expand_more" size={15} />
              </button>
            )}
            {(collapsed || isExpanded(group)) &&
              PAGES.filter(
                (page) =>
                  page.group === group && !page.parent && page.id !== "login",
              ).map((page) => (
                <button
                  key={page.id}
                  className="v5-nav-item"
                  aria-current={
                    (current.parent || current.id) === page.id
                      ? "page"
                      : undefined
                  }
                  onClick={() => onNavigate(page.id)}
                  title={collapsed ? page.title : undefined}
                >
                  <Icon name={page.icon} />
                  {!collapsed && <span>{page.title}</span>}
                  {!collapsed && page.id === "providers" && (
                    <span className="v5-nav-count">5</span>
                  )}
                </button>
              ))}
          </section>
        ))}
      </nav>
      <div className="v5-sidebar-bottom">
        <button className="v5-nav-item" onClick={() => onNavigate("profile")}>
          <span className="v5-avatar">A</span>
          {!collapsed && (
            <span>
              Administrator<small>Review workspace</small>
            </span>
          )}
        </button>
        <button
          className="v5-nav-item"
          onClick={onCollapse}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          <Icon name={collapsed ? "left_panel_open" : "left_panel_close"} />
          {!collapsed && "Collapse navigation"}
        </button>
      </div>
    </>
  );
}
function CommandMenu({ onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const results = PAGES.filter((page) =>
    `${page.title} ${page.group} ${page.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <Dialog
      title="Go to a page"
      description="Search pages, tools, and workspace settings."
      onClose={onClose}
    >
      <label className="v5-search-field v5-command-search">
        <Icon name="search" />
        <input
          autoFocus
          aria-label="Search commands"
          placeholder="Search pages and tools…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="v5-command-results">
        {results.length ? (
          results.map((page) => (
            <button
              key={page.id}
              onClick={() => {
                onNavigate(page.id);
                onClose();
              }}
            >
              <Icon name={page.icon} />
              <span>
                {page.title}
                <small>{page.group}</small>
              </span>
              <Icon name="arrow_forward" />
            </button>
          ))
        ) : (
          <EmptyState
            icon="search_off"
            title="No matching pages"
            description="Try a tool name such as providers, quota, or settings."
          />
        )}
      </div>
    </Dialog>
  );
}
function exportSample(rows) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const columns = ["id", "name", "status", "value", "latency"];
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((key) => quote(row[key])).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "durindoor-v5-sample.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReviewWorkspace({
  initialPage,
  initialState,
  initialEditing,
  initialCatalog,
  initialWidgets,
  initialOverlay,
  theme: forcedTheme,
  compactNavigation,
}) {
  const [pageId, setPageId] = useState(initialPage);
  const [state, setState] = useState(initialState);
  const [collapsed, setCollapsed] = useState(compactNavigation);
  const [mobileNav, setMobileNav] = useState(false);
  const [command, setCommand] = useState(initialOverlay === "command");
  const [notifications, setNotifications] = useState(
    initialOverlay === "notifications",
  );
  const [reviewStates, setReviewStates] = useState(false);
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [workspace, setWorkspace] = useState("Personal workspace");
  const [unread, setUnread] = useState(true);
  const [inspect, setInspect] = useState(
    initialOverlay === "request" ? requests[0] : null,
  );
  const [create, setCreate] = useState(
    initialOverlay === "connection" || initialOverlay === "create",
  );
  const [editingRow, setEditingRow] = useState(null);
  const [toast, setToast] = useState("");
  const [inventory, setInventory] = useState({});
  const [layouts, setLayouts] = useState({});
  const [undo, setUndo] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [dirtyForm, setDirtyForm] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [sampleKey, setSampleKey] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [modalDirty, setModalDirty] = useState(false);
  const [connectionPending, setConnectionPending] = useState(false);
  const [discardModal, setDiscardModal] = useState(false);
  const { theme } = useTheme();
  const page = pageById(pageId);
  const rows = inventory[pageId] || page.rows || [];
  const readOnly = state === "readonly";
  const canCreate = ["resource", "providers", "keys", "endpoint"].includes(
    page.kind,
  );
  const isRequests =
    page.kind === "logs" ||
    page.kind === "dashboard" ||
    page.kind === "request";
  const finishNavigation = (id) => {
    setPageId(id);
    setState("ready");
    setMobileNav(false);
    setInspect(null);
    setCreate(false);
    setEditingRow(null);
    setToast("");
    setUndo(null);
    setDirtyForm(false);
    setPendingNavigation(null);
  };
  const navigate = (id) => {
    if (dirtyForm && id !== pageId) setPendingNavigation(id);
    else finishNavigation(id);
  };
  useEffect(() => {
    const keydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommand((value) => !value);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const closeEditor = () => {
    setCreate(false);
    setEditingRow(null);
    setModalDirty(false);
    setConnectionPending(false);
    setDiscardModal(false);
  };
  const requestCloseEditor = () => {
    if (modalDirty) setDiscardModal(true);
    else closeEditor();
  };
  const saveResource = (row) => {
    setInventory({
      ...inventory,
      [pageId]: rows.some((item) => item.id === row.id)
        ? rows.map((item) => (item.id === row.id ? row : item))
        : [...rows, row],
    });
    setCreate(false);
    setEditingRow(null);
    setModalDirty(false);
    setConnectionPending(false);
    setToast(`${row.name} saved in this preview.`);
    if (
      !rows.some((item) => item.id === row.id) &&
      (page.kind === "keys" || page.id === "endpoint")
    )
      setSampleKey("dd_preview_SAMPLE_ONLY_8f2a0000");
  };
  const bulkChange = (ids) => {
    setUndo({ pageId, rows });
    setInventory({
      ...inventory,
      [pageId]: rows.map((row) =>
        ids.includes(row.id) ? { ...row, status: "Disabled" } : row,
      ),
    });
    setToast(`${ids.length} sample items disabled.`);
  };
  const recover = () => {
    setState("ready");
    setToast("Sample data loaded. This recovery is simulated.");
  };
  const dark = (forcedTheme || theme) === "dark";
  return (
    <div
      className={`v5-root ${collapsed ? "v5-collapsed" : ""}`}
      data-theme={dark ? "dark" : "light"}
    >
      <a className="v5-skip" href="#v5-main">
        Skip to workspace
      </a>
      <aside className="v5-sidebar">
        <Navigation
          current={page}
          onNavigate={navigate}
          collapsed={collapsed}
          onCollapse={() => setCollapsed(!collapsed)}
        />
      </aside>
      <div className="v5-workspace">
        <header className="v5-topbar">
          <div className="v5-inline">
            <IconButton
              label="Open navigation"
              icon="menu"
              className="v5-mobile-menu"
              onClick={() => setMobileNav(true)}
            />
            <Button
              icon="workspaces"
              className="v5-workspace-picker"
              onClick={() => setWorkspaceMenu(true)}
            >
              {workspace}
              <Icon name="expand_more" size={14} />
            </Button>
            <span className="v5-top-divider" />
            <span className="v5-breadcrumb">
              {page.group} <Icon name="chevron_right" size={16} />{" "}
              <strong>{page.title}</strong>
            </span>
          </div>
          <div className="v5-inline">
            <Button
              icon="search"
              className="v5-command-trigger"
              aria-label="Search workspace"
              onClick={() => setCommand(true)}
            >
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </Button>
            <IconButton
              label={`Switch to ${dark ? "light" : "dark"} theme`}
              icon={dark ? "light_mode" : "dark_mode"}
              onClick={() =>
                useThemeStore.getState().setTheme(dark ? "light" : "dark")
              }
            />
            <IconButton
              label="Notifications"
              icon={unread ? "notifications_active" : "notifications"}
              onClick={() => setNotifications(true)}
            />
            <button
              className="v5-avatar"
              aria-label="Open administrator profile"
              onClick={() => navigate("profile")}
            >
              A
            </button>
          </div>
        </header>
        <main id="v5-main" className="v5-main" tabIndex={-1}>
          <div className="v5-page-heading">
            <div>
              {page.parent && (
                <Button
                  icon="arrow_back"
                  className="v5-back"
                  onClick={() => navigate(page.parent)}
                >
                  {pageById(page.parent).title}
                </Button>
              )}
              <h1>{page.title}</h1>
              <p>{page.description}</p>
            </div>
            <div className="v5-inline v5-page-actions">
              {page.kind === "dashboard" && (
                <Button
                  icon="download"
                  onClick={() => {
                    exportSample(requests);
                    setToast("Sample report exported.");
                  }}
                >
                  Export report
                </Button>
              )}
              {canCreate && state !== "forbidden" && (
                <Button
                  tone="primary"
                  icon="add"
                  disabled={
                    readOnly || state === "loading" || state === "offline"
                  }
                  onClick={() => setCreate(true)}
                >
                  {page.action}
                </Button>
              )}
              {page.kind === "logs" && (
                <Button
                  icon="download"
                  onClick={() => {
                    exportSample(rows);
                    setToast("Sample requests exported.");
                  }}
                >
                  Export requests
                </Button>
              )}
              {page.id === "settings" && (
                <>
                  <Button onClick={() => navigate("database")}>Database</Button>
                  <Button onClick={() => navigate("pricing")}>
                    Model pricing
                  </Button>
                </>
              )}
              {page.id === "mcp-gateway" && (
                <Button icon="key" onClick={() => navigate("mcp-keys")}>
                  Access keys
                </Button>
              )}
              <IconButton
                label="Review page states"
                icon="fact_check"
                onClick={() => setReviewStates(true)}
              />
            </div>
          </div>
          {state === "offline" && (
            <Notice
              tone="warning"
              title="Gateway connection lost"
              action={
                <Button onClick={recover} icon="refresh">
                  Reconnect
                </Button>
              }
            >
              This view shows cached sample data. Editing is unavailable until
              the gateway reconnects.
            </Notice>
          )}
          {state === "degraded" && (
            <Notice
              tone="warning"
              title="Some data is unavailable"
              action={<Button onClick={recover}>Retry failed checks</Button>}
            >
              Google is rate limited. Other connected providers remain available
              in this sample.
            </Notice>
          )}
          {state === "readonly" && (
            <Notice title="Read-only workspace">
              You can inspect data. An administrator can grant permission to
              change configuration.
            </Notice>
          )}
          {state === "success" && (
            <Notice tone="success" title="Changes saved">
              Your sample workspace configuration is up to date.
            </Notice>
          )}
          {state === "loading" ? (
            <Skeleton />
          ) : state === "error" ? (
            <EmptyState
              icon="cloud_off"
              title={`Couldn't load ${page.title.toLowerCase()}`}
              description="The gateway did not respond. Check its connection and try again. Your configuration is still available."
              action={
                <Button tone="primary" icon="refresh" onClick={recover}>
                  Try again
                </Button>
              }
            />
          ) : state === "forbidden" ? (
            <EmptyState
              icon="lock"
              title="You don't have access to this page"
              description="Ask your workspace administrator to review your access permissions."
              action={
                <Button onClick={() => navigate("overview")}>
                  Back to overview
                </Button>
              }
            />
          ) : state === "empty" ? (
            <EmptyState
              icon={page.icon}
              title={
                page.kind === "dashboard" || page.kind === "logs"
                  ? "Your first request starts the story"
                  : `No ${page.title.toLowerCase()} yet`
              }
              description={
                page.kind === "dashboard" || page.kind === "logs"
                  ? "Connect a provider and send a request through your gateway. Your activity will appear here."
                  : "Set up this part of your workspace to start using it. You can explore sample data before configuring anything."
              }
              action={
                <div className="v5-inline">
                  <Button
                    tone="primary"
                    onClick={() =>
                      canCreate ? setCreate(true) : navigate("providers")
                    }
                  >
                    {canCreate ? page.action : "Connect a provider"}
                  </Button>
                  <Button onClick={recover}>Explore sample data</Button>
                </div>
              }
            />
          ) : page.kind === "dashboard" ? (
            <Dashboard
              key={`${pageId}-${attempt}`}
              onInspect={setInspect}
              readOnly={readOnly || state === "offline"}
              initialEditing={initialEditing}
              initialCatalog={initialCatalog}
              initialWidgets={layouts[pageId] || initialWidgets}
              onSaveLayout={(widgets) =>
                setLayouts((current) => ({ ...current, [pageId]: widgets }))
              }
              onDirtyChange={setDirtyForm}
              onNotify={setToast}
            />
          ) : (
            <PageContents
              key={`${pageId}-${attempt}`}
              page={page}
              rows={rows}
              readOnly={readOnly || state === "offline"}
              onInspect={setInspect}
              onBulkChange={page.kind === "logs" ? undefined : bulkChange}
              onCreate={() => setCreate(true)}
              onDirtyChange={setDirtyForm}
              onNotify={setToast}
              onNavigate={navigate}
            />
          )}
          <footer className="v5-review-footer">
            <span>
              <Icon name="science" size={15} /> v5 design review · Sample data
              only
            </span>
            <Button
              onClick={() => {
                setAttempt(attempt + 1);
                setInventory({});
                setLayouts({});
                setState(initialState);
                setToast("");
                setUndo(null);
                setDirtyForm(false);
              }}
            >
              Reset preview
            </Button>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="v5-toast" role="status">
          <Icon name="check_circle" />
          <span>{toast}</span>
          {undo && (
            <Button
              onClick={() => {
                setInventory({ ...inventory, [undo.pageId]: undo.rows });
                setUndo(null);
                setToast("Sample change undone.");
              }}
            >
              Undo
            </Button>
          )}
          <IconButton
            label="Dismiss notification"
            icon="close"
            onClick={() => setToast("")}
          />
        </div>
      )}
      {mobileNav && (
        <Dialog drawer title="Navigation" onClose={() => setMobileNav(false)}>
          <Navigation
            current={page}
            onNavigate={navigate}
            collapsed={false}
            onCollapse={() => setMobileNav(false)}
          />
        </Dialog>
      )}
      {command && (
        <CommandMenu onClose={() => setCommand(false)} onNavigate={navigate} />
      )}
      {workspaceMenu && (
        <Dialog
          title="Switch workspace"
          description="Two sample workspaces for reviewing navigation."
          onClose={() => setWorkspaceMenu(false)}
        >
          {["Personal workspace", "Development workspace"].map((label) => (
            <Button
              key={label}
              icon="workspaces"
              onClick={() => {
                setWorkspace(label);
                setWorkspaceMenu(false);
              }}
            >
              {label}
              {workspace === label && <Icon name="check" />}
            </Button>
          ))}
        </Dialog>
      )}
      {reviewStates && (
        <Dialog
          title="Review page states"
          description="Each scenario is also a named Storybook story."
          onClose={() => setReviewStates(false)}
        >
          <div className="v5-state-picker">
            {PAGE_STATES.map((value) => (
              <Button
                key={value}
                icon={value === state ? "check_circle" : "circle"}
                onClick={() => {
                  setState(value);
                  setReviewStates(false);
                }}
              >
                {value === "readonly" ? "Read only" : value}
              </Button>
            ))}
          </div>
        </Dialog>
      )}
      {notifications && (
        <Dialog
          drawer
          title="Notifications"
          description="Sample workspace activity."
          onClose={() => setNotifications(false)}
          footer={
            <Button
              onClick={() => {
                setUnread(false);
                setNotifications(false);
              }}
            >
              Mark all as read
            </Button>
          }
        >
          <Notice tone="warning" title="Google quota needs attention">
            One sample connection is close to its limit.
          </Notice>
          <Notice title="Codex authorization expires soon">
            Review the connection before its next scheduled use.
          </Notice>
          <Button
            icon="arrow_forward"
            onClick={() => {
              navigate("quota");
              setNotifications(false);
            }}
          >
            Open quota tracker
          </Button>
        </Dialog>
      )}
      {inspect && (
        <Dialog
          drawer
          title={isRequests ? "Request details" : inspect.name}
          description={
            isRequests
              ? "Follow the lifecycle and inspect a sanitized payload."
              : "Inspect this sample workspace item."
          }
          onClose={() => setInspect(null)}
        >
          {isRequests ? (
            <RequestDetails row={inspect} />
          ) : (
            <ResourceDetails
              row={inspect}
              readOnly={readOnly || state === "offline"}
              onRevoke={
                page.kind === "keys" ? () => setRevoking(inspect) : undefined
              }
              onOpen={
                page.id === "providers"
                  ? () => navigate("provider-detail")
                  : page.id === "combos"
                    ? () => navigate("combo-detail")
                    : page.id === "cli-tools"
                      ? () => navigate("cli-detail")
                      : page.group === "Media"
                        ? () => navigate("media-detail")
                        : undefined
              }
              onEdit={() => {
                setEditingRow(inspect);
                setInspect(null);
              }}
            />
          )}
        </Dialog>
      )}
      {create && page.kind === "providers" && (
        <Dialog
          drawer
          title="Connect a provider"
          description="Add a sample account to your workspace."
          onClose={requestCloseEditor}
          pending={connectionPending}
        >
          <ConnectionForm
            onCancel={requestCloseEditor}
            onDirtyChange={setModalDirty}
            onPendingChange={setConnectionPending}
            onSave={(values) =>
              saveResource({
                id: `sample-${values.name}`,
                name: values.name,
                detail: values.provider,
                status: "Connected",
                value: "Sample models",
                time: "Just now",
              })
            }
          />
        </Dialog>
      )}
      {((create && page.kind !== "providers") || editingRow) && (
        <ResourceEditor
          page={page}
          row={editingRow}
          onClose={requestCloseEditor}
          onDirtyChange={setModalDirty}
          onSave={saveResource}
        />
      )}
      {discardModal && (
        <Dialog
          title="Discard form changes?"
          description="The sample form values will be cleared."
          onClose={() => setDiscardModal(false)}
          footer={
            <>
              <Button onClick={() => setDiscardModal(false)}>
                Keep editing
              </Button>
              <Button tone="danger" onClick={closeEditor}>
                Discard changes
              </Button>
            </>
          }
        />
      )}
      {pendingNavigation && (
        <Dialog
          title="Leave without saving?"
          description="Your unsaved changes will be discarded."
          onClose={() => setPendingNavigation(null)}
          footer={
            <>
              <Button onClick={() => setPendingNavigation(null)}>
                Keep editing
              </Button>
              <Button
                tone="danger"
                onClick={() => finishNavigation(pendingNavigation)}
              >
                Discard and leave
              </Button>
            </>
          }
        />
      )}
      {sampleKey && (
        <Dialog
          title="Sample key created"
          description="This is the one-time key reveal preview. This key cannot authenticate to any gateway."
          onClose={() => setSampleKey(null)}
          footer={
            <Button tone="primary" onClick={() => setSampleKey(null)}>
              I have copied the sample key
            </Button>
          }
        >
          <pre className="v5-code">{sampleKey}</pre>
          <CopyButton value={sampleKey} label="Copy sample key" />
        </Dialog>
      )}
      {revoking && (
        <Dialog
          title="Revoke this sample key?"
          description={`Clients using ${revoking.name} would lose access. This preview changes only sample data.`}
          onClose={() => setRevoking(null)}
          footer={
            <>
              <Button onClick={() => setRevoking(null)}>Cancel</Button>
              <Button
                tone="danger"
                onClick={() => {
                  bulkChange([revoking.id]);
                  setRevoking(null);
                  setInspect(null);
                }}
              >
                Revoke sample key
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
/** Remount when Storybook controls change to keep each scenario deterministic. */
export default function AdminReview({
  page = "usage",
  state = "ready",
  ...props
}) {
  return (
    <ReviewWorkspace
      key={`${page}-${state}`}
      initialPage={page}
      initialState={state}
      {...props}
    />
  );
}
