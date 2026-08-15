/**
 * Minimal session-tracking abstraction (KAN-4). `start` (KAN-5) and `stop`
 * (KAN-6) don't exist yet -- neither does anything that spawns or manages a
 * real agent process -- so this store has no mutation methods yet and
 * nothing populates it with real data. It exists now so `list` (KAN-4) has
 * something real to read from, and so KAN-5/KAN-6 have an obvious interface
 * to extend (e.g. `addSession`/`endSession`) once they need to write to it,
 * rather than inventing session tracking from scratch under time pressure.
 *
 * Deliberately NOT speculative: no process-spawning, no persistence, no
 * mutation methods. Just enough shape for `list` to read and render.
 */
export type SessionStatus = 'running' | 'stopped';

export interface Session {
  /** Stable internal id. Distinct from `identifier`, which is what the operator sees and which can be renamed. */
  id: string;
  /** Operator-facing label: `#<n> : <hostName>` by default, or a renamed ticket identifier (e.g. `KAN-4`) once renamed. */
  identifier: string;
  host: string;
  status: SessionStatus;
  harness: string;
  folder: string;
}

export interface SessionStore {
  /**
   * All known sessions, running and stopped, in no particular order.
   * Callers that need a specific ordering (e.g. `list`'s running-before-
   * stopped requirement) sort the result themselves.
   */
  listSessions(): Session[];
}

/**
 * In-memory only -- unlike `StateStore`, nothing here needs to survive a
 * daemon restart yet. Sessions are backed by real OS processes (once
 * KAN-5/KAN-6 exist), so a restarted daemon can't trust a stale on-disk list
 * anyway without also re-verifying each process is still alive; that
 * reconciliation is out of scope here and left for whichever ticket adds
 * real process management.
 */
export function createInMemorySessionStore(): SessionStore {
  const sessions: Session[] = [];

  return {
    listSessions() {
      // Defensive copy: callers must not be able to corrupt store state by
      // mutating the array they get back.
      return [...sessions];
    },
  };
}
