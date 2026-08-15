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
   */
  start(options: { folder: string; logger: Logger }): Promise<HarnessSessionHandle>;
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
}
