import type { Logger } from './logger.js';

/**
 * The seam between `start` and any concrete agent harness (opencode today;
 * Claude Code is deferred -- see opencodeHarness.ts / harnessRegistry.ts for
 * why). Mirrors how commands.ts's registry made adding `list` cheap: a new
 * harness means implementing one more `HarnessAdapter` and adding it to
 * `harnessRegistry`, not touching startCommand.ts's orchestration logic.
 */
export interface HarnessAdapter {
  readonly name: string;
  /**
   * Starts a brand-new session for this harness in `folder`. Must reject
   * with a clear, specific error (bad folder, process failed to start,
   * harness API unreachable, ...) rather than ever resolving with a handle
   * that isn't actually usable -- startCommand.ts relies on rejection being
   * the only failure signal, per the epic's "no silent failure" principle.
   *
   * `operatorUserId` (KAN-10) is who the operator is, resolved once at
   * daemon startup (resolveDmChannel.ts) -- genuinely process-wide (one
   * operator per VM, per this whole epic's design), unlike the channel id
   * below, which is inherently per-session. A concrete harness is free to
   * deliver it however suits its own mechanism (e.g. opencode's adapter
   * sets it as a real env var on its one shared server process, the same
   * place `CONTROL_PLANE_DAEMON` lives -- see opencodeHarness.ts).
   */
  start(options: { folder: string; operatorUserId: string; logger: Logger }): Promise<HarnessSessionHandle>;
}

/** A live handle to one running harness session. */
export interface HarnessSessionHandle {
  /** Forwards an operator chat message into this session. Rejects loudly on any delivery failure. */
  sendPrompt(message: string): Promise<void>;
  /** Best-effort termination of the underlying process. Never throws. */
  stop(): void;
  /**
   * Registers a callback fired exactly once, the first time the underlying
   * process exits for any reason (crash, `stop()`, or the harness itself
   * quitting) -- this is how the daemon learns a session died out from under
   * it and flips it to `stopped` in the SessionStore instead of `list`
   * lying about it still running.
   */
  onExit(callback: (info: { code: number | null }) => void): void;
  /**
   * Registers a callback fired every time the agent running inside this
   * session signals its own rename (KAN-7: "I picked up a ticket, rename my
   * chat to reflect that"). May fire zero times (never renamed), once, or
   * many times (AC2 -- the agent's work identity can change again later) --
   * callers must not assume this fires at most once, unlike `onExit`.
   * `identifier` is just the new work-identity part (e.g. `KAN-4`), not the
   * full `<identifier> : <hostName>` chat name -- appending the host suffix
   * and actually renaming the Mattermost channel is the caller's job
   * (startCommand.ts), not this harness's. Each concrete harness decides for
   * itself how its agent signals a rename (e.g. opencode's own session
   * title, watched over its event stream); this callback is the
   * harness-agnostic seam the rest of the daemon reacts to.
   */
  onRename(callback: (identifier: string) => void): void;
  /**
   * Registers a callback fired every time opencode reports this session's
   * in-flight request failed (KAN-13 review kan13-2 F5: opencode's own
   * `session.error` signal -- a provider/model rejection, auth failure, or
   * similar). Same "may fire more than once" posture as `onRename` above,
   * not `onExit`'s "fires exactly once" guarantee: a session can have
   * several failed requests over its lifetime (e.g. a pinned model that
   * stops resolving mid-conversation), and callers must not assume this
   * fires at most once. `error` is deliberately untyped -- opencode's own
   * error shape is a union of several distinct error types (`ProviderAuthError`,
   * `ContextOverflowError`, `APIError`, ...) that this seam only needs to pass
   * through, not branch on (see `sessionErrorEventSchema`'s doc comment in
   * opencodeHarness.ts). Each concrete harness decides for itself how it
   * detects this (opencode's own `session.error` SSE event); this callback is
   * the harness-agnostic seam startCommand.ts reacts to by posting an
   * operator-visible chat message into the session's own channel --
   * mirroring how `onExit`'s crash notice and the rename-failure notice
   * already reach the operator, per this epic's "never fail silently"
   * principle (daemon.ts:116-119). Before this callback existed, a
   * `session.error` only ever reached the daemon's own structured log, never
   * the operator's chat -- see review kan13-2 F5.
   */
  onError(callback: (info: { error: unknown }) => void): void;
  /**
   * Delivers this session's own Mattermost channel id (KAN-10) into wherever
   * this harness's in-session agent can reliably discover it -- called
   * exactly once, after `start()` already returned this handle, because
   * startCommand.ts doesn't know the channel id until *after* it creates the
   * Mattermost channel, which itself only happens after the harness session
   * already exists (there's nothing to add a channel member to, or name
   * after, before the harness session is running). The caller
   * (startCommand.ts) always awaits and checks this before registering the
   * session for message forwarding, so no prompt can ever reach the session
   * before this has resolved.
   *
   * Unlike `operatorUserId` on `start()`, this cannot be a process-wide
   * value: opencode's adapter runs every session through one shared server
   * process (KAN-5), so a channel id set as that process's env would leak
   * across every other session sharing it. Must reject loudly on failure
   * (e.g. couldn't write to the session's own folder) -- per the epic's "no
   * silent failure" principle, callers treat a rejection here exactly like
   * any other setup-step failure (stop the harness, don't leave a
   * half-wired session running) rather than letting the session start
   * without ever confirming this value actually landed.
   */
  provisionChannelId(channelId: string): Promise<void>;
}
