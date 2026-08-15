import { describe, expect, it } from 'vitest';
import { commandRegistry } from './commands.js';
import { decideReply, UNKNOWN_COMMAND_REPLY } from './messageRouter.js';
import type { Session, SessionStore } from './sessionStore.js';
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

/** No production SessionStore writes anything yet (KAN-5/KAN-6 land later), so
 * most tests here just need an empty one; the `list` tests below inject
 * fixture sessions the same way KAN-3's tests injected a fixture command
 * registry. */
function fakeSessionStore(sessions: Session[] = []): SessionStore {
  return { listSessions: () => sessions };
}

describe('decideReply', () => {
  it('replies with the unknown-command message for an unrecognized command', () => {
    const decision = decideReply(post({ message: 'anything at all' }), context, fakeSessionStore());

    expect(decision).toEqual({ shouldReply: true, replyMessage: UNKNOWN_COMMAND_REPLY });
  });

  it('does not reply to the bot own posts, to avoid a self-reply loop', () => {
    const decision = decideReply(post({ userId: 'bot-1' }), context, fakeSessionStore());

    expect(decision).toEqual({ shouldReply: false });
  });

  it('does not reply to posts from someone other than the operator', () => {
    const decision = decideReply(post({ userId: 'someone-else' }), context, fakeSessionStore());

    expect(decision).toEqual({ shouldReply: false });
  });

  it('does not reply to posts outside the resolved DM channel', () => {
    const decision = decideReply(post({ channelId: 'some-other-channel' }), context, fakeSessionStore());

    expect(decision).toEqual({ shouldReply: false });
  });

  it('the unknown-command reply points the operator at `help`', () => {
    expect(UNKNOWN_COMMAND_REPLY).toMatch(/help/);
  });

  describe('`help` with no arguments', () => {
    it('replies with every registered command and its one-line description', () => {
      const decision = decideReply(post({ message: 'help' }), context, fakeSessionStore());

      expect(decision.shouldReply).toBe(true);
      for (const command of commandRegistry) {
        expect(decision.replyMessage).toContain(`\`${command.name}\` - ${command.summary}`);
      }
    });

    it('is case-insensitive and tolerant of surrounding whitespace', () => {
      const decision = decideReply(post({ message: '  HELP  ' }), context, fakeSessionStore());

      expect(decision.replyMessage).toContain('`help`');
    });
  });

  describe('`help <command>`', () => {
    it('replies with that command\'s detailed usage when one is registered', () => {
      const helpEntry = commandRegistry.find((command) => command.name === 'help');
      const decision = decideReply(post({ message: 'help help' }), context, fakeSessionStore());

      expect(decision).toEqual({ shouldReply: true, replyMessage: helpEntry?.usage });
    });

    it('is case-insensitive for the target command name', () => {
      const helpEntry = commandRegistry.find((command) => command.name === 'help');
      const decision = decideReply(post({ message: 'help HELP' }), context, fakeSessionStore());

      expect(decision).toEqual({ shouldReply: true, replyMessage: helpEntry?.usage });
    });

    it('replies with a clear note (never an error) for an unrecognized command name', () => {
      const decision = decideReply(post({ message: 'help bogus' }), context, fakeSessionStore());

      expect(decision).toEqual({ shouldReply: true, replyMessage: 'No help available for `bogus`.' });
    });

    it('sanitizes backticks in an unrecognized target name so the reply keeps well-formed markdown', () => {
      const decision = decideReply(post({ message: 'help `x`' }), context, fakeSessionStore());

      expect(decision).toEqual({ shouldReply: true, replyMessage: 'No help available for `x`.' });
    });
  });

  describe('`list`', () => {
    it('replies with a clear "no sessions" message when the store is empty', () => {
      const decision = decideReply(post({ message: 'list' }), context, fakeSessionStore([]));

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).toMatch(/no sessions/i);
    });

    it('reads from the injected session store and lists running sessions above stopped ones', () => {
      const sessions: Session[] = [
        {
          id: 'sess-stopped',
          identifier: 'stopped-session',
          host: 'dev-vm',
          status: 'stopped',
          harness: 'claude-code',
          folder: '/home/jon/project-a',
        },
        {
          id: 'sess-running',
          identifier: '#2 : dev-vm',
          host: 'dev-vm',
          status: 'running',
          harness: 'opencode',
          folder: '/home/jon/project-b',
        },
      ];
      const decision = decideReply(post({ message: 'list' }), context, fakeSessionStore(sessions));

      expect(decision.shouldReply).toBe(true);
      const message = decision.replyMessage ?? '';
      expect(message).toContain('#2 : dev-vm');
      expect(message).toContain('opencode');
      expect(message).toContain('/home/jon/project-b');
      expect(message.indexOf('#2 : dev-vm')).toBeLessThan(message.indexOf('stopped-session'));
    });

    it('is case-insensitive and tolerant of surrounding whitespace', () => {
      const decision = decideReply(post({ message: '  LIST  ' }), context, fakeSessionStore([]));

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).toMatch(/no sessions/i);
    });
  });
});
