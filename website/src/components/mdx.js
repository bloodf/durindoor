import defaultMdxComponents from "fumadocs-ui/mdx";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
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
  return (
    <CodeBlock {...props} title={language || props.title}>
      <Pre>{props.children}</Pre>
    </CodeBlock>
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
