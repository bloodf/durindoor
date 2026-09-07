import PropTypes from "prop-types";
import { CapacityBadges } from "@/shared/components";
import IconButton from "@/shared/ui/components/IconButton.jsx";

const STATUS_TOKENS = {
  ok: { border: "border-dd-success/40", icon: "check_circle", iconClass: "text-dd-success" },
  error: { border: "border-dd-danger/40", icon: "cancel", iconClass: "text-dd-danger" },
  default: { border: "border-dd-border", icon: "smart_toy", iconClass: "text-dd-muted" },
};

export default function ModelRow({
  model,
  fullModel,
  alias,
  copied,
  onCopy,
  testStatus,
  isCustom,
  isFree,
  onDeleteAlias,
  onTest,
  isTesting,
  onDisable,
  onEdit,
  caps,
  thinkingSuffix,
}) {
  const displayModel = thinkingSuffix ? `${fullModel}(${thinkingSuffix})` : fullModel;
  const token = STATUS_TOKENS[testStatus] || STATUS_TOKENS.default;

  return (
    <div
      className={[
        "group min-w-0 max-w-full rounded-dd border bg-dd-surface px-3 py-2 transition-colors hover:bg-dd-surface-2",
        token.border,
      ].join(" ")}
    >
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <span
          aria-hidden="true"
          className={`material-symbols-outlined shrink-0 text-[18px] leading-none ${token.iconClass}`}
        >
          {token.icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <code className="max-w-[72vw] truncate rounded-dd bg-dd-surface-2 px-1.5 py-0.5 font-mono text-xs text-dd-text sm:max-w-[360px]">
            {displayModel}
          </code>
          <span className="flex min-w-0 items-center gap-1 pl-1 text-[9px]">
            {model.name ? (
              <span className="truncate text-[9px] italic text-dd-subtle">{model.name}</span>
            ) : null}
            <CapacityBadges caps={caps} colorOverride="text-dd-subtle" size={12} />
            {caps?.contextWindow ? (
              <span className="shrink-0 rounded-dd bg-dd-surface-2 px-1 text-[9px] font-medium text-dd-subtle">
                {caps.contextWindow >= 1000000
                  ? `${(caps.contextWindow / 1000000).toFixed(caps.contextWindow % 1000000 ? 1 : 0)}M`
                  : `${Math.round(caps.contextWindow / 1000)}K`}{" "}
                ctx
              </span>
            ) : null}
            {alias ? <span className="text-dd-subtle">→ {alias}</span> : null}
          </span>
        </div>
        {onTest ? (
          <div className="relative shrink-0 group/btn">
            <IconButton
              label={isTesting ? "Testing model" : "Test model"}
              variant="ghost"
              size="sm"
              icon={isTesting ? "progress_activity" : "science"}
              className={isTesting ? "animate-spin" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}
              onClick={onTest}
              disabled={isTesting}
            />
            <span className="pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] text-dd-muted opacity-0 transition-opacity group-hover/btn:opacity-100">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        ) : null}
        <div className="relative shrink-0 group/btn">
          <IconButton
            label="Copy model id"
            variant="ghost"
            size="sm"
            icon={copied === `model-${model.id}` ? "check" : "content_copy"}
            onClick={() => onCopy(displayModel, `model-${model.id}`)}
          />
          <span className="pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] text-dd-muted opacity-0 transition-opacity group-hover/btn:opacity-100">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isCustom && onEdit ? (
          <IconButton
            label="Edit capabilities"
            variant="ghost"
            size="sm"
            icon="edit"
            onClick={onEdit}
            className="ml-auto opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          />
        ) : null}
        {isCustom ? (
          <IconButton
            label="Remove custom model"
            variant="ghost"
            size="sm"
            icon="close"
            onClick={onDeleteAlias}
            className="opacity-100 text-dd-muted hover:text-dd-danger sm:opacity-0 sm:group-hover:opacity-100"
          />
        ) : onDisable ? (
          <IconButton
            label="Disable model"
            variant="ghost"
            size="sm"
            icon="close"
            onClick={onDisable}
            className="ml-auto opacity-100 text-dd-muted hover:text-dd-danger sm:opacity-0 sm:group-hover:opacity-100"
          />
        ) : null}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes['shape']({ id: PropTypes.string.isRequired }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  onDisable: PropTypes.func,
  onEdit: PropTypes.func,
  caps: PropTypes.object,
  thinkingSuffix: PropTypes.string,
};
