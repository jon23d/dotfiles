import type { IncomingPost, ReplyDecision, RoutingContext } from './types.js';

/**
 * KAN-2 implements no real commands yet (those are KAN-3..KAN-7). Every
 * message the operator sends gets this reply, per the ticket's acceptance
 * criteria: a clear error pointing at `help`, not a silent no-op.
 */
export const UNKNOWN_COMMAND_REPLY = 'Unknown command. Try `help`.';

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
  return { shouldReply: true, replyMessage: UNKNOWN_COMMAND_REPLY };
}
