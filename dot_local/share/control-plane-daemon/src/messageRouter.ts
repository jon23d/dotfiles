import { commandRegistry } from './commands.js';
import { renderCommandDetail, renderCommandList } from './helpCommand.js';
import { renderSessionList } from './listCommand.js';
import { runStart } from './startCommand.js';
import { runStop } from './stopCommand.js';
import type { StartDeps } from './startCommand.js';
import type { IncomingPost, ReplyDecision, RoutingContext } from './types.js';

/**
 * KAN-3 makes `help` a real command, KAN-4 makes `list` one, KAN-5 makes
 * `start` one, and KAN-6 makes `stop` one. Any message that isn't a
 * registered command gets this reply, per the ticket's acceptance criteria:
 * a clear error pointing at `help`, not a silent no-op.
 */
export const UNKNOWN_COMMAND_REPLY = 'Unknown command. Try `help`.';

/**
 * Everything a command might need to produce its reply. `start` (KAN-5) is
 * the first command that does real I/O (spawning a harness process, calling
 * the Mattermost REST API, persisting a session number), which is why
 * `decideReply` below is async now -- `help`/`list` don't need any of it,
 * but the dispatch point has to be able to await whichever command actually
 * ran. Reusing `StartDeps` directly (rather than inventing a parallel
 * `RouterDeps` shape) keeps there being exactly one definition of "what a
 * command handler can depend on".
 */
export type RouterDeps = StartDeps;

/** Splits an operator message into a lowercased command name and its args. */
function parseCommand(message: string): { name: string; args: string[] } {
  const [name = '', ...args] = message.trim().split(/\s+/).filter(Boolean);
  return { name: name.toLowerCase(), args };
}

/**
 * Decide whether the daemon should respond to a given post, and with what.
 * No longer a pure function as of KAN-5 -- `start` needs real I/O (spawn a
 * harness process, call the Mattermost REST API, persist a session number)
 * -- but `help`/`list` are still synchronous under the hood and just resolve
 * immediately, so this is fully covered by unit tests the same way as
 * before, just with `await`.
 */
export async function decideReply(post: IncomingPost, context: RoutingContext, deps: RouterDeps): Promise<ReplyDecision> {
  if (post.userId === context.botUserId) {
    // Never reply to our own posts -- that's an infinite reply loop.
    return { shouldReply: false };
  }
  if (post.channelId !== context.dmChannelId) {
    return { shouldReply: false };
  }
  if (post.userId !== context.operatorUserId) {
    return { shouldReply: false };
  }

  const { name, args } = parseCommand(post.message);

  if (name === 'help') {
    const [target] = args;
    const replyMessage =
      target === undefined ? renderCommandList(commandRegistry) : renderCommandDetail(commandRegistry, target.toLowerCase());
    return { shouldReply: true, replyMessage };
  }

  if (name === 'list') {
    return { shouldReply: true, replyMessage: renderSessionList(deps.sessionStore.listSessions()) };
  }

  if (name === 'start') {
    const replyMessage = await runStart(args, deps);
    return { shouldReply: true, replyMessage };
  }

  if (name === 'stop') {
    // Replies into the control-plane DM (same as every other command here),
    // not the session's own channel -- by the time `stop` has done anything,
    // that channel's session is dead, so replying there would be a message
    // into a channel the operator has no reason to still be watching.
    const replyMessage = await runStop(args, deps);
    return { shouldReply: true, replyMessage };
  }

  return { shouldReply: true, replyMessage: UNKNOWN_COMMAND_REPLY };
}
