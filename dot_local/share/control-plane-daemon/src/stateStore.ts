import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

export interface StateStore {
  /** Returns null if no state has ever been written (fresh install). */
  readLastSeenMs(): Promise<number | null>;
  writeLastSeenMs(ms: number): Promise<void>;
}

const stateFileSchema = z.object({ lastSeenMs: z.number() });

/**
 * Persists the create_at timestamp of the last post the daemon successfully
 * processed, so that a restart (crash, redeploy, VM reboot) can catch up on
 * anything sent while it was down instead of silently skipping it -- this is
 * what makes the "message is queued and processed on recovery" acceptance
 * criterion true across process restarts, not just within one WS session.
 */
export function createFileStateStore(path: string): StateStore {
  return {
    async readLastSeenMs() {
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
        throw err;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (cause) {
        throw new Error(`control-plane-daemon state file at ${path} is corrupt (invalid JSON)`, { cause });
      }

      const result = stateFileSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`control-plane-daemon state file at ${path} is corrupt (unexpected shape)`);
      }
      return result.data.lastSeenMs;
    },

    async writeLastSeenMs(ms) {
      await mkdir(dirname(path), { recursive: true });
      const tmpPath = `${path}.tmp-${process.pid}`;
      await writeFile(tmpPath, JSON.stringify({ lastSeenMs: ms }), 'utf8');
      await rename(tmpPath, path); // atomic on the same filesystem -- no half-written state file
    },
  };
}
