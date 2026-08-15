import { commandRegistry } from './commands.js';
import { renderCommandDetail, renderCommandList } from './helpCommand.js';
import { renderSessionList } from './listCommand.js';
import type { SessionStore } from './sessionStore.js';
import type { IncomingPost, ReplyDecision, RoutingContext } from './types.js';

/**
 * KAN-3 makes `help` a real command and KAN-4 makes `list` one too;
 * `start`/`stop` are still not implemented (KAN-5/KAN-6). Any message that
 * isn't a registered command gets this reply, per the ticket's acceptance
 * criteria: a clear error pointing at `help`, not a silent no-op.
 */
export const UNKNOWN_COMMAND_REPLY = 'Unknown command. Try `help`.';

/** Splits an operator message into a lowercased command name and its args. */
function parseCommand(message: string): { name: string; args: string[] } {
  const [name = '', ...args] = message.trim().split(/\s+/).filter(Boolean);
  return { name: name.toLowerCase(), args };
}

/**
 * Decide whether the daemon should respond to a given post, and with what.
 * Pure function -- no I/O -- so it's fully covered by unit tests without a
 * live Mattermost connection. `sessionStore` is read synchronously (just
 * like `context` is resolved once at startup) so this stays synchronous and
 * testable the same way `context` already is; KAN-5/KAN-6 populate it, this
 * ticket only reads from it.
 */
export function decideReply(post: IncomingPost, context: RoutingContext, sessionStore: SessionStore): ReplyDecision {
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
    return { shouldReply: true, replyMessage: renderSessionList(sessionStore.listSessions()) };
  }

  return { shouldReply: true, replyMessage: UNKNOWN_COMMAND_REPLY };
}
