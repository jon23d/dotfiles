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

    expect(await store.readLastSeen()).toBeNull();
  });

  it('writes and reads back the last-seen timestamp and id, creating parent directories as needed', async () => {
    const path = join(dir, 'nested', 'deeper', 'state.json');
    const store = createFileStateStore(path);

    await store.writeLastSeen(1_723_000_000_000, 'post-abc');

    expect(await store.readLastSeen()).toEqual({ ms: 1_723_000_000_000, id: 'post-abc' });
  });

  it('overwrites the previous value on subsequent writes', async () => {
    const path = join(dir, 'state.json');
    const store = createFileStateStore(path);

    await store.writeLastSeen(100, 'post-1');
    await store.writeLastSeen(200, 'post-2');

    expect(await store.readLastSeen()).toEqual({ ms: 200, id: 'post-2' });
  });

  it('persists valid JSON on disk (not a half-written/corrupt file) after write', async () => {
    const path = join(dir, 'state.json');
    const store = createFileStateStore(path);

    await store.writeLastSeen(42, 'post-1');

    const raw = await readFile(path, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('throws a clear error instead of silently returning null when the state file is corrupt', async () => {
    const path = join(dir, 'state.json');
    await writeFile(path, 'not json{{{', 'utf8');
    const store = createFileStateStore(path);

    await expect(store.readLastSeen()).rejects.toThrow(/state file/i);
  });

  it('reads a legacy state file (written before id tracking existed) with id as null', async () => {
    const path = join(dir, 'state.json');
    await writeFile(path, JSON.stringify({ lastSeenMs: 1_723_000_000_000 }), 'utf8');
    const store = createFileStateStore(path);

    expect(await store.readLastSeen()).toEqual({ ms: 1_723_000_000_000, id: null });
  });
});
