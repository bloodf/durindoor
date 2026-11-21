import defaultMdxComponents from "fumadocs-ui/mdx";
import { Callout } from "fumadocs-ui/components/callout";
import { Cards } from "fumadocs-ui/components/card";
import Link from "fumadocs-core/link";
import { useId } from "react";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import {
  DocsHero,
  DocsPopularLink,
  DocsPopularList,
  DocsSectionCard,
  DocsSectionGrid,
  DocsStartCard,
  DocsStartRow,
} from "@site/components/docs/index.js";

function languageFromPre(props) {
  if (props.title) return props.title;
  if (props["data-language"]) return props["data-language"];
  if (props.lang) return props.lang;
  const className = String(props.className || "");
  const match = className.match(/language-([\w+-]+)/);
  return match ? match[1] : "";
}

function DocsPre(props) {
  const language = languageFromPre(props);
  const id = useId();
  return (
    <CodeBlock {...props} title={language || props.title} viewportProps={{ "aria-label": `Code example ${id}` }}>
      <Pre>{props.children}</Pre>
    </CodeBlock>
  );
}

// Section cards are direct children of the page heading, so their titles are
// second-level headings. Preserve the upstream card appearance and link.
function Card({ icon, title, description, children, href, className = "", ...props }) {
  const Element = href ? Link : "div";
  return (
    <Element {...props} href={href} data-card className={`block rounded-xl border bg-fd-card p-4 text-fd-card-foreground transition-colors @max-lg:col-span-full ${href ? "hover:bg-fd-accent/80" : ""} ${className}`}>
      {icon && <div className="not-prose mb-2 w-fit shadow-md rounded-lg border bg-fd-muted p-1.5 text-fd-muted-foreground [&_svg]:size-4">{icon}</div>}
      <h2 className="not-prose mb-1 text-sm font-medium">{title}</h2>
      {description && <p className="my-0! text-sm text-fd-muted-foreground">{description}</p>}
      <div className="text-sm text-fd-muted-foreground prose-no-margin empty:hidden">{children}</div>
    </Element>
  );
}

export function getMDXComponents(components) {
  return {
    ...defaultMdxComponents,
    pre: DocsPre,
    Callout,
    Card,
    Cards,
    Step,
    Steps,
    Tab,
    Tabs,
    DocsHero,
    DocsStartRow,
    DocsStartCard,
    DocsSectionGrid,
    DocsSectionCard,
    DocsPopularList,
    DocsPopularLink,
    ...components,
  };
}
