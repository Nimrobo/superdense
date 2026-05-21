import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearEnricherCache, registerEnricher } from '../index.js';
import { readUserEnrichers } from '../loader.js';

const tempDirs: string[] = [];

afterEach(async () => {
  clearEnricherCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'road42-enrichers-'));
  tempDirs.push(dir);
  return dir;
}

describe('readUserEnrichers', () => {
  it('loads a user enricher from a directory', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'word-count.mjs'), `
      export default {
        name: 'word_count',
        version: 1,
        returns: 'int',
        async run() { return 3; }
      };
    `);

    const enrichers = await readUserEnrichers(dir);
    expect(enrichers).toHaveLength(1);
    expect(enrichers[0]).toMatchObject({ name: 'word_count', version: 1, returns: 'int' });
  });

  it('skips invalid enrichers without throwing', async () => {
    const dir = await tempDir();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeFile(join(dir, 'bad.mjs'), 'export default { name: "bad" };');

    await expect(readUserEnrichers(dir)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects collisions with built-in enrichers', () => {
    expect(() => registerEnricher({
      name: 'event_count',
      version: 99,
      returns: 'int',
      async run() { return 0; },
    })).toThrow('enricher name collision');
  });
});
