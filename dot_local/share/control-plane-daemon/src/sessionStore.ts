/**
 * Session-tracking abstraction. KAN-4 left this with no mutation methods on
 * purpose, "so KAN-5/KAN-6 have an obvious interface to extend... rather
 * than inventing session tracking from scratch under time pressure." KAN-5
 * (`start`) is that extension: it adds `addSession` (a session is born once
 * its opencode process AND its Mattermost channel both exist -- see
 * startCommand.ts) and `markStopped` (flipped when the daemon detects the
 * underlying harness process has exited, so `list` doesn't keep showing a
 * dead session as running). `findByChannelId` is what lets daemon.ts route
 * an incoming post in a session's dedicated channel to that session
 * specifically, rather than treating it as an unrecognized command (KAN-5
 * AC3).
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
  /**
   * The Mattermost channel dedicated to this session (KAN-5). Optional so
   * pre-KAN-5 fixtures/tests that only cared about `list` rendering (which
   * never shows this field) don't all need updating; real sessions created
   * by `start` always set it -- it's how daemon.ts finds which session an
   * incoming post outside the control-plane DM belongs to.
   */
  channelId?: string;
}

export interface SessionStore {
  /**
   * All known sessions, running and stopped, in no particular order.
   * Callers that need a specific ordering (e.g. `list`'s running-before-
   * stopped requirement) sort the result themselves.
   */
  listSessions(): Session[];
  /** Registers a newly created session (KAN-5 `start`). */
  addSession(session: Session): void;
  /** Looks up the session whose dedicated chat channel is `channelId`, or undefined if none (KAN-5 message routing). */
  findByChannelId(channelId: string): Session | undefined;
  /**
   * Flips a session's status to `stopped`. A no-op (not a throw) for an
   * unknown id -- the caller (e.g. a harness process' `exit` handler) races
   * against nothing else here, and treating "already gone" as an error
   * would be more surprising than useful.
   */
  markStopped(sessionId: string): void;
  /**
   * Replaces a session's `identifier` (KAN-7: the agent running inside the
   * session renamed its own chat once it knew a concrete work identity, e.g.
   * a ticket key). Callable more than once per session -- AC2 requires the
   * name to keep tracking the agent's current work identity, not just the
   * first rename. Same no-op-on-unknown-id convention as `markStopped`.
   */
  renameSession(sessionId: string, newIdentifier: string): void;
}

/**
 * In-memory only -- unlike `StateStore`, nothing here needs to survive a
 * daemon restart yet. Sessions are backed by real OS processes (KAN-5), so a
 * restarted daemon can't trust a stale on-disk list anyway without also
 * re-verifying each process is still alive; that reconciliation is out of
 * scope here and left for whichever ticket adds it (a restart currently just
 * loses track of previously-running sessions, same as before KAN-5).
 */
export function createInMemorySessionStore(): SessionStore {
  const sessions: Session[] = [];

  return {
    listSessions() {
      // Defensive copy: callers must not be able to corrupt store state by
      // mutating the array they get back.
      return [...sessions];
    },

    addSession(session) {
      sessions.push(session);
    },

    findByChannelId(channelId) {
      return sessions.find((s) => s.channelId === channelId);
    },

    markStopped(sessionId) {
      const found = sessions.find((s) => s.id === sessionId);
      if (found) found.status = 'stopped';
    },

    renameSession(sessionId, newIdentifier) {
      const found = sessions.find((s) => s.id === sessionId);
      if (found) found.identifier = newIdentifier;
    },
  };
}
