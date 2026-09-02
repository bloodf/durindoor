/**
 * Durin DS — PageHeader
 *
 * Top-of-page identity row: a gold icon tile, the page title with an optional
 * muted subtitle, and a right-aligned `actions` slot. The row wraps on narrow
 * viewports — the actions block drops to its own line but stays right-aligned
 * via `ml-auto`. All styling goes through `*-dd-*` token utilities, so the
 * header flips with the Storybook "Theme" toolbar (dark "Moria stone" /
 * light "Parchment"). Class names are full literals on purpose: Tailwind v4
 * scans source text, so interpolated class fragments would generate no CSS.
 *
 * @param {object} props
 * @param {string} [props.icon] Material Symbols ligature name, rendered in a
 *   `size-9 rounded-dd bg-dd-accent-soft text-dd-accent` tile.
 * @param {React.ReactNode} props.title Page title (`text-xl font-semibold tracking-tight`).
 * @param {React.ReactNode} [props.subtitle] Supporting line (`text-[13px] text-dd-muted`).
 * @param {React.ReactNode} [props.actions] Right-aligned action slot (buttons, menus).
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
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-xl font-semibold tracking-tight text-dd-text">{title}</h1>
        {subtitle ? <p className="text-[13px] text-dd-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
