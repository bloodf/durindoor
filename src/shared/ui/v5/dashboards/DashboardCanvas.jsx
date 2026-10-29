"use client";

import { useEffect, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Button from "@/shared/ui/components/Button.jsx";
import MotionIcon from "../motion/MotionIcon.jsx";

function DashboardIconButton({ icon, label, disabled, onClick }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="inline-flex size-11 shrink-0 items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus disabled:pointer-events-none disabled:opacity-50"><MotionIcon name={icon} /></button>;
}
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import { isBrowser } from "@/shared/utils/typeChecks.js";
import { normalizeDashboardLayout, moveDashboardWidget, updateDashboardWidget, readDashboardLayout } from "./model.js";
import "./dashboards.css";

const WIDTHS = [
  { value: 12, label: "Full width" },
  { value: 8, label: "Two thirds" },
  { value: 6, label: "Half width" },
  { value: 4, label: "One third" },
];

function UsageWidget({ widget, editing, index, visible, onMove, onEdit, onHide, children }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: widget.id, disabled: !editing });
  return <section ref={setNodeRef} className="v5-usage-widget" aria-label={widget.title} data-widget-id={widget.id} data-span={widget.span} data-editing={editing} data-dragging={isDragging || undefined} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <div className="v5-usage-widget-heading">
      {editing ? <button type="button" {...attributes} {...listeners} className="v5-usage-drag-handle" aria-label={`Drag ${widget.title}`}><MotionIcon name="drag_indicator" /></button> : null}
      <h2>{widget.title}</h2>
      {editing ? <div className="v5-usage-widget-controls">
        <DashboardIconButton icon="arrow_upward" label={`Move ${widget.title} earlier`} disabled={index === 0} onClick={() => onMove(widget.id, visible[index - 1].id)} />
        <DashboardIconButton icon="arrow_downward" label={`Move ${widget.title} later`} disabled={index === visible.length - 1} onClick={() => onMove(widget.id, visible[index + 1].id)} />
        <DashboardIconButton icon="edit" label={`Edit ${widget.title}`} onClick={() => onEdit(widget)} />
        <DashboardIconButton icon="visibility" label={`Hide ${widget.title}`} onClick={() => onHide(widget.id)} />
      </div> : null}
    </div>
    <div className="v5-usage-widget-content">{children}</div>
  </section>;
}

