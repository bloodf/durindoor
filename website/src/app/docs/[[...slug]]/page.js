import { SITE_URL } from "@site/lib/site.js";
import { notFound } from "next/navigation";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  EditOnGitHub,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { source } from "@site/lib/source";
import { getMDXComponents } from "@site/components/mdx";

// source.resolveHref only resolves hrefs that start with ./ or ../, and the MDX
// pipeline drops a leading ./, so same-folder page links arrive bare.
function withDotPrefix(href) {
  if (!href || /^(\.{1,2}\/|\/|#|[a-z][a-z0-9+.-]*:)/i.test(href)) return href;
  return /\.mdx?(#.*)?$/.test(href) ? `./${href}` : href;
}


const GITHUB_DOCS = "https://github.com/bloodf/durindoor/blob/main/docs";

export default async function Page(props) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const Mdx = page.data.body;
  const RelativeLink = createRelativeLink(source, page);
  const isLanding = !params.slug || params.slug.length === 0;
  const githubFile = `${GITHUB_DOCS}/${page.path}`;
  const toc = page.data.toc ?? [];
  const hasToc = !isLanding && toc.length > 0;

  return (
    <DocsPage
      className={isLanding ? "dd-docs-index" : "dd-docs-article"}
      toc={toc}
      full={page.data.full}
      breadcrumb={{ enabled: !isLanding }}
      tableOfContent={{
        enabled: hasToc,
        footer: hasToc ? <EditOnGitHub href={githubFile} /> : undefined,
      }}
      tableOfContentPopover={{ enabled: hasToc }}
    >
      {!isLanding && <DocsTitle>{page.data.title}</DocsTitle>}
      {!isLanding && <DocsDescription>{page.data.description}</DocsDescription>}
      {!isLanding && !hasToc && (
        <div className="dd-docs-page-actions">
          <EditOnGitHub href={githubFile} />
        </div>
      )}
      <DocsBody>
        <Mdx
          components={getMDXComponents({
            a: ({ href, ...rest }) => <RelativeLink href={withDotPrefix(href)} {...rest} />,
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    metadataBase: SITE_URL,
    title: `${page.data.title} | DurinDoor`,
    description: page.data.description,
    alternates: { canonical: new URL(page.url, SITE_URL).href },
    icons: {
      icon: "/home/favicon.svg",
      apple: "/brand/durindoor-apple-touch-icon.png",
    },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url: new URL(page.url, SITE_URL).href,
      locale: "en_US",
      type: "article",
      images: [{ url: "/brand/durindoor-social.png", width: 1200, height: 630, alt: "DurinDoor self-hosted AI gateway" }],
    },
  };
}
