import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewIconStyles } from "./review-style-boundary.mjs";
import { reviewNativeButtons } from "./review-button-boundary.mjs";
import { reviewGlyphs } from "./review-glyph-boundary.mjs";

const storybookDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(storybookDir, "..");

/**
 * Durin DS Storybook — @storybook/react-vite (NOT the Next.js framework).
 * Essentials addons ship in Storybook 10 core, so `addons` stays empty.
 * `staticDirs` serves public/ so /fonts/Inter-*.woff2 resolves in previews.
 *
 * @type {import("@storybook/react-vite").StorybookConfig}
 */
const config = {
  stories: [
    "../src/shared/ui/**/*.stories.@(js|jsx|ts|tsx)",
    "../src/shared/components/**/*.stories.@(js|jsx|ts|tsx)",
    "../src/app/**/*.stories.@(js|jsx|ts|tsx)",
  ],
  addons: [],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["../public", { from: "../node_modules/monaco-editor/min/vs", to: "/monaco/vs" }],
  viteFinal: async (viteConfig) => {
    const { mergeConfig, transformWithEsbuild } = await import("vite");
    // Automatic JSX runtime — without this plugin the preview pipeline falls
    // back to esbuild's classic transform (`React.createElement`) and every
    // story throws "React is not defined" at runtime.
    const { default: react } = await import("@vitejs/plugin-react");
    const { createProviderMetadataPlugin } = await import("./provider-metadata.mjs");
    const providerMetadata = await createProviderMetadataPlugin(projectRoot);
    return mergeConfig(viteConfig, {
      define: { "process.env.NEXT_PUBLIC_CLOUD_URL": JSON.stringify("https://cloud.example.test") },
      plugins: [{
        name: "v5-review-control-boundary",
        enforce: "pre",
        transform(source, id) {
          if (id === path.join(projectRoot, "src/app/globals.css")) return { code: reviewIconStyles(source), map: null };
          if (!id.startsWith(`${projectRoot}/src/`) || !/\.(?:js|jsx)$/.test(id) || id.endsWith("/NativeSelect.jsx")) return null;
          let code = source;
          if (id.endsWith("/dashboard/skills/page.js")) {
            code = code.replace('className="min-w-0 flex-1 whitespace-pre-wrap break-all', 'className={globalThis.document?.documentElement.dataset.v5Review === "true" ? "min-w-0 flex-1 basis-full sm:basis-0 whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" : "min-w-0 flex-1 whitespace-pre-wrap break-all');
            code = code.replace('p-3 text-xs text-dd-text">{buildSkillInstruction', 'p-3 text-xs text-dd-text"}>{buildSkillInstruction');
          }
          if (id.endsWith("/dashboard/timeline/page.js")) {
            code = code.replace('<span className="inline-flex items-center gap-2"><ProviderLogo', '<span className={globalThis.document?.documentElement.dataset.v5Review === "true" ? "inline-flex items-center gap-2 whitespace-nowrap" : "inline-flex items-center gap-2"}><ProviderLogo');
          }
          if (id.endsWith("/shared/ui/components/Pagination.jsx")) {
            code = code.replace("rowsPerPageOptions.map(", '(globalThis.document?.documentElement.dataset.v5Review === "true" && !rowsPerPageOptions.includes(rowsPerPage) ? [...rowsPerPageOptions, rowsPerPage] : rowsPerPageOptions).map(');
          }
          if (id.endsWith("/shared/ui/components/Button.jsx")) {
            code = code.replace("export default function Button(", "function OriginalButton(");
            code = `import ReviewButton from ${JSON.stringify(path.join(projectRoot, "src/shared/ui/v5/motion/ReviewButton.jsx"))};\n` + code
              + '\nexport default function Button(props) { return globalThis.document?.documentElement.dataset.v5Review === "true" ? <ReviewButton {...props} /> : <OriginalButton {...props} />; }\n';
          }
          const replacements = [
            ["/shared/components/ComboFormModal.js", "ComboFormModal", "combos/ReviewSharedComboFormModal.jsx", false],
            ["/shared/components/ModelSelectModal.js", "ModelSelectModal", "combos/ReviewModelSelectModal.jsx", false],
            ["/dashboard/combos/page.js", "CombosPage", "combos/ReviewCombosPage.jsx", false],
            ["/providers/[id]/ModelAutoSyncPanel.js", "ModelAutoSyncPanel", "providers/ReviewAutoSyncCard.jsx", false],
            ["/login/LoginView.js", "LoginView", "login/ReviewLoginView.jsx", true],
          ];
          for (const [suffix, name, replacement, named] of replacements) {
            if (!id.endsWith(suffix)) continue;
            const signature = `${named ? "export" : "export default"} function ${name}(`;
            if (!code.includes(signature)) throw new Error(`Review replacement signature changed: ${id}`);
            code = code.replace(signature, `function Incumbent${name}(`);
            code = `import ${named ? "{ ReviewLoginView as Replacement }" : "Replacement"} from ${JSON.stringify(path.join(projectRoot, "src/shared/ui/v5", replacement))};\n` + code
              + `\n${named ? "export" : "export default"} function ${name}(props) { return globalThis.document?.documentElement.dataset.v5Review === "true" ? <Replacement {...props} /> : <Incumbent${name} {...props} />; }\n`;
          }
          if (id.endsWith("/providers/[id]/page.js")) {
            for (const handler of ["handleRoundRobinToggle", "handleCacheAffinityToggle"]) {
              const label = handler === "handleRoundRobinToggle" ? "Round Robin" : "Cache Affinity";
              const pair = new RegExp(`(<span[^>]*>${label}</span>\\s*<Toggle[\\s\\S]*?onChange=\\{${handler}\\} />)`);
              code = code.replace(pair, '<div className={globalThis.document?.documentElement.dataset.v5Review === "true" ? "inline-flex items-center gap-2 whitespace-nowrap" : "contents"}>$1</div>');
            }
            code = code.replace('className="hidden text-xs text-dd-muted sm:inline">RPM / account', 'className={globalThis.document?.documentElement.dataset.v5Review === "true" ? "text-xs text-dd-muted" : "hidden text-xs text-dd-muted sm:inline"}>RPM / account');
            const panel = code.match(/\{!isCompatible &&\s*<ModelAutoSyncPanel[\s\S]*?\/>\s*\}/)?.[0];
            if (!panel) throw new Error("Provider auto-sync placement changed");
            code = code.replace(panel, `{globalThis.document?.documentElement.dataset.v5Review !== "true" && (${panel.slice(1, -1)})}`)
              .replace("{/* Models */}", `{globalThis.document?.documentElement.dataset.v5Review === "true" && (${panel.slice(1, -1)})}\n      {/* Models */}`);
          }
          if (id.endsWith("/token-saver/TokenSaverClient.jsx")) {
            code = code.replace("export default function TokenSaverClient(", "function IncumbentTokenSaverClient(");
            code = `import TokenSaverDashboard from ${JSON.stringify(path.join(projectRoot, "src/shared/ui/v5/dashboards/TokenSaverDashboard.jsx"))};\n` + code
              + '\nexport default function TokenSaverClient(props) { return globalThis.document?.documentElement.dataset.v5Review === "true" && props.view !== "settings" ? <TokenSaverDashboard /> : <IncumbentTokenSaverClient {...props} />; }\n';
          }
          if (id.endsWith("/shared/components/Sidebar.js")) {
            // Evaluate at render time, after the review fixture is installed.
            code = `import { reviewSidebarSections } from ${JSON.stringify(path.join(projectRoot, "src/shared/ui/v5/review-navigation.js"))};\n` + code.replace('NAV_SECTIONS.map(', 'reviewSidebarSections(NAV_SECTIONS).map(');
          }
          if (id.endsWith("/shared/components/SidebarNavIcons.js")) {
            code = `import MotionIcon from ${JSON.stringify(path.join(projectRoot, "src/shared/ui/v5/motion/MotionIcon.jsx"))};\n` + code.replace('export function NavIcon({ icon, isActive, size = "18" }) {', 'export function NavIcon({ icon, isActive, size = "18" }) {\n  if (globalThis.document?.documentElement.dataset.v5Review === "true") return createElement(MotionIcon, { name: icon, size: Number(size), className: isActive ? "text-dd-accent" : "" });');
          }
          if (id.endsWith("/shared/components/Header.js")) {
            code = code.replace('const getPageInfo = (pathname) => {', 'const getPageInfo = (pathname) => {\n  if (pathname === "/dashboard/workspaces") return { title: "My dashboards", description: "Build a dashboard from Usage, Token Saver, Quota and Monitoring", icon: "dashboard", breadcrumbs: [] };');
          }
          if (/\/shared\/constants\/(?:mitmToolHosts|coworkPlugins)\.js$/.test(id)) {
            code = code.replace(/module\.exports = \{([^}]+)\};?/, "export { $1 };");
          }
          // The limits table has no interactive cells. Its local scroll region
          // must be keyboard reachable in the narrow review layout.
          if (id.endsWith("/usage/components/ApiKeyLimitsCard.js")) {
            code = code.replace('<div className="overflow-x-auto rounded-dd border border-dd-border">', '<div tabIndex={globalThis.document?.documentElement.dataset.v5Review === "true" ? 0 : undefined} role={globalThis.document?.documentElement.dataset.v5Review === "true" ? "region" : undefined} aria-label={globalThis.document?.documentElement.dataset.v5Review === "true" ? "API key rate and budget limits" : undefined} className="overflow-x-auto rounded-dd border border-dd-border">');
          }
          if (/<\/?select\b/.test(code)) {
            code = `import { V5NativeSelect } from ${JSON.stringify(path.join(projectRoot, "src/shared/ui/v5/NativeSelect.jsx"))};\n` + code.replace(/(<\/?)select\b/g, "$1V5NativeSelect");
          }
          if (!id.endsWith("/motion/ReviewNativeButton.jsx")) code = reviewNativeButtons(code, path.join(projectRoot, "src/shared/ui/v5/motion/ReviewNativeButton.jsx"));
          if (id.endsWith("/shared/components/HeaderLanguage.js") || id.endsWith("/shared/components/LanguageSwitcher.js")) {
            code = code.replace(/(<span)([^>]*className="text-(?:lg|2xl)[^"]*"[^>]*>)(\{(?:LOCALE_FLAGS|getLocaleInfo|info\.flag))/g, '$1 data-icon-name="language"$2$3');
          }
          if (!id.includes("/ui/v5/motion/")) code = reviewGlyphs(code, path.join(projectRoot, "src/shared/ui/v5/motion/ReviewGlyph.jsx"));
          if (id.endsWith("/shared/ui/components/Tooltip.jsx")) {
            code = `import { allowsIconTooltip } from ${JSON.stringify(path.join(projectRoot, "src/shared/ui/v5/motion/ReviewNativeButton.jsx"))};\n` + code.replace("export default function Tooltip(", "function OriginalTooltip(")
              + '\nexport default function Tooltip(props) { return globalThis.document?.documentElement.dataset.v5Review === "true" && !allowsIconTooltip(props.children) ? cloneElement(props.children, { title: undefined }) : <OriginalTooltip {...props} />; }\n';
          }
          if (/\/(?:Header\.js|login\/page\.js|profile\/page\.js)$/.test(id)) {
            code = code.replace(/window\.location\.assign\(([^;\n]+)\)/g, "reviewAssign($1)")
              .replace(/window\.location\.href\s*=\s*([^;\n]+)/g, "reviewAssign($1)");
            if (code.includes("reviewAssign(")) code = `import { reviewAssign } from ${JSON.stringify(path.join(storybookDir, "review-runtime.js"))};\n` + code;
          }
          return code === source ? null : { code, map: null };
        },
      }, {
        name: "production-jsx",
        enforce: "pre",
        async transform(source, id) {
          if (!id.startsWith(`${projectRoot}/src/`) || !id.endsWith(".js")) return null;
          return transformWithEsbuild(source, id, { loader: "jsx", jsx: "automatic" });
        },
      }, {
        name: "storybook-idle-highlights",
        enforce: "pre",
        transform(source, id) {
          if (!/\/storybook\/dist\/(?:preview\/runtime|csf\/index)\.js$/.test(id)) return null;
          // Storybook 10 observes every story mutation even with no highlights.
          // React Flow's measured-node commit then re-registers a BODY resize
          // observer during resize delivery, producing a WebKit loop error.
          // Clear prior highlights, but do not watch mutations while idle.
          // Active highlights retain the upstream observer and cleanup paths.
          const marker = "elements.set(mapElements(value));\n    let observer = new MutationObserver";
          if (source.split(marker).length !== 2) {
            throw new Error(`Review the Storybook idle-highlight workaround after updating ${id}`);
          }
          return {
            code: source.replace(marker, "elements.set(mapElements(value));\n    if (value.length === 0) return;\n    let observer = new MutationObserver"),
            map: null,
          };
        },
      }, providerMetadata, react()],
      optimizeDeps: { esbuildOptions: { loader: { ".js": "jsx" } } },
      build: {
        commonjsOptions: {
          include: [/node_modules/, /src\/shared\/constants\/(mitmToolHosts|coworkPlugins)\.js$/],
        },
      },
      resolve: {
        alias: {
          // Mirror jsconfig.json ("@/*" -> "./src/*").
          "@": path.resolve(projectRoot, "src"),
          // Production client components may use these Next entry points. The
          // adapters are local Storybook boundaries, never production mocks.
          "next/navigation": path.resolve(storybookDir, "next-navigation.js"),
          "next/image": path.resolve(storybookDir, "next-image.jsx"),
          "next/link": path.resolve(storybookDir, "next-link.jsx"),
          "open-sse": path.resolve(projectRoot, "open-sse"),
        },
      },
      css: {
        // Make Vite pick up the project PostCSS config (Tailwind v4 via
        // @tailwindcss/postcss) explicitly from the worktree root.
        postcss: projectRoot,
      },
    });
  },
};

export default config;
