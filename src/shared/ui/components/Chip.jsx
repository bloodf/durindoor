/**
 * Durin DS — Chip (model/provider tag).
 *
 * Compact token for models, providers, filters and similar entities.
 * Supports a leading Material Symbols icon, an optional remove button
 * (`onRemove`), click behavior (`onClick`), and a `selected` state
 * (gold `dd-accent` border + `dd-accent-soft` background — gold is the only
 * interactive accent in Durin DS).
 *
 * Markup avoids nested interactive elements: when `onRemove` is present the
 * chip is a neutral `<span>` shell containing sibling `<button>`s (one for
 * the label when `onClick` is set, one for remove); otherwise a clickable
 * chip is itself a single `<button>`. Focus uses the Durin DS gold ring via
 * `outline-none focus-visible:shadow-dd-focus` on every interactive element.
 *
 * Class names are complete literal strings (Tailwind v4 scans source text);
 * variant maps hold full literals only.
 */

const SIZE_CLASSES = {
  sm: "h-6 px-2 text-xs",
  md: "h-7 px-2.5 text-[13px]",
};

const ICON_CLASSES = {
  sm: "text-[14px]",
  md: "text-[16px]",
};

const REMOVE_ICON_CLASSES = {
  sm: "text-[12px]",
  md: "text-[14px]",
};

const SELECTED_CLASSES = {
  off: "border-dd-border bg-dd-surface-2",
  on: "border-dd-accent bg-dd-accent-soft",
};

const HOVER_CLASSES = {
  off: "hover:border-dd-border-subtle",
  on: "hover:border-dd-accent-hover",
};

/**
 * @param {object} props
 * @param {string} [props.icon] Material Symbols ligature name.
 * @param {string} props.label
 * @param {(event) => void} [props.onRemove] Renders a small `close` button.
 * @param {(event) => void} [props.onClick] Makes the chip a real button.
 * @param {boolean} [props.selected] Gold accent border + soft background.
 * @param {"sm"|"md"} [props.size]
 */
export function Chip({
  icon,
  label,
  onRemove,
  onClick,
  selected = false,
  size = "md",
  className = "",
  ...props
}) {
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const shell = [
    "inline-flex items-center gap-1.5 rounded-dd border font-medium text-dd-text",
    selected ? SELECTED_CLASSES.on : SELECTED_CLASSES.off,
    sizeClass,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      {icon ? (
        <span
          aria-hidden="true"
          className={`material-symbols-outlined leading-none ${ICON_CLASSES[size] || ICON_CLASSES.md}`}
        >
          {icon}
        </span>
      ) : null}
      <span className="truncate">{label}</span>
    </>
  );

  const removeButton = onRemove ? (
    <button
      type="button"
      aria-label={`Remove ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onRemove(event);
      }}
      className="-mr-0.5 inline-flex shrink-0 items-center justify-center rounded-full text-dd-muted outline-none transition-colors hover:text-dd-text focus-visible:shadow-dd-focus"
    >
      <span
        aria-hidden="true"
        className={`material-symbols-outlined leading-none ${REMOVE_ICON_CLASSES[size] || REMOVE_ICON_CLASSES.md}`}
      >
        close
      </span>
    </button>
  ) : null;

  // Removable chip: neutral shell with sibling buttons (never nested).
  if (onRemove) {
    return (
      <span className={shell} {...props}>
        {onClick ? (
          <button
            type="button"
            aria-pressed={selected}
            onClick={onClick}
            className="inline-flex min-w-0 items-center gap-1.5 rounded outline-none focus-visible:shadow-dd-focus"
          >
            {body}
          </button>
        ) : (
          body
        )}
        {removeButton}
      </span>
    );
  }

  // Clickable chip: the whole chip is a single button.
  if (onClick) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={[
          shell,
          "cursor-pointer outline-none transition-colors focus-visible:shadow-dd-focus",
          selected ? HOVER_CLASSES.on : HOVER_CLASSES.off,
        ].join(" ")}
        {...props}
      >
        {body}
      </button>
    );
  }

  // Static chip.
  return (
    <span className={shell} {...props}>
      {body}
    </span>
  );
}
