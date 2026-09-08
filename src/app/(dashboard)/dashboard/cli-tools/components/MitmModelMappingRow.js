import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { REASONING_OPTIONS } from "@/shared/constants/reasoningEffortOptions";

export default function MitmModelMappingRow({
  model,
  entry,
  disabled,
  canSelectModel,
  showReasoning,
  onModelChange,
  onModelBlur,
  onModelClear,
  onModelSelect,
  onReasoningChange,
}) {
  const controlId = model.alias.replace(/[^a-z0-9_-]/gi, "-");
  const reasoningOptions = REASONING_OPTIONS.map((option) => ({ value: option.value, label: option.label }));

  return (
    <div className="rounded-dd border border-dd-border bg-dd-surface-2 p-2.5 transition-colors hover:border-dd-accent/30">
      <div className={`grid grid-cols-1 gap-2 ${showReasoning ? "sm:grid-cols-[9rem_minmax(12rem,1fr)_8rem_auto]" : "sm:grid-cols-[9rem_minmax(12rem,1fr)_auto]"} sm:items-center`}>
        <label htmlFor={`mitm-model-${controlId}`} className="text-xs font-semibold text-dd-text sm:text-right">
          {model.name}
        </label>
          <div className="relative w-full min-w-0">
            <Input
              id={`mitm-model-${controlId}`}
              size="sm"
              value={entry.model || ""}
              onChange={(event) => onModelChange(event.target.value)}
              onBlur={(event) => onModelBlur(event.target.value)}
              placeholder="provider/model-id"
              disabled={disabled}
              className={entry.model ? "pr-11" : ""}
            />
            {entry.model ? (
              <span className="pointer-events-none absolute inset-y-0 right-0 flex w-11 items-center justify-end pr-1">
                <IconButton
                  icon="close"
                  label={`Clear model mapping for ${model.name}`}
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={onModelClear}
                  className="pointer-events-auto"
                />
              </span>
            ) : null}
          </div>
        {showReasoning ? (
          <Select
            value={entry.reasoningEffort || ""}
            onChange={onReasoningChange}
            options={reasoningOptions}
            size="sm"
            disabled={disabled}
            aria-label={`Reasoning effort for ${model.name}`}
            title="Default preserves the reasoning effort sent by Antigravity"
          />
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onModelSelect}
          disabled={!canSelectModel || disabled}
        >
          Select
        </Button>
      </div>
    </div>
  );
}
