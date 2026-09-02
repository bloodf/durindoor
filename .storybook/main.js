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
  stories: ["../src/shared/ui/**/*.stories.jsx"],
  addons: [],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["../public"],
  viteFinal: async (viteConfig) => {
    const { mergeConfig } = await import("vite");
    // Automatic JSX runtime — without this plugin the preview pipeline falls
    // back to esbuild's classic transform (`React.createElement`) and every
    // story throws "React is not defined" at runtime.
    const { default: react } = await import("@vitejs/plugin-react");
    return mergeConfig(viteConfig, {
      plugins: [react()],
      resolve: {
        alias: {
          // Mirror jsconfig.json ("@/*" -> "./src/*").
          "@": path.resolve(projectRoot, "src"),
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
