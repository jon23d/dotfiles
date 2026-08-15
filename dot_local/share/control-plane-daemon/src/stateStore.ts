import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

export interface LastSeen {
  ms: number;
  /**
   * Null only when read from a state file written before id tracking
   * existed (KAN-2 review F2) -- new writes always include it. Callers that
   * see null should fall back to the old exclusive `ms + 1` boundary rather
   * than dedupe-by-id, since there's no id to dedupe against.
   */
  id: string | null;
}

export interface StateStore {
  /** Returns null if no state has ever been written (fresh install). */
  readLastSeen(): Promise<LastSeen | null>;
  writeLastSeen(ms: number, id: string): Promise<void>;
}

const stateFileSchema = z.object({
  lastSeenMs: z.number(),
  // Optional so a state file written before this field existed still parses
  // instead of crash-looping the daemon on upgrade (see readLastSeen below).
  lastSeenId: z.string().min(1).optional(),
});

/**
 * Persists the id and create_at timestamp of the last post the daemon
 * successfully processed, so that a restart (crash, redeploy, VM reboot) can
 * catch up on anything sent while it was down instead of silently skipping
 * it -- this is what makes the "message is queued and processed on
 * recovery" acceptance criterion true across process restarts, not just
 * within one WS session. The id is tracked alongside the timestamp because
 * Mattermost's create_at has only millisecond resolution: two posts can
 * share a timestamp, and a boundary based on time alone can silently skip
 * (or reprocess) one of them (KAN-2 review F2).
 */
export function createFileStateStore(path: string): StateStore {
  return {
    async readLastSeen() {
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
      return { ms: result.data.lastSeenMs, id: result.data.lastSeenId ?? null };
    },

    async writeLastSeen(ms, id) {
      await mkdir(dirname(path), { recursive: true });
      const tmpPath = `${path}.tmp-${process.pid}`;
      await writeFile(tmpPath, JSON.stringify({ lastSeenMs: ms, lastSeenId: id }), 'utf8');
      await rename(tmpPath, path); // atomic on the same filesystem -- no half-written state file
    },
  };
}
