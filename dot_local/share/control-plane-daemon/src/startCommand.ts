import { randomUUID } from 'node:crypto';
import { KNOWN_HARNESS_NAMES } from './harnessRegistry.js';
import { stripBackticks } from './markdown.js';
import type { HarnessAdapter } from './harness.js';
import type { KnownHarnessName } from './harnessRegistry.js';
import type { Logger } from './logger.js';
import type { MattermostRestClient } from './mattermostRestClient.js';
import type { SessionRuntimeRegistry } from './sessionRuntime.js';
import type { Session, SessionStore } from './sessionStore.js';

export interface StartDeps {
  restClient: MattermostRestClient;
  sessionStore: SessionStore;
  sessionRuntime: SessionRuntimeRegistry;
  harnesses: Partial<Record<KnownHarnessName, HarnessAdapter>>;
  /** Allocates and persists the next session number (sessionNumberStore.ts). */
  allocateSessionNumber: () => Promise<number>;
  logger: Logger;
  /** The VM's hostname -- AC2: the new chat is named `#<n> : <hostName>`. */
  hostname: string;
  operatorUserId: string;
}

const USAGE =
  'Usage: `start <harness> <folder> [--force]`\n' +
  `Harnesses: ${KNOWN_HARNESS_NAMES.join(', ')} (only \`opencode\` is implemented so far -- see KAN-5).\n` +
  'Example: `start opencode /home/jon/my-project`\n' +
  '`--force` (KAN-8) starts anyway even if a session is already running on this VM; without it, `start` refuses ' +
  'while any session is running.';

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Turns `#4 : devsix` into a valid Mattermost channel name slug: lowercase,
 * `[a-z0-9-]` only, capped at Mattermost's 64-character channel name limit. */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'session').slice(0, 64);
}

function isKnownHarnessName(name: string): name is KnownHarnessName {
  return (KNOWN_HARNESS_NAMES as readonly string[]).includes(name);
}

const FORCE_FLAG = '--force';

/**
 * Builds the KAN-8 refusal reply naming every currently-running session's
 * identifier -- per the AC's last bullet, more than one running session
 * (possible today, since nothing before this ticket prevented it) must not
 * be silently collapsed down to just the first one found. Backticks are
 * stripped the same way startCommand.ts already sanitizes agent-controlled
 * identifiers elsewhere (see performRename below, and kan7-1 F1): a session
 * identifier can itself contain a backtick after a KAN-7 rename, and it's
 * about to be interpolated into a backtick-quoted span here.
 */
function formatAlreadyRunningReply(runningSessions: readonly Session[]): string {
  const names = runningSessions.map((session) => `\`${stripBackticks(session.identifier)}\``).join(', ');
  const pronoun = runningSessions.length > 1 ? 'them' : 'it';
  return `A session is already running (${names}). Stop ${pronoun} first, or add \`${FORCE_FLAG}\` to start anyway.`;
}

/**
 * Implements `start` (KAN-5): spawns a harness session, opens its dedicated
 * Mattermost channel, and only registers the session once BOTH have
 * succeeded -- per AC4, "no session or chat is created" on any failure
 * along the way. Order matters here specifically to fail fast and cheap:
 * argument/harness/folder problems and the known KAN-5 team-membership
 * blocker are all checked before a session number is burned or any process
 * is spawned; only a channel-creation failure after the harness already
 * started requires cleanup (stopping the harness session that has nothing
 * to talk to it anymore).
 *
 * No multi-turn conversation state: sending bare `start` (or `start
 * <harness>` with no folder) satisfies AC1's "I'm asked... which harness...
 * and folder" by replying with usage instead of opening a stateful wizard --
 * the daemon's command dispatch is otherwise a stateless one-message-in,
 * one-reply-out design (see messageRouter.ts), and a multi-turn wizard would
 * be a much bigger architectural change than this ticket's scope warrants.
 *
 * KAN-8: before any of the above, refuses outright if a session is already
 * running on this VM and `--force` wasn't given -- a pre-check, not a mutex.
 * `--force` is recognized anywhere in `args` (not just trailing), matching
 * how messageRouter.ts's `parseCommand` already treats the whole command as
 * a flat whitespace-delimited token list rather than inventing a new,
 * order-sensitive flag convention; it's stripped out before the existing
 * positional harness/folder parsing runs, so `start opencode /path --force`
 * and `start --force opencode /path` behave identically. The running-session
 * check itself runs before harness/folder validation ("before that whole
 * flow begins" -- refuse immediately, touch nothing: no team lookup, no
 * session-number allocation, no harness spawn, no Mattermost call).
 */
