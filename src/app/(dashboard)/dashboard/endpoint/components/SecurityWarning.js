"use client";

/** Security warning banner with optional action link */
export default function SecurityWarning({ message, action }) {
  return (
    <div className="flex items-start gap-2 rounded-dd border border-dd-warning bg-dd-warning/10 px-3 py-2 text-dd-warning" role="alert">
      <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px]" aria-hidden="true">warning</span>
      <p className="flex-1 text-xs">{message}</p>
      {action ? (
        <a
          href={action.href}
          className="min-h-11 shrink-0 content-center text-xs font-medium underline outline-none focus-visible:shadow-dd-focus"
          onClick={action.href.startsWith("#") ? (e) => {
            e.preventDefault();
            document.getElementById(action.href.slice(1))?.scrollIntoView({ behavior: "smooth" });
          } : undefined}
        >
          {action.label}
        </a>
      ) : null}
    </div>
  );
}
