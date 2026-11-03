import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Notice,
  Switch,
} from "./components.jsx";
import DataTable from "./DataTable.jsx";
import { connections, requests } from "./catalog.js";
import { WIDGETS, moveWidget, updateWidget } from "./model.js";

const traffic = [
  28, 34, 22, 45, 38, 58, 47, 41, 67, 52, 71, 64, 43, 82, 73, 95, 79, 68, 87,
  72, 58, 82, 65, 51,
];
export function TrafficChart({ range = "24h" }) {
  const multiplier = range === "7d" ? 4 : range === "30d" ? 12 : 1;
  return (
    <div className="v5-chart">
      <div className="v5-chart-summary">
        <strong>
          {(18432 * multiplier).toLocaleString("en-US")} <small>requests</small>
        </strong>
        <Badge tone="success">+12.8% vs previous period</Badge>
      </div>
      <div className="v5-chart-plot">
        <div className="v5-chart-yaxis" aria-hidden="true">
          {[1000, 500, 0].map((value) => (
            <span key={value}>
              {(value * multiplier).toLocaleString("en-US")}
            </span>
          ))}
        </div>
        <svg
          viewBox="0 0 600 140"
          role="img"
          aria-label={`Sample request traffic for ${range}. Traffic peaks at ${950 * multiplier} requests.`}
          preserveAspectRatio="none"
        >
          {[10, 60, 110].map((y) => (
            <line
              key={y}
              x1="0"
              x2="600"
              y1={y}
              y2={y}
              className="v5-chart-grid"
            />
          ))}
          {traffic.map((value, index) => (
            <rect
              key={index}
              x={6 + index * 24.5}
              y={112 - value}
              width="15"
              height={value}
              rx="3"
              className="v5-chart-bar"
            >
              <title>
                {index}:00 · {value * 10 * multiplier} requests
              </title>
            </rect>
          ))}
        </svg>
      </div>
      <div className="v5-chart-xaxis" aria-hidden="true">
        {(range === "24h"
          ? ["00:00", "06:00", "12:00", "18:00", "23:59"]
          : range === "7d"
            ? ["Oct 2", "Oct 4", "Oct 6", "Oct 8"]
            : ["Sep 9", "Sep 19", "Sep 29", "Oct 8"]
        ).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
function Distribution() {
  return (
    <div className="v5-distribution">
      {[
        ["Anthropic", 48, "var(--v5-series-anthropic)"],
        ["OpenAI", 32, "var(--v5-series-openai)"],
        ["Google", 14, "var(--v5-series-google)"],
        ["Other", 6, "var(--v5-series-other)"],
      ].map(([name, percent, color]) => (
        <div key={name}>
          <div>
            <span className="v5-series-dot" style={{ background: color }} />
            {name}
            <strong>{percent}%</strong>
          </div>
          <meter
            min="0"
            max="100"
            value={percent}
            aria-label={`${name} request share`}
            style={{ "--series": color }}
          >
            {percent}%
          </meter>
        </div>
      ))}
    </div>
  );
}
function WidgetContent({ widget, range, onInspect }) {
  if (widget.type === "traffic") return <TrafficChart range={range} />;
  if (widget.type === "providers") return <Distribution />;
  if (widget.type === "requests")
    return (
      <DataTable rows={requests} requestTable compact onInspect={onInspect} />
    );
  if (widget.type === "budget")
    return (
      <div className="v5-budget">
        <div>
          <span>Estimated spend</span>
          <strong>
            $42.86 <small>/ $100.00</small>
          </strong>
        </div>
        <meter
          min="0"
          max="100"
          value="42.86"
          aria-label="Sample monthly budget used"
        >
          42.86%
        </meter>
        <div className="v5-key-value">
          <span>Budget remaining</span>
          <strong>$57.14</strong>
          <span>Projected this month</span>
          <strong>$68.40</strong>
        </div>
        <p className="v5-muted">
          Illustrative budget. Provider pricing may vary.
        </p>
      </div>
    );
  if (widget.type === "latency")
    return (
      <div className="v5-distribution">
        {connections.slice(0, 4).map((row) => (
          <div key={row.id}>
            <div>
              {row.name}
              <strong>{row.latency}</strong>
            </div>
            <meter
              min="0"
              max="1200"
              value={parseInt(row.latency)}
              aria-label={`${row.name} sample latency`}
            >
              {row.latency}
            </meter>
          </div>
        ))}
      </div>
    );
  return (
    <div className="v5-health-list">
      {connections.slice(0, 4).map((row) => (
        <div key={row.id}>
          <span>{row.name}</span>
          <Badge>{row.status}</Badge>
        </div>
      ))}
    </div>
  );
}
function Widget({
  widget,
  editing,
  index,
  visible,
  onMove,
  onEdit,
  onHide,
  range,
  onInspect,
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id, disabled: !editing });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`v5-widget ${widget.wide ? "v5-widget-wide" : ""} ${isDragging ? "v5-dragging" : ""}`}
      aria-label={widget.title}
    >
      <div className="v5-widget-heading">
        {editing && (
          <button
            {...attributes}
            {...listeners}
            className="v5-drag-handle"
            aria-label={`Drag ${widget.title}`}
          >
            <Icon name="drag_indicator" />
          </button>
        )}
        <h2>{widget.title}</h2>
        {!editing && widget.type === "traffic" && <Badge>Hourly</Badge>}
        {editing && (
          <div className="v5-widget-actions">
            <IconButton
              label={`Move ${widget.title} earlier`}
              icon="arrow_back"
              disabled={index === 0}
              onClick={() => onMove(widget.id, visible[index - 1].id)}
            />
            <IconButton
              label={`Move ${widget.title} later`}
              icon="arrow_forward"
              disabled={index === visible.length - 1}
              onClick={() => onMove(widget.id, visible[index + 1].id)}
            />
            <IconButton
              label={`Edit ${widget.title}`}
              icon="tune"
              onClick={() => onEdit(widget)}
            />
            <IconButton
              label={`Hide ${widget.title}`}
              icon="visibility_off"
              onClick={() => onHide(widget.id)}
            />
          </div>
        )}
      </div>
      <WidgetContent widget={widget} range={range} onInspect={onInspect} />
    </section>
  );
}
export default function Dashboard({
  onInspect,
  readOnly,
  initialEditing = false,
  initialCatalog = false,
  initialWidgets = WIDGETS,
  onNotify,
  onDirtyChange,
  onSaveLayout,
}) {
  const [saved, setSaved] = useState(initialWidgets);
  const [widgets, setWidgets] = useState(initialWidgets);
  const [editing, setEditing] = useState(initialEditing);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [config, setConfig] = useState(null);
  const [range, setRange] = useState("24h");
  const [discard, setDiscard] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      scrollBehavior: "auto",
    }),
  );
  const visible = widgets.filter((widget) => widget.visible);
  const dirty = JSON.stringify(saved) !== JSON.stringify(widgets);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const save = () => {
    setSaved(widgets);
    onSaveLayout?.(widgets);
    setEditing(false);
    setCatalog(false);
    onNotify("Dashboard layout saved for this preview session.");
  };
  const cancel = () => {
    if (dirty) setDiscard(true);
    else setEditing(false);
  };
  return (
    <>
      <div className="v5-dashboard-toolbar">
        <div className="v5-segmented" aria-label="Usage period">
          {[
            ["24h", "24 hours"],
            ["7d", "7 days"],
            ["30d", "30 days"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="v5-inline">
          <span className="v5-muted v5-update">
            <span className="v5-live-dot" />
            Sample data · Oct 8
          </span>
          {editing ? (
            <>
              <Button onClick={cancel}>Cancel</Button>
              <Button icon="add" onClick={() => setCatalog(true)}>
                Add widgets
              </Button>
              <Button tone="primary" icon="check" onClick={save}>
                Save layout
              </Button>
            </>
          ) : (
            <Button
              icon="dashboard_customize"
              disabled={readOnly}
              onClick={() => setEditing(true)}
            >
              Customize dashboard
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <Notice
          title="Make this dashboard yours"
          action={
            <Button onClick={() => setWidgets(WIDGETS)}>Reset layout</Button>
          }
        >
          Drag a handle or use the move buttons. Edit widget names and sizes, or
          choose which widgets to show.
        </Notice>
      )}
      <div className="v5-summary-strip">
        {[
          [
            "Requests",
            (
              18432 * (range === "7d" ? 4 : range === "30d" ? 12 : 1)
            ).toLocaleString("en-US"),
            "+12.8%",
          ],
          ["Success rate", "99.2%", "+0.4%"],
          ["Input / output tokens", "4.82M / 1.26M", "Sample"],
          ["Median latency", "684 ms", "−8.2%"],
        ].map(([label, value, delta]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{delta}</small>
          </div>
        ))}
      </div>
      {visible.length ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "Press Space to pick up a widget. Use arrow keys to move, Space to drop, or Escape to cancel. Move buttons are also available.",
            },
            announcements: {
              onDragStart: ({ active }) =>
                `Picked up ${widgets.find((widget) => widget.id === active.id)?.title}.`,
              onDragOver: ({ active, over }) =>
                over
                  ? `${widgets.find((widget) => widget.id === active.id)?.title} is over ${widgets.find((widget) => widget.id === over.id)?.title}.`
                  : undefined,
              onDragEnd: ({ active }) =>
                `Dropped ${widgets.find((widget) => widget.id === active.id)?.title}.`,
              onDragCancel: () => "Widget move canceled.",
            },
          }}
          onDragEnd={({ active, over }) => {
            if (over)
              setWidgets((current) => moveWidget(current, active.id, over.id));
          }}
        >
          <SortableContext
            items={visible.map((widget) => widget.id)}
            strategy={rectSortingStrategy}
          >
            <div className="v5-widget-grid">
              {visible.map((widget, index) => (
                <Widget
                  key={widget.id}
                  widget={widget}
                  editing={editing}
                  index={index}
                  visible={visible}
                  onMove={(id, target) =>
                    setWidgets((current) => moveWidget(current, id, target))
                  }
                  onEdit={setConfig}
                  onHide={(id) =>
                    setWidgets((current) =>
                      updateWidget(current, id, { visible: false }),
                    )
                  }
                  range={range}
                  onInspect={onInspect}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <EmptyState
          title="Your dashboard is a blank canvas"
          description="Add widgets to follow the traffic, spend, and connection health you care about."
          action={
            <Button
              tone="primary"
              onClick={() => {
                setEditing(true);
                setCatalog(true);
              }}
            >
              Add widgets
            </Button>
          }
        />
      )}
      {catalog && (
        <Dialog
          drawer
          title="Widget library"
          description="Choose what belongs on your dashboard. Changes stay in your draft until saved."
          onClose={() => setCatalog(false)}
          footer={
            <Button tone="primary" onClick={() => setCatalog(false)}>
              Done
            </Button>
          }
        >
          {widgets.map((widget) => (
            <Switch
              key={widget.id}
              label={widget.title}
              description={
                {
                  traffic: "Requests over time",
                  providers: "Share of traffic by provider",
                  requests: "Searchable recent activity",
                  budget: "Estimated monthly spend",
                  latency: "Response time by provider",
                  health: "Connection status",
                }[widget.type]
              }
              checked={widget.visible}
              onChange={(value) =>
                setWidgets((current) =>
                  updateWidget(current, widget.id, { visible: value }),
                )
              }
            />
          ))}
        </Dialog>
      )}
      {config && (
        <Dialog
          title="Edit widget"
          onClose={() => setConfig(null)}
          footer={
            <>
              <Button onClick={() => setConfig(null)}>Cancel</Button>
              <Button
                tone="primary"
                disabled={!config.title.trim()}
                onClick={() => {
                  setWidgets((current) =>
                    updateWidget(current, config.id, {
                      title: config.title.trim(),
                      wide: config.wide,
                    }),
                  );
                  setConfig(null);
                }}
              >
                Apply changes
              </Button>
            </>
          }
        >
          <Field label="Widget name">
            {(props) => (
              <input
                {...props}
                value={config.title}
                onChange={(event) =>
                  setConfig({ ...config, title: event.target.value })
                }
              />
            )}
          </Field>
          <Field
            label="Width"
            hint="Widgets stack to full width on narrow screens."
          >
            {(props) => (
              <select
                {...props}
                value={config.wide ? "wide" : "standard"}
                onChange={(event) =>
                  setConfig({ ...config, wide: event.target.value === "wide" })
                }
              >
                <option value="standard">One column</option>
                <option value="wide">Two columns</option>
              </select>
            )}
          </Field>
        </Dialog>
      )}
      {discard && (
        <Dialog
          title="Discard layout changes?"
          description="Your last saved layout will be restored."
          onClose={() => setDiscard(false)}
          footer={
            <>
              <Button onClick={() => setDiscard(false)}>Keep editing</Button>
              <Button
                tone="danger"
                onClick={() => {
                  setWidgets(saved);
                  setEditing(false);
                  setCatalog(false);
                  setDiscard(false);
                }}
              >
                Discard changes
              </Button>
            </>
          }
        />
      )}
    </>
  );
}
