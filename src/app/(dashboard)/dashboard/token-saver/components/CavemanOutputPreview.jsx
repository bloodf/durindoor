import { CAVEMAN_PROMPTS } from "../../../../../../open-sse/rtk/cavemanPrompts.js";

/** Preview the same instruction block injectCaveman appends, without a UI-owned copy. */
export default function CavemanOutputPreview({ level, enabled }) {
  const prompt = CAVEMAN_PROMPTS[level];
  if (!prompt) return null;

  return (
    <details className="w-full basis-full rounded-dd border border-dd-border p-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-medium text-dd-text">
        Preview injected output instructions
      </summary>
      <p className="mb-3 text-xs text-dd-muted">
        {enabled
          ? "This block is appended to eligible requests when Token Saver is active. Media requests skip Caveman."
          : "Preview only: Caveman is off, so this block is not injected."}
      </p>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text">{prompt}</pre>
    </details>
  );
}
