import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { source } from "@site/lib/source";
import { baseOptions } from "@site/lib/layout.shared";
import "./docs.css";

export default function Layout({ children }) {
  return (
    <RootProvider theme={{ enabled: false }} search={{ options: { api: "/docs-search" } }}>
      <DocsLayout
        tree={source.getPageTree()}
        {...baseOptions()}
        sidebar={{ collapsible: true }}
        containerProps={{ className: "dd-docs" }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
