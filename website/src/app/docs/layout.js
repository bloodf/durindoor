import { readFileSync } from "node:fs";
import { join } from "node:path";
import localFont from "next/font/local";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { source } from "@site/lib/source";
import { baseOptions } from "@site/lib/layout.shared";
import { DocsSidebarFooter } from "@site/components/docs/SidebarFooter.jsx";
import "./docs.css";

const display = localFont({ src: "../../../public/home/fonts/CormorantGaramond.ttf", variable: "--font-docs-display", display: "swap", weight: "300 700" });

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

const sans = localFont({ src: "../../../public/home/fonts/SpaceGrotesk.ttf", variable: "--font-docs-sans", display: "swap", weight: "300 700" });

export default function Layout({ children }) {
  return (
    <RootProvider theme={{ enabled: false }} search={{ options: { api: "/docs-search" } }}>
      <DocsLayout
        tree={treeWithoutRootIndex(source.getPageTree())}
        {...baseOptions()}
        tabs={false}
        sidebar={{
          collapsible: true,
          footer: <DocsSidebarFooter key="docs-footer" version={VERSION} />,
        }}
        containerProps={{ className: `dd-docs ${display.variable} ${sans.variable}` }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
