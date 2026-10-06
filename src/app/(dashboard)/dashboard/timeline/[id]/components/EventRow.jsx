import { isString } from "@/shared/utils/typeChecks.js";

export default function EventRow({ event }) {
  return (
    <div className="py-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-dd-muted">
        <span className="font-mono dd-tnum">#{event.seq}</span>
        <span>{event.type}</span>
        <span>{event.direction}</span>
        {event.summary ? <span className="text-dd-text">{event.summary}</span> : null}
      </div>
      {event.payload != null ? (
        <pre tabIndex={0} aria-label={`Timeline event #${event.seq} details`} className="mt-1.5 overflow-x-auto rounded-dd bg-dd-surface-2 p-2.5 text-xs text-dd-text" role="region">
          {isString(event.payload) ? event.payload : JSON.stringify(event.payload, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
