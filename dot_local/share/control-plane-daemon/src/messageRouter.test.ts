import { describe, expect, it } from 'vitest';
import { decideReply, UNKNOWN_COMMAND_REPLY } from './messageRouter.js';
import type { IncomingPost, RoutingContext } from './types.js';

const context: RoutingContext = {
  botUserId: 'bot-1',
  operatorUserId: 'jon-1',
  dmChannelId: 'dm-channel-1',
};

function post(overrides: Partial<IncomingPost> = {}): IncomingPost {
  return {
    id: 'post-1',
    userId: 'jon-1',
    channelId: 'dm-channel-1',
    message: 'list',
    createAt: 1000,
    ...overrides,
  };
}

describe('decideReply', () => {
  it('replies with the unknown-command message for any message from the operator in the DM channel', () => {
    const decision = decideReply(post({ message: 'anything at all' }), context);

    expect(decision).toEqual({ shouldReply: true, replyMessage: UNKNOWN_COMMAND_REPLY });
  });

  it('does not reply to the bot own posts, to avoid a self-reply loop', () => {
    const decision = decideReply(post({ userId: 'bot-1' }), context);

    expect(decision).toEqual({ shouldReply: false });
  });

  it('does not reply to posts from someone other than the operator', () => {
    const decision = decideReply(post({ userId: 'someone-else' }), context);

    expect(decision).toEqual({ shouldReply: false });
  });

  it('does not reply to posts outside the resolved DM channel', () => {
    const decision = decideReply(post({ channelId: 'some-other-channel' }), context);

    expect(decision).toEqual({ shouldReply: false });
  });

  it('the unknown-command reply points the operator at `help`', () => {
    expect(UNKNOWN_COMMAND_REPLY).toMatch(/help/);
  });
});