export async function runStart(rawArgs: string[], deps: StartDeps): Promise<string> {
  const force = rawArgs.includes(FORCE_FLAG);
  const args = rawArgs.filter((arg) => arg !== FORCE_FLAG);

  if (!force) {
    const runningSessions = deps.sessionStore.listSessions().filter((session) => session.status === 'running');
    if (runningSessions.length > 0) {
      return formatAlreadyRunningReply(runningSessions);
    }
  }

  const [harnessArg, folderArg] = args;
  if (harnessArg === undefined || folderArg === undefined) {
    return `Which harness and which folder? ${USAGE}`;
  }

  const harnessName = harnessArg.toLowerCase();
  if (!isKnownHarnessName(harnessName)) {
    return `Unknown harness \`${stripBackticks(harnessName)}\`. Valid harnesses: ${KNOWN_HARNESS_NAMES.join(', ')}.`;
  }

  const adapter = deps.harnesses[harnessName];
  if (!adapter) {
    return `Harness \`${harnessName}\` is recognized but not implemented yet -- only \`opencode\` works this round (see KAN-5).`;
  }

  const folder = folderArg;

  // Resolve the team to create the channel in before spawning anything --
  // this is where the known KAN-5 blocker (bot belongs to zero Mattermost
  // teams) surfaces, and it should fail fast/cheap rather than after
  // burning a session number or starting a real process.
  let teamId: string;
  try {
    const teams = await deps.restClient.getMyTeams();
    const [firstTeam] = teams;
    if (!firstTeam) {
      return (
        "Can't start a session: the bot doesn't belong to any Mattermost team, so it has nowhere to create a " +
        'session channel. Ask an admin to add it to a team, then try again.'
      );
    }
    // Simple policy: use whichever team the bot belongs to first. Picking
    // between multiple teams isn't specified by KAN-5 and is out of scope
    // (see KAN-5's "Multi-VM session placement" out-of-scope note) --
    // revisit if/when the bot is ever added to more than one team.
    teamId = firstTeam.id;
  } catch (err) {
    deps.logger.error("failed to look up the bot's Mattermost team membership for `start`", { err });
    return `Can't start a session: failed to look up the bot's Mattermost team membership (${errMessage(err)}).`;
  }

  const sessionNumber = await deps.allocateSessionNumber();
  const identifier = `#${sessionNumber} : ${deps.hostname}`;
  const channelSlug = slugify(`session-${sessionNumber}-${deps.hostname}`);

  let handle;
  try {
    handle = await adapter.start({ folder, logger: deps.logger });
  } catch (err) {
    deps.logger.error('failed to start harness session', { err, harness: harnessName, folder, identifier });
    return `Could not start a \`${harnessName}\` session in \`${stripBackticks(folder)}\`: ${errMessage(err)}`;
  }

  // Split into two try/catches (review kan5-1 F3): `createPrivateChannel`
  // and `addChannelMember` fail differently and need different responses.
  // If channel creation itself fails, nothing was created and there's
  // nothing to clean up beyond the harness session. If only adding the
  // operator fails, the channel WAS created -- claiming otherwise in the
  // reply would be false, and leaving that channel behind (with only the
  // bot as a member, since the operator was never added) would leak it:
  // nothing in SessionStore references it, so it's invisible to `list` and
  // to the operator, and would never be cleaned up on its own.
  let channelId: string;
  try {
    channelId = await deps.restClient.createPrivateChannel(teamId, channelSlug, identifier);
  } catch (err) {
    deps.logger.error('failed to create the session channel -- stopping the now-orphaned harness session', {
      err,
      identifier,
    });
    handle.stop();
    return `Session started but its Mattermost channel could not be created (${errMessage(err)}). The session has been stopped -- nothing is left running.`;
  }

  try {
    await deps.restClient.addChannelMember(channelId, deps.operatorUserId);
  } catch (err) {
    deps.logger.error(
      'failed to add the operator to the new session channel -- stopping the session and archiving the now-orphaned channel',
      { err, identifier, channelId },
    );
    handle.stop();
    // Best-effort cleanup: the channel may still be left behind if this
    // itself fails (a human will need to archive it manually), but that
    // failure must never mask the real, original `addChannelMember` error
    // the operator needs to see -- it's only logged, not rethrown. The
    // reply below branches on whether the archive actually succeeded
    // (review kan5-2 F5: the previous unconditional "cleaned up" message
    // was itself false whenever this catch fired, the same category of
    // "operator told something false about an orphaned resource" defect
    // the addChannelMember branch above exists to avoid).
    let archived = true;
    try {
      await deps.restClient.archiveChannel(channelId);
    } catch (archiveErr) {
      archived = false;
      deps.logger.error('failed to archive the orphaned session channel (best-effort cleanup)', {
        err: archiveErr,
        channelId,
      });
    }
    const cleanupNote = archived
      ? 'The session has been stopped and the channel has been cleaned up.'
      : 'The session has been stopped, but the channel could not be automatically cleaned up and will need manual removal.';
    return `Session and its channel \`${identifier}\` were created, but adding you to the channel failed (${errMessage(err)}). ${cleanupNote}`;
  }

  const session: Session = {
    id: randomUUID(),
    identifier,
    host: deps.hostname,
    status: 'running',
    harness: harnessName,
    folder,
    channelId,
  };
  deps.sessionStore.addSession(session);
  deps.sessionRuntime.register(channelId, handle);

  // KAN-7: the agent running inside this session can rename its own chat --
  // e.g. once it picks up a ticket -- by signaling the harness (opencode's
  // adapter watches its own session-title mechanism; see opencodeHarness.ts).
  // `deps.sessionStore` is the single source of truth for the session's
  // *current* identifier (rather than a second variable tracked in this
  // closure), so a failure message after a prior successful rename always
  // reports the name the channel actually has right now.
  async function performRename(newTitle: string): Promise<void> {
    const newIdentifier = `${newTitle} : ${deps.hostname}`;
    const newChannelSlug = slugify(`session-${sessionNumber}-${newTitle}`);
    try {
      await deps.restClient.renameChannel(channelId, newChannelSlug, newIdentifier);
      deps.sessionStore.renameSession(session.id, newIdentifier);
      deps.logger.info('renamed session chat at the agent\'s request', {
        sessionId: session.id,
        channelId,
        newIdentifier,
      });
    } catch (err) {
      // AC3: a failed rename (permissions, name collision, ...) must be
      // surfaced, not left as a silently-stale name -- and must not be
      // retried automatically forever, so this is a one-shot attempt per
      // signal. If the agent still wants the new name, its own retry of
      // the underlying signal (e.g. PATCHing its opencode session title
      // again) naturally produces another signal here.
      deps.logger.error('failed to rename session chat at the agent\'s request', {
        err,
        sessionId: session.id,
        channelId,
        attemptedIdentifier: newIdentifier,
      });
      const stillNamed = deps.sessionStore.findByChannelId(channelId)?.identifier ?? identifier;
      // Both interpolated values ultimately derive from the agent-set
      // `newTitle` (review kan7-1 F1, same class of issue as kan3-1 F1 /
      // kan4-1 F1) -- strip backticks so it can't break out of the
      // backtick-quoted span it's placed in.
      try {
        await deps.restClient.createPost(
          channelId,
          `Could not rename this chat to \`${stripBackticks(newIdentifier)}\`: ${errMessage(err)}. It is still named \`${stripBackticks(stillNamed)}\`.`,
        );
      } catch (postErr) {
        deps.logger.error('failed to post rename-failure notice', { err: postErr, channelId });
      }
    }
  }

  // Serializes rename attempts (review kan7-1 F2): without this, two
  // `onRename` fires in quick succession (AC2's own scenario -- opencode's
  // SSE handler invokes the callback synchronously per event, no await in
  // between) would each kick off an independent, concurrent `renameChannel`
  // request whose completion order isn't guaranteed to match firing order,
  // letting `sessionStore.renameSession` end up called with the OLDER
  // identifier after the newer one. Chaining each new attempt onto the
  // promise of the prior one means the second request is never even
  // *issued* until the first has fully settled (success or failure), so
  // store updates always happen in true chronological (fire) order.
  let renameChain: Promise<void> = Promise.resolve();
  handle.onRename((newTitle) => {
    renameChain = renameChain.then(() => performRename(newTitle));
  });

  handle.onExit(({ code }) => {
    // Operator-initiated stop vs. unexpected crash (KAN-6): stopCommand.ts's
    // `runStop` marks the session `stopped` in SessionStore *before* it ever
    // calls `handle.stop()`, specifically so that whenever this callback
    // fires as a result of that stop -- synchronously or later -- it finds
    // the session already stopped here and can tell the two cases apart.
    // Re-checking via `findByChannelId` (rather than trusting a boolean
    // captured in this closure) means this also correctly recognizes a stop
    // that happened at any point before this fires, not just one that
    // happens to race a specific flag.
    //
    // Review note (kan6-1 F2): for opencode -- the only harness implemented
    // today -- this branch is currently unreachable in production, not a fix
    // for a bug that was ever live there. opencodeHarness.ts's `stop()` only
    // issues a `DELETE /session/:id` against the shared `opencode serve`
    // process; it never calls `notifyExit`/fires `exitCallbacks` for that
    // one session. This handle's `onExit` only ever fires when the *whole
    // shared process* dies (see opencodeHarness.ts's `child.on('exit', ...)`
    // -> `notifyExit`), which has nothing to do with a single session's
    // `stop()`. So today, an operator `stop` on an opencode session never
    // triggers this callback at all -- this guard is purely forward-looking
    // (a future harness, or a change to opencode's own `stop()`) rather than
    // closing a gap that currently fires.
    const current = deps.sessionStore.findByChannelId(channelId);
    // Prefer the store's current identifier over this closure's `identifier`
    // constant, which is frozen at the session's default `#<n> : <hostName>`
    // name -- KAN-7 can have renamed it since, and the store is the single
    // source of truth for "what this session is called right now". Falls
    // back to the original `identifier` only if the store has no record at
    // all (shouldn't happen for a session `runStart` itself just added, but
    // keeps this resilient rather than crashing on a stale-data edge case).
    const displayIdentifier = current?.identifier ?? identifier;
    if (current !== undefined && current.status === 'stopped') {
      deps.logger.info('harness session exited after an operator-initiated stop -- no crash notice needed', {
        identifier: displayIdentifier,
        channelId,
        code,
      });
      return;
    }

    deps.logger.error('harness session exited -- marking it stopped and notifying the operator', {
      identifier: displayIdentifier,
      channelId,
      code,
    });
    deps.sessionStore.markStopped(session.id);
    // Proactive, not reactive (review kan5-1 F4): without this, the
    // operator only learns a session died the next time they happen to
    // message its now-dead channel (daemon.ts's forwardToSessionIfApplicable
    // handles that reactive case). Fire-and-forget, loudly logged on
    // failure -- this callback is synchronous void per HarnessSessionHandle,
    // so nothing here can be awaited by the caller.
    deps.restClient
      .createPost(channelId, `Session \`${displayIdentifier}\` crashed unexpectedly and is no longer running.`)
      .catch((err: unknown) => {
        deps.logger.error('failed to notify the operator that a session crashed', { err, identifier: displayIdentifier, channelId });
      });
  });

  return `Started \`${identifier}\` (${harnessName} @ ${folder}). Continue the conversation in its new channel.`;
}
