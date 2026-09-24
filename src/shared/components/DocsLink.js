import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";
import { docsUrl } from "@/shared/constants/docs";

// One-line pointer to a docs page, used where in-app help text used to live.
export default function DocsLink({ path, label = "How it works", className }) {
  return (
    <a
      href={docsUrl(path)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex min-h-11 w-fit items-center gap-1 rounded-dd text-xs font-medium text-dd-accent outline-none hover:underline focus-visible:shadow-dd-focus", className)}
    >
      {label}
      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">open_in_new</span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

DocsLink.propTypes = {
  path: PropTypes.string.isRequired,
  label: PropTypes.string,
  className: PropTypes.string,
};
