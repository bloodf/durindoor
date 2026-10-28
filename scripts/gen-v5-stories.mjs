import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { toId, storyNameFromExport } from 'storybook/internal/csf';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'src/shared/ui/v5/stories');
function walk(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
}
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function exportNames(source) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  return ast.program.body.filter((node) => node.type === 'ExportNamedDeclaration')
    .flatMap((node) => node.declaration?.type === 'VariableDeclaration' ? node.declaration.declarations.map((declaration) => declaration.id.name) : node.declaration?.id ? [node.declaration.id.name] : node.specifiers.map((specifier) => specifier.exported.name));
}
const files = [
  ...walk(path.join(root, 'src/app')).filter((file) => /\.stories\.jsx$/.test(file) && !file.includes('/landing/')),
  ...walk(path.join(root, 'src/shared/components')).filter((file) => /\.stories\.jsx$/.test(file)),
  ...walk(path.join(root, 'src/shared/ui/components')).filter((file) => /\.stories\.jsx$/.test(file)),
  ...['preservation', 'usage', 'routes', 'combos', 'dashboards', 'login', 'providers', 'motion'].flatMap((folder) => existsSync(path.join(root, 'src/shared/ui/v5', folder)) ? walk(path.join(root, 'src/shared/ui/v5', folder)).filter((file) => /\.stories\.jsx$/.test(file)) : []),
].sort();
mkdirSync(directory, { recursive: true });
// Atomic replacements keep a running Storybook from indexing truncated CSF.
const generated = new Set();
const manifest = [];
for (const file of files) {
  const relative = path.relative(root, file);
  const source = readFileSync(file, 'utf8');
  const excluded = [...(source.match(/excludeStories:\s*\[([^\]]*)\]/)?.[1] || "").matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
  const names = exportNames(source).filter((name) => !excluded.includes(name));
  if (!names.length) throw new Error(`No explicit CSF exports: ${relative}`);
  const originalTitle = source.match(/title:\s*["']([^"']+)/)?.[1] || relative;
  const group = relative.startsWith('src/app/') ? 'Pages' : relative.includes('/preservation/') || relative.includes('/usage/') ? 'Scenarios' : relative.includes('/ui/components/') ? 'Components' : 'Workflows';
  const label = originalTitle.replace(/^(?:Durin DS\/)?Production(?: Pages)?\//, '').replace(/^Preservation\//, '');
  const title = `V5 review/${group}/${label}`;
  const key = slug(relative.replace(/\.stories\.jsx$/, ''));
  const pathname = source.match(/pathname:\s*["']([^"']+)/)?.[1] || '';
  const appRoute = relative.startsWith('src/app/') ? relative.replace(/^src\/app\//, '').replace(/^\(dashboard\)\//, '').replace(/\/[^/]+\.stories\.jsx$/, '') : '';
  const explicitRoute = source.match(/reviewRoute:\s*["']([^"']+)/)?.[1];
  const routePattern = explicitRoute || (appRoute && !appRoute.endsWith('components') ? `/${appRoute.replace(/\[[^\]]+\]/g, '[^/]+')}` : null);
  const standalone = /^\/(?:login|callback)/.test(pathname) || /\/layouts\//.test(relative) || /\/shell\//.test(originalTitle);
  const defaultName = names.find((name) => ['Default', 'Overview', 'Inventory', 'Loaded', 'Ready'].includes(name)) || names[0];
  const storyId = toId(title, storyNameFromExport(defaultName));
  const importPath = path.relative(directory, file).split(path.sep).join('/');
  const usageOverride = relative === 'src/app/(dashboard)/dashboard/usage/page.stories.jsx' && existsSync(path.join(root, 'src/shared/ui/v5/usage/ReviewUsagePage.jsx'));
  // The review usage composition needs reset, live sessions and key-limit routes beyond the original empty overview fixture.
  const usageParameters = usageOverride ? '{ ...originalMeta.parameters, storyFixture: usageFixture }' : 'originalMeta.parameters';
  const exports = names.map((name) => `export const ${name} = { ...reviewStory(original.${name}, ${JSON.stringify({source: relative, standalone})})${usageOverride ? `, parameters: reviewParameters({ ...originalMeta.parameters, ...original.${name}.parameters, storyFixture: usageFixture }, ${JSON.stringify({ source: relative, standalone })}), render: () => <ReviewUsagePage />` : ''} };`).join('\n');
  const code = `// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.\nimport React from 'react';\nimport originalMeta, * as original from ${JSON.stringify(importPath)};\nimport { reviewDecorator } from '../ReviewFrame.jsx';\nimport { reviewParameters, reviewStory } from '../review-parameters.js';\n${usageOverride ? "import ReviewUsagePage from '../usage/ReviewUsagePage.jsx';\nimport { usageFixture } from '../usage/fixtures.js';\n" : ''}const meta = { ...originalMeta, title: ${JSON.stringify(title)}, parameters: reviewParameters(${usageParameters}, ${JSON.stringify({ source: relative, standalone })}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };\nexport default meta;\n${exports}\n`;
  const output = `${key}.stories.jsx`;
  generated.add(output);
  writeFileSync(path.join(directory, `${output}.tmp`), code);
  renameSync(path.join(directory, `${output}.tmp`), path.join(directory, output));
  manifest.push({ source: relative, title, storyId, states: names, storyIds: names.map((name) => toId(title, storyNameFromExport(name))), pathname, routePattern, routePriority: explicitRoute ? 1 : 0, standalone });
}
for (const file of readdirSync(directory)) if (file.endsWith('.stories.jsx') && !generated.has(file)) rmSync(path.join(directory, file));
const manifestPath = path.join(root, 'src/shared/ui/v5/review-manifest.js');
writeFileSync(`${manifestPath}.tmp`, `// Generated by scripts/gen-v5-stories.mjs. Each entry retains its original CSF behavior.\nexport const REVIEW_SURFACES = ${JSON.stringify(manifest, null, 2)};\n`);
renameSync(`${manifestPath}.tmp`, manifestPath);
console.log(`Generated ${manifest.length} source-backed review surfaces with ${manifest.reduce((total, surface) => total + surface.states.length, 0)} scenarios.`);
