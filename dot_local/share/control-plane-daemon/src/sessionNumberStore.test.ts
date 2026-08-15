import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileSessionNumberStore } from './sessionNumberStore.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'control-plane-daemon-sessionnum-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createFileSessionNumberStore', () => {
  it('starts at 1 when no counter file exists yet (fresh install)', async () => {
    const store = createFileSessionNumberStore(join(dir, 'nested', 'session-number.json'));

    expect(await store.nextSessionNumber()).toBe(1);
  });

  it('increments on every call, persisting each new value', async () => {
    const path = join(dir, 'session-number.json');
    const store = createFileSessionNumberStore(path);

    expect(await store.nextSessionNumber()).toBe(1);
    expect(await store.nextSessionNumber()).toBe(2);
    expect(await store.nextSessionNumber()).toBe(3);
  });

  it('continues from the persisted value across separate store instances (e.g. a daemon restart)', async () => {
    const path = join(dir, 'session-number.json');
    await createFileSessionNumberStore(path).nextSessionNumber(); // -> 1
    await createFileSessionNumberStore(path).nextSessionNumber(); // -> 2

    const restarted = createFileSessionNumberStore(path);

    expect(await restarted.nextSessionNumber()).toBe(3);
  });

  it('persists valid JSON on disk after each allocation', async () => {
    const path = join(dir, 'session-number.json');
    const store = createFileSessionNumberStore(path);

    await store.nextSessionNumber();

    const raw = await readFile(path, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('creates parent directories as needed', async () => {
    const path = join(dir, 'a', 'b', 'c', 'session-number.json');
    const store = createFileSessionNumberStore(path);

    await expect(store.nextSessionNumber()).resolves.toBe(1);
  });

  it('throws a clear error instead of silently resetting to 1 when the counter file is corrupt', async () => {
    const path = join(dir, 'session-number.json');
    await writeFile(path, 'not json{{{', 'utf8');
    const store = createFileSessionNumberStore(path);

    await expect(store.nextSessionNumber()).rejects.toThrow(/session number/i);
  });

  it('throws a clear error when the counter file has an unexpected shape', async () => {
    const path = join(dir, 'session-number.json');
    await writeFile(path, JSON.stringify({ somethingElse: true }), 'utf8');
    const store = createFileSessionNumberStore(path);

    await expect(store.nextSessionNumber()).rejects.toThrow(/session number/i);
  });
});
