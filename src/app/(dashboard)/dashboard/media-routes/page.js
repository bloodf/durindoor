"use client";

import { useEffect, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { Card, CardHeader } from "@/shared/ui/components/Card.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import { CardSkeleton } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const ROUTE_NOTES = {
  embedding: "Only the first available model runs. Embeddings never switch models, because vectors from different models are not comparable.",
  video: "/v1/video/generations tries the models it can run in order. /v1/videos creates a billable job, so it uses only the first model whose provider supports async jobs.",
  stt: "/v1/audio/translations uses only the models whose provider has a translations endpoint."
};

const providersPageFor = (kind) => (kind === "webSearch" || kind === "webFetch"
  ? "/dashboard/media-providers/web"
  : `/dashboard/media-providers/${kind}`);

function RouteRow({ uid, index, model, name, unavailable, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: uid });
  const style = { transform: CSS.Transform.toString(transform), opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 999 : undefined };
  return (
    <li ref={setNodeRef} style={style} className="flex min-w-0 items-center gap-2 rounded-dd bg-dd-surface-2 px-2 py-1">
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`${translate("Drag to reorder")} ${model}`}
        className="flex min-h-11 min-w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-dd text-dd-muted outline-none hover:text-dd-accent focus-visible:shadow-dd-focus active:cursor-grabbing"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">drag_indicator</span>
      </button>
      <span className="w-4 shrink-0 text-center text-[11px] text-dd-muted dd-tnum">{index + 1}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <code className="truncate text-[13px] text-dd-text">{model}</code>
        {name && name !== model ? <span className="truncate text-[12px] text-dd-muted">{name}</span> : null}
      </div>
      {unavailable ? <span className="shrink-0 rounded-dd bg-dd-surface-3 px-2 py-0.5 text-[11px] text-dd-muted">{translate("unavailable, skipped")}</span> : null}
      <IconButton icon="close" label={`${translate("Remove")} ${model}`} onClick={onRemove} />
    </li>
  );
}

function RouteCard({ route, onSaved }) {
  const [draft, setDraft] = useState(route.saved);
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const byId = new Map(route.candidates.map((c) => [c.id, c]));
  const custom = draft.length > 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(route.saved);
  const addOptions = route.candidates.filter((c) => !draft.includes(c.id)).map((c) => ({ value: c.id, label: c.name && c.name !== c.id ? `${c.id} (${c.name})` : c.id }));

  const save = async (models) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/media-providers/routes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: route.id, models })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      onSaved(data.route);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = draft.findIndex((_, i) => `row-${i}` === active.id);
    const to = draft.findIndex((_, i) => `row-${i}` === over.id);
    if (from !== -1 && to !== -1) setDraft((prev) => arrayMove(prev, from, to));
  };

  return (
    <Card padding={false}>
      <CardHeader
        title={translate(route.label)}
        subtitle={<code className="text-[12px]">POST {route.endpoint}</code>}
        actions={<span className="text-[12px] text-dd-muted">{custom ? translate("Custom order") : translate("Automatic")}</span>}
      />
      <div className="flex flex-col gap-3 p-5">
        {route.candidates.length === 0 && !custom ? (
          <EmptyState
            icon="block"
            title={translate("No connected provider supports this")}
            message={translate("Requests without a model return an error until you connect a provider with a model for this endpoint.")}
            action={{ href: providersPageFor(route.id), label: translate("Media Providers"), icon: "add" }}
          />
        ) : null}

        {!custom && route.candidates.length > 0 ? (
          <>
            <p className="text-[13px] text-dd-muted">
              {translate("Requests without a model try every available model in this order. Customize to pick the default and its fallbacks.")}
            </p>
            <ol className="flex flex-col gap-1">
              {route.effective.map((id, i) => (
                <li key={id} className="flex min-w-0 items-center gap-2 px-2 text-[13px]">
                  <span className="w-4 shrink-0 text-center text-[11px] text-dd-muted dd-tnum">{i + 1}</span>
                  <code className="truncate text-dd-text">{id}</code>
                </li>
              ))}
            </ol>
            <div>
              <Button icon="tune" onClick={() => setDraft(route.candidates.map((c) => c.id))}>{translate("Customize")}</Button>
            </div>
          </>
        ) : null}

        {custom ? (
          <>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
              <SortableContext items={draft.map((_, i) => `row-${i}`)} strategy={verticalListSortingStrategy}>
                <ol className="flex flex-col gap-1">
                  {draft.map((id, i) => (
                    <RouteRow
                      key={`row-${i}`}
                      uid={`row-${i}`}
                      index={i}
                      model={id}
                      name={byId.get(id)?.name}
                      unavailable={!byId.has(id)}
                      onRemove={() => setDraft(draft.filter((_, j) => j !== i))}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
            {addOptions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Select options={addOptions} value={adding} onChange={setAdding} placeholder={translate("Add a fallback model…")} />
                </div>
                <Button icon="add" disabled={!adding} onClick={() => { setDraft([...draft, adding]); setAdding(""); }}>{translate("Add")}</Button>
              </div>
            ) : null}
          </>
        ) : null}

        {ROUTE_NOTES[route.id] ? <p className="text-[12px] text-dd-muted">{translate(ROUTE_NOTES[route.id])}</p> : null}
        {error ? <p role="alert" className="text-[13px] text-dd-danger">{error}</p> : null}

        {custom || route.saved.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="save" loading={saving} disabled={!dirty || draft.length === 0} onClick={() => save(draft)}>{translate("Save")}</Button>
            {dirty ? <Button variant="ghost" onClick={() => setDraft(route.saved)}>{translate("Discard")}</Button> : null}
            {route.saved.length > 0 ? <Button variant="ghost" icon="restart_alt" loading={saving} onClick={() => save([])}>{translate("Use automatic order")}</Button> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export default function MediaRoutesPage() {
  const [routes, setRoutes] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/media-providers/routes", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Load failed (${res.status})`);
        if (!cancelled) setRoutes(data.routes || []);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  const replaceRoute = (next) => setRoutes((prev) => prev.map((r) => (r.id === next.id ? next : r)));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon="alt_route"
        title={translate("Media Routes")}
        subtitle={translate("Pick the default model and fallbacks each media endpoint uses when a request has no model.")}
      />
      {error ? <p role="alert" className="text-[13px] text-dd-danger">{error}</p> : null}
      {!routes && !error ? <CardSkeleton /> : null}
      {routes ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* Keyed on the saved order so a save remounts the card with a fresh draft. */}
          {routes.map((route) => <RouteCard key={`${route.id}:${route.saved.join(",")}`} route={route} onSaved={replaceRoute} />)}
        </div>
      ) : null}
    </div>
  );
}
