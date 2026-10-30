"use client";

import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import { isBrowser } from "@/shared/utils/typeChecks.js";
import { USAGE_LAYOUT_KEY, USAGE_WIDGETS, moveUsageWidget, normalizeUsageLayout, readUsageLayout, updateUsageWidget } from "./layout.js";

const WIDTHS = [
  { value: 12, label: "Full width" },
  { value: 8, label: "Two thirds" },
  { value: 6, label: "Half width" },
  { value: 4, label: "One third" },
];

function UsageWidget({ widget, editing, index, visible, onMove, onEdit, onHide, children }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: widget.id, disabled: !editing });
  // These cards already label themselves. Keep a separate heading for renamed
  // widgets and while editing, when it anchors the layout controls.
  const cardHasTitle = widget.id === "combos" || widget.id === "keys";
  const renamed = widget.title !== USAGE_WIDGETS.find((item) => item.id === widget.id)?.title;
  return <section ref={setNodeRef} className="v5-usage-widget" aria-label={widget.title} data-widget-id={widget.id} data-span={widget.span} data-editing={editing} data-dragging={isDragging || undefined} style={{ transform: CSS.Transform.toString(transform), transition }}>
    {editing || !cardHasTitle || renamed ? <div className="v5-usage-widget-heading">
      {editing ? <button type="button" {...attributes} {...listeners} className="v5-usage-drag-handle" aria-label={`Drag ${widget.title}`}><span aria-hidden="true" className="material-symbols-outlined">drag_indicator</span></button> : null}
      <h2>{widget.title}</h2>
      {editing ? <div className="v5-usage-widget-controls">
        <IconButton icon="arrow_back" label={`Move ${widget.title} earlier`} disabled={index === 0} onClick={() => onMove(widget.id, visible[index - 1].id)} />
        <IconButton icon="arrow_forward" label={`Move ${widget.title} later`} disabled={index === visible.length - 1} onClick={() => onMove(widget.id, visible[index + 1].id)} />
        <IconButton icon="edit" label={`Edit ${widget.title}`} onClick={() => onEdit(widget)} />
        <IconButton icon="visibility_off" label={`Hide ${widget.title}`} onClick={() => onHide(widget.id)} />
      </div> : null}
    </div> : <h2 className="sr-only">{widget.title}</h2>}
    <div className="v5-usage-widget-content">{children}</div>
  </section>;
}

/** Draft preferences alter presentation only. Cancel restores saved order, names, widths and visibility. */
export default function UsageWidgetLayout({ sections, initialLayout, persistLayout = true }) {
  const [saved, setSaved] = useState(() => {
    if (initialLayout) return normalizeUsageLayout(initialLayout);
    try { return persistLayout && isBrowser() ? readUsageLayout(window.localStorage) : normalizeUsageLayout(null); }
    catch { return normalizeUsageLayout(null); }
  });
  const [draft, setDraft] = useState(saved);
  const [editing, setEditing] = useState(false);
  const [library, setLibrary] = useState(false);
  const [config, setConfig] = useState(null);
  const [notice, setNotice] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const layout = editing ? draft : saved;
  const visible = layout.filter((widget) => widget.visible);
  const update = (id, patch) => setDraft((current) => updateUsageWidget(current, id, patch));
  const move = (id, targetId) => setDraft((current) => moveUsageWidget(current, id, targetId));
  const save = () => {
    const next = normalizeUsageLayout(draft);
    setSaved(next);
    setDraft(next);
    setEditing(false);
    setLibrary(false);
    setConfig(null);
    let message = "Dashboard layout saved for this review.";
    if (persistLayout) {
      try { window.localStorage.setItem(USAGE_LAYOUT_KEY, JSON.stringify(next)); }
      catch { message = "Layout saved for this view. Browser storage is unavailable."; }
    }
    setNotice(message);
  };
  const cancel = () => { setDraft(saved); setEditing(false); setLibrary(false); setConfig(null); setNotice("Layout changes discarded."); };
  return <div className="v5-usage-layout" data-editing={editing}>
    <div className="v5-usage-toolbar">
      {editing ? <><p>Move, rename, resize, or hide any usage section.</p><Button variant="secondary" onClick={() => setLibrary(true)} icon="add">Add widgets</Button><Button variant="ghost" onClick={() => setDraft(normalizeUsageLayout(null))}>Reset layout</Button><Button variant="secondary" onClick={cancel}>Cancel layout changes</Button><Button variant="primary" icon="check" onClick={save}>Save layout</Button></> : <Button variant="secondary" icon="dashboard_customize" onClick={() => { setDraft(saved); setEditing(true); setNotice(""); }}>Customize dashboard</Button>}
    </div>
    {notice ? <p role="status" className="v5-usage-layout-notice">{notice}</p> : null}
    {visible.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (over) move(active.id, over.id); }}>
      <SortableContext items={visible.map((widget) => widget.id)} strategy={rectSortingStrategy}>
        <div className="v5-usage-grid">{visible.map((widget, index) => <UsageWidget key={widget.id} {...{ widget, index, visible, editing, onMove: move, onEdit: setConfig }} onHide={(id) => update(id, { visible: false })}>{sections[widget.id]}</UsageWidget>)}</div>
      </SortableContext>
    </DndContext> : <div className="v5-usage-empty"><p>No usage widgets are visible.</p><Button onClick={() => { setEditing(true); setLibrary(true); }}>Choose widgets</Button></div>}
    <Modal open={library} onClose={() => setLibrary(false)} title="Usage widget library" footer={<Button onClick={() => setLibrary(false)}>Done</Button>}>
      <div className="v5-usage-widget-library">{draft.map((widget) => <Toggle key={widget.id} label={widget.title} checked={widget.visible} onChange={(value) => update(widget.id, { visible: value })} />)}</div>
    </Modal>
    <Modal open={Boolean(config)} onClose={() => setConfig(null)} title="Edit usage widget" footer={<><Button variant="secondary" onClick={() => setConfig(null)}>Cancel</Button><Button disabled={!config?.title.trim()} onClick={() => { update(config.id, config); setConfig(null); }}>Apply changes</Button></>}>
      {config ? <div className="v5-usage-widget-editor"><Input label="Widget name" value={config.title} maxLength={80} onChange={(event) => setConfig({ ...config, title: event.target.value })} /><Select aria-label="Widget width" value={config.span} options={WIDTHS} onChange={(span) => setConfig({ ...config, span })} /></div> : null}
    </Modal>
  </div>;
}
