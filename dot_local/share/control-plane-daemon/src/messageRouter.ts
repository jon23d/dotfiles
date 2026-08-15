import { commandRegistry } from './commands.js';
import { renderCommandDetail, renderCommandList } from './helpCommand.js';
import type { IncomingPost, ReplyDecision, RoutingContext } from './types.js';

/**
 * KAN-3 makes `help` a real command; `list`/`start`/`stop` are still not
 * implemented (KAN-4..KAN-6). Any message that isn't a registered command
 * gets this reply, per the ticket's acceptance criteria: a clear error
 * pointing at `help`, not a silent no-op.
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
 * live Mattermost connection.
 */
export function decideReply(post: IncomingPost, context: RoutingContext): ReplyDecision {
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

  return { shouldReply: true, replyMessage: UNKNOWN_COMMAND_REPLY };
}
