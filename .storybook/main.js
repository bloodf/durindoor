import path from "node:path";
import { fileURLToPath } from "node:url";

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
      plugins: [{
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
