import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Cinzel } from "next/font/google";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { source } from "@site/lib/source";
import { baseOptions } from "@site/lib/layout.shared";
import { DocsSidebarFooter } from "@site/components/docs/SidebarFooter.jsx";
import "./docs.css";

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-docs-display",
  display: "swap",
});

function productVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "..", "package.json"), "utf8"));
    if (pkg.name === "durindoor" && pkg.version) return pkg.version;
  } catch {
    // website-only checkout
  }
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version;
  } catch {
    return "";
  }
}

const VERSION = productVersion();

function treeWithoutRootIndex(tree) {
  return {
    ...tree,
    children: tree.children.filter((node) => node.type !== "page" || node.url !== "/docs"),
  };
}

export default function Layout({ children }) {
  return (
    <RootProvider theme={{ enabled: false }} search={{ options: { api: "/docs-search" } }}>
      <DocsLayout
        tree={treeWithoutRootIndex(source.getPageTree())}
        {...baseOptions()}
        tabs={false}
        sidebar={{
          collapsible: true,
          footer: <DocsSidebarFooter version={VERSION} />,
        }}
        containerProps={{ className: `dd-docs ${cinzel.variable}` }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
