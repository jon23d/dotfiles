import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileStateStore } from './stateStore.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'control-plane-daemon-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createFileStateStore', () => {
  it('returns null when no state file exists yet (fresh install, nothing to catch up on)', async () => {
    const store = createFileStateStore(join(dir, 'nested', 'state.json'));

    expect(await store.readLastSeenMs()).toBeNull();
  });

  it('writes and reads back the last-seen timestamp, creating parent directories as needed', async () => {
    const path = join(dir, 'nested', 'deeper', 'state.json');
    const store = createFileStateStore(path);

    await store.writeLastSeenMs(1_723_000_000_000);

    expect(await store.readLastSeenMs()).toBe(1_723_000_000_000);
  });

  it('overwrites the previous value on subsequent writes', async () => {
    const path = join(dir, 'state.json');
    const store = createFileStateStore(path);

    await store.writeLastSeenMs(100);
    await store.writeLastSeenMs(200);

    expect(await store.readLastSeenMs()).toBe(200);
  });

  it('persists valid JSON on disk (not a half-written/corrupt file) after write', async () => {
    const path = join(dir, 'state.json');
    const store = createFileStateStore(path);

    await store.writeLastSeenMs(42);

    const raw = await readFile(path, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('throws a clear error instead of silently returning null when the state file is corrupt', async () => {
    const path = join(dir, 'state.json');
    await writeFile(path, 'not json{{{', 'utf8');
    const store = createFileStateStore(path);

    await expect(store.readLastSeenMs()).rejects.toThrow(/state file/i);
  });
});
