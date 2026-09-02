/**
 * Durin DS — EmptyState
 *
 * Centered placeholder for empty lists, tables, and panels: a soft icon tile,
 * a short title, an optional explanatory message, and an optional primary
 * action. The action button is the Durin DS primary style — gold is the only
 * interactive accent — with the standard focus ring
 * (`outline-none focus-visible:shadow-dd-focus`). Token-backed utilities only.
 *
 * @param {object} props
 * @param {string} props.icon Material Symbols ligature name, rendered in a
 *   `size-12 rounded-dd-lg bg-dd-surface-2 text-dd-muted` tile.
 * @param {React.ReactNode} props.title Short headline (`text-sm font-semibold`).
 * @param {React.ReactNode} [props.message] Muted 13px explanation, max `max-w-sm`.
 * @param {{ label: React.ReactNode, icon?: string, onClick?: () => void }} [props.action]
 *   Optional primary button (`bg-dd-accent text-dd-on-accent`, md density).
 */
export default function EmptyState({ icon, title, message, action }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-dd-lg bg-dd-surface-2 text-dd-muted">
        <span aria-hidden="true" className="material-symbols-outlined text-[24px] leading-none">
          {icon}
        </span>
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-semibold text-dd-text">{title}</p>
        {message ? <p className="text-[13px] text-dd-muted">{message}</p> : null}
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex h-9 items-center gap-1.5 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus"
        >
          {action.icon ? (
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">
              {action.icon}
            </span>
          ) : null}
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
