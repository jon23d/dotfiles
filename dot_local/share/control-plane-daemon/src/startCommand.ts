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
  'Usage: `start <harness> <folder>`\n' +
  `Harnesses: ${KNOWN_HARNESS_NAMES.join(', ')} (only \`opencode\` is implemented so far -- see KAN-5).\n` +
  'Example: `start opencode /home/jon/my-project`';

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
 */
export async function runStart(args: string[], deps: StartDeps): Promise<string> {
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

  let channelId: string;
  try {
    channelId = await deps.restClient.createPrivateChannel(teamId, channelSlug, identifier);
    await deps.restClient.addChannelMember(channelId, deps.operatorUserId);
  } catch (err) {
    deps.logger.error('failed to create the session channel -- stopping the now-orphaned harness session', {
      err,
      identifier,
    });
    handle.stop();
    return `Session started but its Mattermost channel could not be created (${errMessage(err)}). The session has been stopped -- nothing is left running.`;
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
  handle.onExit(({ code }) => {
    deps.logger.error('harness session exited -- marking it stopped', { identifier, channelId, code });
    deps.sessionStore.markStopped(session.id);
  });

  return `Started \`${identifier}\` (${harnessName} @ ${folder}). Continue the conversation in its new channel.`;
}
