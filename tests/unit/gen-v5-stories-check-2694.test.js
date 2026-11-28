import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
let copy;
const check = (cwd) => spawnSync(process.execPath, ['scripts/gen-v5-stories.mjs', '--check'], { cwd, encoding: 'utf8' });

describe('V5 story freshness check', () => {
  beforeAll(() => {
    copy = mkdtempSync(path.join(tmpdir(), 'v5-stories-'));
    cpSync(path.join(root, 'src'), path.join(copy, 'src'), { recursive: true });
    mkdirSync(path.join(copy, 'scripts'));
    cpSync(path.join(root, 'scripts/gen-v5-stories.mjs'), path.join(copy, 'scripts/gen-v5-stories.mjs'));
    symlinkSync(path.join(root, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
  });
  afterAll(() => { if (copy) rmSync(copy, { recursive: true, force: true }); });

  it('accepts the tracked tree', () => {
    const result = check(root);
    expect(result.status, result.stderr).toBe(0);
  });

  it('reports drift without modifying the copy', () => {
    const directory = path.join(copy, 'src/shared/ui/v5/stories');
    const name = readdirSync(directory).find((file) => file.endsWith('.stories.jsx'));
    const file = path.join(directory, name);
    const edited = `${readFileSync(file, 'utf8')}\n// drift\n`;
    writeFileSync(file, edited);
    const result = check(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`change src/shared/ui/v5/stories/${name}`);
    expect(readFileSync(file, 'utf8')).toBe(edited);
  });
});
