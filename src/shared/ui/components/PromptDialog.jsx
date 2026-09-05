import { useId, useState } from "react";
import Modal from "./Modal";

/**
 * Durin DS — PromptDialog.
 *
 * Drop-in replacement for `window.prompt`, built on {@link Modal}.
 *
 * Structure note: the exported component returns `null` while closed and
 * mounts {@link PromptDialogForm} fresh on every open. The input value
 * therefore always starts from `defaultValue` without a reset effect.
 *
 * Keyboard contract: Enter submits (the footer submit button is associated
 * with the form via the HTML `form` attribute, so implicit submission works
 * even though the button renders outside the <form>), Esc cancels via the
 * Modal keydown handler. Submit stays disabled while the value is empty or
 * whitespace-only.
 */
export default function PromptDialog(props) {
  const { open } = props;
  if (!open) return null;
  return <PromptDialogForm {...props} />;
}

function PromptDialogForm({
  title,
  label,
  placeholder,
  defaultValue = "",
  inputType = "text",
  submitLabel = "Save",
  onSubmit,
  onCancel,
}) {
  const [value, setValue] = useState(defaultValue);
  const inputId = useId();
  const formId = useId();
  const canSubmit = value.trim().length > 0;
  const handleSubmit = (event) => {
    event.preventDefault();
    if (canSubmit) onSubmit?.(value);
  };
  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={!canSubmit}
            className="h-9 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-xs font-medium text-dd-muted">
          {label}
        </label>
        <input
          type={inputType}
          id={inputId}
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          className="h-9 w-full rounded-dd border border-dd-border bg-dd-surface px-3 text-[13px] text-dd-text outline-none placeholder:text-dd-subtle focus:border-dd-accent focus:shadow-dd-focus"
        />
      </form>
    </Modal>
  );
}
