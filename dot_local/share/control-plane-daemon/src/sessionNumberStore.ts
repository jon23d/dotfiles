import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

export interface SessionNumberStore {
  /**
   * Allocates the next session number (starting at 1) and persists it before
   * returning, so a concurrent read never sees a number that could later be
   * reused. Every `start` call gets a strictly increasing number, even
   * across daemon restarts (KAN-5 AC: "`<n>` increments from the last-used
   * session number").
   */
  nextSessionNumber(): Promise<number>;
}

const counterFileSchema = z.object({ lastSessionNumber: z.number().int().nonnegative() });

/**
 * Persists the last-allocated session number to disk, following the exact
 * same pattern as `stateStore.ts`'s watermark file: same directory
 * convention, same atomic tmp-write-then-rename, same "throw loudly on a
 * corrupt file rather than silently resetting" behavior. A silent reset back
 * to 1 here would be worse than stateStore's equivalent bug -- it would mint
 * a session identifier (`#1 : host`) that collides with a still-remembered
 * (if now-stopped) earlier session, confusing the operator about which chat
 * is which.
 */
export function createFileSessionNumberStore(path: string): SessionNumberStore {
  return {
    async nextSessionNumber() {
      let current = 0;

      let raw: string | undefined;
      try {
        raw = await readFile(path, 'utf8');
      } catch (err) {
        if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err;
      }

      if (raw !== undefined) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (cause) {
          throw new Error(`control-plane-daemon session number file at ${path} is corrupt (invalid JSON)`, { cause });
        }
        const result = counterFileSchema.safeParse(parsed);
        if (!result.success) {
          throw new Error(`control-plane-daemon session number file at ${path} is corrupt (unexpected shape)`);
        }
        current = result.data.lastSessionNumber;
      }

      const next = current + 1;
      await mkdir(dirname(path), { recursive: true });
      const tmpPath = `${path}.tmp-${process.pid}`;
      await writeFile(tmpPath, JSON.stringify({ lastSessionNumber: next }), 'utf8');
      await rename(tmpPath, path); // atomic on the same filesystem -- no half-written counter file
      return next;
    },
  };
}
