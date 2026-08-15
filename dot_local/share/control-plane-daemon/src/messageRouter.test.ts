import { describe, expect, it } from 'vitest';
import { commandRegistry } from './commands.js';
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
    message: 'help',
    createAt: 1000,
    ...overrides,
  };
}

describe('decideReply', () => {
  it('replies with the unknown-command message for an unrecognized command', () => {
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

  describe('`help` with no arguments', () => {
    it('replies with every registered command and its one-line description', () => {
      const decision = decideReply(post({ message: 'help' }), context);

      expect(decision.shouldReply).toBe(true);
      for (const command of commandRegistry) {
        expect(decision.replyMessage).toContain(`\`${command.name}\` - ${command.summary}`);
      }
    });

    it('is case-insensitive and tolerant of surrounding whitespace', () => {
      const decision = decideReply(post({ message: '  HELP  ' }), context);

      expect(decision.replyMessage).toContain('`help`');
    });
  });

  describe('`help <command>`', () => {
    it('replies with that command\'s detailed usage when one is registered', () => {
      const helpEntry = commandRegistry.find((command) => command.name === 'help');
      const decision = decideReply(post({ message: 'help help' }), context);

      expect(decision).toEqual({ shouldReply: true, replyMessage: helpEntry?.usage });
    });

    it('is case-insensitive for the target command name', () => {
      const helpEntry = commandRegistry.find((command) => command.name === 'help');
      const decision = decideReply(post({ message: 'help HELP' }), context);

      expect(decision).toEqual({ shouldReply: true, replyMessage: helpEntry?.usage });
    });

    it('replies with a clear note (never an error) for an unrecognized command name', () => {
      const decision = decideReply(post({ message: 'help bogus' }), context);

      expect(decision).toEqual({ shouldReply: true, replyMessage: 'No help available for `bogus`.' });
    });

    it('sanitizes backticks in an unrecognized target name so the reply keeps well-formed markdown', () => {
      const decision = decideReply(post({ message: 'help `x`' }), context);

      expect(decision).toEqual({ shouldReply: true, replyMessage: 'No help available for `x`.' });
    });
  });
});