/** Draft preferences alter presentation only. Cancel restores saved order, names, widths and visibility. */
export default function DashboardCanvas({ sections, catalog, initialLayout, storageKey, persistLayout = false, onSave, initialSession, onSessionChange }) {
  const normalize = (value) => normalizeDashboardLayout(value, catalog);
  const [saved, setSaved] = useState(() => {
    if (initialSession?.saved) return normalize(initialSession.saved);
    if (initialLayout) return normalize(initialLayout);
    try { return persistLayout && isBrowser() ? readDashboardLayout(window.localStorage, storageKey, catalog) : normalize(null); }
    catch { return normalize(null); }
  });
  const [draft, setDraft] = useState(() => initialSession?.draft ? normalize(initialSession.draft) : saved);
  const [editing, setEditing] = useState(initialSession?.editing || false);
  const [library, setLibrary] = useState(false);
  const [widgetQuery, setWidgetQuery] = useState("");
  const [config, setConfig] = useState(null);
  const [notice, setNotice] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const layout = editing ? draft : saved;
  // The parent keeps each named dashboard's unfinished session until Save or Cancel.
  useEffect(() => { onSessionChange?.({ saved, draft, editing }); }, [saved, draft, editing, onSessionChange]);
  const visible = layout.filter((widget) => widget.visible);
  const groups = [
    { label: "Usage", icon: "bar_chart", matches: (widget) => widget.source?.startsWith("Usage") },
    { label: "Token Saver", icon: "savings", matches: (widget) => widget.source?.startsWith("Token Saver") || widget.source?.startsWith("PXPIPE") },
    { label: "Quota", icon: "dns", matches: (widget) => widget.source?.startsWith("Quota") },
    { label: "Monitoring", icon: "monitor_heart", matches: (widget) => widget.source?.startsWith("Monitoring") },
    { label: "Unavailable", icon: "layers", matches: (widget) => !widget.source },
  ];
  const update = (id, patch) => setDraft((current) => updateDashboardWidget(current, id, patch, catalog));
  const move = (id, targetId) => setDraft((current) => moveDashboardWidget(current, id, targetId));
  const save = () => {
    const next = normalize(draft);
    setSaved(next);
    setDraft(next);
    setEditing(false);
    setLibrary(false);
    setConfig(null);
    let message = "Dashboard layout saved for this review.";
    if (persistLayout) {
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)); }
      catch { message = "Layout saved for this view. Browser storage is unavailable."; }
    }
    onSave?.(next);
    setNotice(message);
  };
  const cancel = () => { setDraft(saved); setEditing(false); setLibrary(false); setConfig(null); setNotice("Layout changes discarded."); };
  return <div className="v5-usage-layout v5-dashboard-canvas" data-editing={editing}>
    <div className="v5-usage-toolbar">
      {editing ? <><details className="v5-dashboard-edit-help"><summary><MotionIcon name="tune" />Layout help</summary><p>Drag widgets or use their move buttons. Press Space on a drag handle, use arrow keys, then Space to drop. Edit names and widths, or choose widgets from the library. Save applies your layout; Cancel restores the saved layout.</p></details><div className="v5-dashboard-layout-actions" role="group" aria-label="Dashboard layout actions"><div className="v5-dashboard-layout-tools"><Button variant="secondary" onClick={() => setLibrary(true)}><MotionIcon name="add" />Add widgets</Button><Button variant="ghost" onClick={() => setDraft(normalize(null))}>Reset layout</Button></div><div className="v5-dashboard-layout-commit"><Button variant="secondary" onClick={cancel}>Cancel layout changes</Button><Button variant="primary" onClick={save}><MotionIcon name="save" />Save layout</Button></div></div></> : <Button variant="secondary" onClick={() => { setDraft(saved); setEditing(true); setNotice(""); }}><MotionIcon name="dashboard_customize" />Customize dashboard</Button>}
    </div>
    {notice ? <p role="status" className="v5-usage-layout-notice">{notice}</p> : null}
    {visible.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (over) move(active.id, over.id); }}>
      <SortableContext items={visible.map((widget) => widget.id)} strategy={rectSortingStrategy}>
        <div className="v5-usage-grid">{visible.map((widget, index) => <UsageWidget key={widget.id} {...{ widget, index, visible, editing, onMove: move, onEdit: setConfig }} onHide={(id) => update(id, { visible: false })}>{sections[widget.id] ?? <p role="status">This widget source is unavailable. Choose a replacement from the widget library.</p>}</UsageWidget>)}</div>
      </SortableContext>
    </DndContext> : <div className="v5-usage-empty"><p>No dashboard widgets are visible. Choose widgets to begin.</p><Button onClick={() => { setEditing(true); setLibrary(true); }}>Choose widgets</Button></div>}
    <Modal open={library} onClose={() => setLibrary(false)} title="Widget library" footer={<Button onClick={() => setLibrary(false)}>Done</Button>}>
      <div className="v5-usage-widget-library"><Input label="Find widgets" type="search" value={widgetQuery} onChange={(event) => setWidgetQuery(event.target.value)} placeholder="Search widgets" />{groups.map((group) => { const widgets = draft.filter((widget) => group.matches(widget) && widget.title.toLowerCase().includes(widgetQuery.trim().toLowerCase())); return widgets.length ? <fieldset key={group.label} className="v5-dashboard-library-group"><legend><MotionIcon name={group.icon} /><span>{group.label}</span><span className="v5-dashboard-library-count">{widgets.length}</span></legend>{widgets.map((widget) => <Toggle key={widget.id} label={widget.title} title={widget.source} checked={widget.visible} onChange={(value) => update(widget.id, { visible: value })} />)}</fieldset> : null; })}{!draft.some((widget) => widget.title.toLowerCase().includes(widgetQuery.trim().toLowerCase())) ? <p role="status">No widgets match your search.</p> : null}</div>
    </Modal>
    <Modal open={Boolean(config)} onClose={() => setConfig(null)} title="Edit widget" footer={<><Button variant="secondary" onClick={() => setConfig(null)}>Cancel</Button><Button disabled={!config?.title.trim()} onClick={() => { update(config.id, config); setConfig(null); }}>Apply changes</Button></>}>
      {config ? <div className="v5-usage-widget-editor"><Input label="Widget name" value={config.title} maxLength={80} onChange={(event) => setConfig({ ...config, title: event.target.value })} /><Select aria-label="Widget width" value={config.span} options={WIDTHS} onChange={(span) => setConfig({ ...config, span })} /></div> : null}
    </Modal>
  </div>;
}
