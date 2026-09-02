import IconButton from "@/shared/ui/components/IconButton";

/** Persistent dashboard bar with optional page identity and actions. */
export function Header({ title, subtitle, icon, actions }) {
  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.classList.toggle("dark");
    root.style.colorScheme = dark ? "dark" : "light";
  }

  const hasIdentity = title || subtitle || icon;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-dd-border bg-dd-surface px-6">
      <div className="min-w-0">
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

      <div className="flex shrink-0 items-center gap-1">
        {actions ? (
          <div className="mr-2 flex items-center gap-2 border-r border-dd-border-subtle pr-3">
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
