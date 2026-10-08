import IconButton from "@/shared/ui/components/IconButton";

/** Persistent dashboard bar with optional page identity and actions. */
export function Header({ title, subtitle, icon, actions, onMenuClick }) {
  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.classList.toggle("dark");
    root.style.colorScheme = dark ? "dark" : "light";
  }

  const hasIdentity = title || subtitle || icon;

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-dd-border bg-dd-surface px-4 py-2 lg:h-14 lg:flex-nowrap lg:px-6 lg:py-0">
      <div className="flex min-w-0 flex-1 basis-40 items-center gap-2 lg:basis-0">
        {onMenuClick ? <IconButton icon="menu" label="Open navigation" onClick={onMenuClick} className="lg:hidden" /> : null}
        {hasIdentity ? (
          <div className="flex min-w-0 items-center gap-3">
            {icon ? (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-[19px] leading-none"
                >
                  {icon}
                </span>
              </div>
            ) : null}
            <div className="min-w-0 leading-tight">
              {title ? (
                <h1 className="truncate text-sm font-semibold text-dd-text">{title}</h1>
              ) : null}
              {subtitle ? <p className="truncate text-xs text-dd-muted">{subtitle}</p> : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 lg:shrink-0">
        {actions ? (
          <div className="mr-2 flex min-w-0 max-w-full flex-wrap items-center gap-2 border-r border-dd-border-subtle pr-3">
            {actions}
          </div>
        ) : null}
        <IconButton icon="dark_mode" label="Toggle theme" onClick={toggleTheme} />
        <IconButton icon="translate" label="Change language" />
        <IconButton icon="apps" label="Open apps menu" />
      </div>
    </header>
  );
}

export default Header;
