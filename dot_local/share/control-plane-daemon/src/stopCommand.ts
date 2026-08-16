import { stripBackticks } from './markdown.js';
import type { Logger } from './logger.js';
import type { SessionRuntimeRegistry } from './sessionRuntime.js';
import type { SessionStore } from './sessionStore.js';

export interface StopDeps {
  sessionStore: SessionStore;
  sessionRuntime: SessionRuntimeRegistry;
  logger: Logger;
}

const USAGE = 'Usage: `stop <identifier>`\nExample: `stop #4 : devsix`';

/**
 * Implements `stop` (KAN-6): looks up a session by its operator-facing
 * `identifier` (not by channel -- `stop` is invoked from the control-plane
 * DM, so there is no session channel in scope the way `start`'s reply
 * lives in a channel it just created) and reuses KAN-5's existing
 * stop/markStopped machinery rather than reimplementing teardown.
 *
 * Argument parsing: messageRouter.ts's `parseCommand` splits the whole
 * message on whitespace, so an identifier containing spaces (the default
 * `#<n> : <hostName>` shape from startCommand.ts) arrives as several
 * separate tokens, e.g. `stop #4 : devsix` -> args = ['#4', ':', 'devsix'].
 * Rejoining with single spaces reconstructs the original identifier exactly,
 * since that's also how startCommand.ts builds it (`` `#${n} : ${host}` ``,
 * single spaces throughout) -- and it works unchanged for a future
 * single-token renamed identifier (e.g. `KAN-4`) too.
 *
 * Ordering matters for the operator-stop-vs-crash distinction: this marks
 * the session stopped in SessionStore *before* calling `handle.stop()`.
 * harness.ts's `HarnessSessionHandle.onExit` contract says a handle's exit
 * callback can fire as a *result* of `stop()` (not just an unrelated crash),
 * and startCommand.ts's onExit callback (registered once, at `start` time)
 * re-checks the session's current status via `sessionStore.findByChannelId`
 * when it fires. Marking stopped first means that by the time any resulting
 * exit event reaches that callback -- synchronously or later -- it always
 * finds the session already `stopped` and treats the exit as expected,
 * instead of posting a false "crashed unexpectedly" notice for a stop the
 * operator asked for themselves.
 *
 * Review note (kan6-1 F2): for opencode -- the only harness implemented
 * today -- that startCommand.ts guard is currently defensive/unreachable in
 * production rather than a fix for a bug that ever actually fired.
 * opencodeHarness.ts's `stop()` only does a `DELETE /session/:id` against
 * the shared `opencode serve` process; it never fires that individual
 * session's `onExit` callback (only the shared process's own death does,
 * which is unrelated to a single session's `stop()`). The ordering here
 * still matters and is still correct -- and becomes load-bearing the moment
 * a harness's `stop()` does fire `onExit` for the session it stopped.
 */
export async function runStop(args: string[], deps: StopDeps): Promise<string> {
  const target = args.join(' ').trim();
  if (target === '') {
    return `Which session? ${USAGE}`;
  }

  const session = deps.sessionStore.listSessions().find((s) => s.identifier.toLowerCase() === target.toLowerCase());

  if (!session) {
    return `No session found with identifier \`${stripBackticks(target)}\`.`;
  }

  if (session.status === 'stopped') {
    return `Session \`${session.identifier}\` is already stopped -- nothing to do.`;
  }

  const handle = session.channelId ? deps.sessionRuntime.get(session.channelId) : undefined;

  // Mark stopped before touching the handle at all -- see the ordering note
  // above. This also means `list` reflects the stop immediately even in the
  // no-handle branch below, where there is nothing left to terminate.
  deps.sessionStore.markStopped(session.id);

  if (!handle) {
    deps.logger.error('stopping a session with no live runtime handle -- marked stopped, nothing to terminate', {
      sessionId: session.id,
      identifier: session.identifier,
      channelId: session.channelId,
    });
    return `Internal error: \`${session.identifier}\` was marked running but had no live process to stop. It has been marked stopped.`;
  }

  handle.stop();
  if (session.channelId) deps.sessionRuntime.remove(session.channelId);

  return `Stopped \`${session.identifier}\`.`;
}
