/**
 * Durin DS — PageHeader
 *
 * Top-of-page identity row: a gold icon tile, the page title with an optional
 * muted subtitle, and a right-aligned `actions` slot. Title content can shrink
 * and long text wraps safely. On narrow viewports, actions wrap on their own
 * full-width row without clipping; wider layouts keep them right-aligned.
 * Styling uses `*-dd-*` token utilities so themes remain consistent.
 * Class names stay as full literals because Tailwind v4 scans source text;
 * interpolated class fragments would generate no CSS.
 *
 * @param {object} props
 * @param {string} [props.icon] Material Symbols ligature name, rendered in a
 *   `size-9 rounded-dd bg-dd-accent-soft text-dd-accent` tile.
 * @param {React.ReactNode} props.title Page title (`text-xl font-semibold tracking-tight`).
 * @param {React.ReactNode} [props.subtitle] Supporting line (`text-[13px] text-dd-muted`).
 * @param {React.ReactNode} [props.actions] Wrapping, right-aligned action slot (buttons, menus).
 * @param {string} [props.className] Extra classes merged onto the root element.
 */
export default function PageHeader({ icon, title, subtitle, actions, className }) {
  const rootClassName = ["flex flex-wrap items-center gap-x-3 gap-y-2", className]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={rootClassName}>
      {icon ? (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] leading-none">
            {icon}
          </span>
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        <h1 className="break-words text-xl font-semibold tracking-tight text-dd-text [overflow-wrap:anywhere]">{title}</h1>
        {subtitle ? <p className="break-words text-[13px] text-dd-muted [overflow-wrap:anywhere]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex min-w-0 max-w-full basis-full flex-wrap items-center justify-end gap-2 sm:basis-auto">{actions}</div> : null}
    </header>
  );
}
