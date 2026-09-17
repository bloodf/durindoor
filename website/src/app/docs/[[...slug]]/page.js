import { notFound } from "next/navigation";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { source } from "@site/lib/source";
import { getMDXComponents } from "@site/components/mdx";

// source.resolveHref only resolves hrefs that start with ./ or ../, and the MDX
// pipeline drops a leading ./, so same-folder page links arrive bare.
function withDotPrefix(href) {
  if (!href || /^(\.{1,2}\/|\/|#|[a-z][a-z0-9+.-]*:)/i.test(href)) return href;
  return /\.mdx?(#.*)?$/.test(href) ? `./${href}` : href;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://durindoor.vercel.app";

export default async function Page(props) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const Mdx = page.data.body;
  const RelativeLink = createRelativeLink(source, page);

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
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
    title: page.data.title,
    description: page.data.description,
    icons: {
      icon: "/icons/icon-512.png",
      apple: "/icons/icon-192.png",
    },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url: `${SITE_URL}${page.url}`,
    },
  };
}
