import { describe, expect, it, vi } from 'vitest';
import { commandRegistry } from './commands.js';
import { decideReply, UNKNOWN_COMMAND_REPLY } from './messageRouter.js';
import type { RouterDeps } from './messageRouter.js';
import type { HarnessAdapter, HarnessSessionHandle } from './harness.js';
import type { Logger } from './logger.js';
import type { MattermostRestClient, Team } from './mattermostRestClient.js';
import type { SessionRuntimeRegistry } from './sessionRuntime.js';
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

function silentLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function fakeSessionStore(sessions: Session[] = []): SessionStore {
  return {
    listSessions: () => sessions,
    addSession: vi.fn(),
    findByChannelId: vi.fn().mockReturnValue(undefined),
    markStopped: vi.fn(),
    renameSession: vi.fn(),
  };
}

function fakeRestClient(overrides: Partial<MattermostRestClient> = {}): MattermostRestClient {
  return {
    getUserIdByEmail: vi.fn().mockResolvedValue('jon-1'),
    getMyUserId: vi.fn().mockResolvedValue('bot-1'),
    getOrCreateDirectChannel: vi.fn().mockResolvedValue('dm-1'),
    createPost: vi.fn().mockResolvedValue(undefined),
    getPostsSince: vi.fn().mockResolvedValue([]),
    getMyTeams: vi.fn().mockResolvedValue([{ id: 'team-1', name: 'devops' }] satisfies Team[]),
    createPrivateChannel: vi.fn().mockResolvedValue('new-channel-id'),
    addChannelMember: vi.fn().mockResolvedValue(undefined),
    archiveChannel: vi.fn().mockResolvedValue(undefined),
    renameChannel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function fakeSessionRuntime(overrides: Partial<SessionRuntimeRegistry> = {}): SessionRuntimeRegistry {
  return {
    register: vi.fn(),
    get: vi.fn().mockReturnValue(undefined),
    remove: vi.fn(),
    ...overrides,
  };
}

function fakeHandle(overrides: Partial<HarnessSessionHandle> = {}): HarnessSessionHandle {
  return {
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    onExit: vi.fn(),
    onRename: vi.fn(),
    ...overrides,
  };
}

function fakeOpencodeAdapter(overrides: Partial<HarnessAdapter> = {}): HarnessAdapter {
  return {
    name: 'opencode',
    start: vi.fn().mockResolvedValue(fakeHandle()),
    ...overrides,
  };
}

/** No production SessionStore writes anything by itself here -- most tests
 * just need an empty one, the same way KAN-3's tests injected a fixture
 * command registry. `start`-specific deps default to a working happy path
 * so non-`start` tests never have to think about them. */
function fakeDeps(overrides: Partial<RouterDeps> = {}): RouterDeps {
  return {
    sessionStore: fakeSessionStore(),
    restClient: fakeRestClient(),
    sessionRuntime: fakeSessionRuntime(),
    harnesses: { opencode: fakeOpencodeAdapter() },
    allocateSessionNumber: vi.fn().mockResolvedValue(4),
    logger: silentLogger(),
    hostname: 'devsix',
    operatorUserId: 'jon-1',
    ...overrides,
  };
}

describe('decideReply', () => {
  it('replies with the unknown-command message for an unrecognized command', async () => {
    const decision = await decideReply(post({ message: 'anything at all' }), context, fakeDeps());

    expect(decision).toEqual({ shouldReply: true, replyMessage: UNKNOWN_COMMAND_REPLY });
  });

  it('does not reply to the bot own posts, to avoid a self-reply loop', async () => {
    const decision = await decideReply(post({ userId: 'bot-1' }), context, fakeDeps());

    expect(decision).toEqual({ shouldReply: false });
  });

  it('does not reply to posts from someone other than the operator', async () => {
    const decision = await decideReply(post({ userId: 'someone-else' }), context, fakeDeps());

    expect(decision).toEqual({ shouldReply: false });
  });

  it('does not reply to posts outside the resolved DM channel', async () => {
    const decision = await decideReply(post({ channelId: 'some-other-channel' }), context, fakeDeps());

    expect(decision).toEqual({ shouldReply: false });
  });

  it('the unknown-command reply points the operator at `help`', () => {
    expect(UNKNOWN_COMMAND_REPLY).toMatch(/help/);
  });

  describe('`help` with no arguments', () => {
    it('replies with every registered command and its one-line description', async () => {
      const decision = await decideReply(post({ message: 'help' }), context, fakeDeps());

      expect(decision.shouldReply).toBe(true);
      for (const command of commandRegistry) {
        expect(decision.replyMessage).toContain(`\`${command.name}\` - ${command.summary}`);
      }
    });

    it('is case-insensitive and tolerant of surrounding whitespace', async () => {
      const decision = await decideReply(post({ message: '  HELP  ' }), context, fakeDeps());

      expect(decision.replyMessage).toContain('`help`');
    });
  });

  describe('`help <command>`', () => {
    it('replies with that command\'s detailed usage when one is registered', async () => {
      const helpEntry = commandRegistry.find((command) => command.name === 'help');
      const decision = await decideReply(post({ message: 'help help' }), context, fakeDeps());

      expect(decision).toEqual({ shouldReply: true, replyMessage: helpEntry?.usage });
    });

    it('is case-insensitive for the target command name', async () => {
      const helpEntry = commandRegistry.find((command) => command.name === 'help');
      const decision = await decideReply(post({ message: 'help HELP' }), context, fakeDeps());

      expect(decision).toEqual({ shouldReply: true, replyMessage: helpEntry?.usage });
    });

    it('replies with a clear note (never an error) for an unrecognized command name', async () => {
      const decision = await decideReply(post({ message: 'help bogus' }), context, fakeDeps());

      expect(decision).toEqual({ shouldReply: true, replyMessage: 'No help available for `bogus`.' });
    });

    it('sanitizes backticks in an unrecognized target name so the reply keeps well-formed markdown', async () => {
      const decision = await decideReply(post({ message: 'help `x`' }), context, fakeDeps());

      expect(decision).toEqual({ shouldReply: true, replyMessage: 'No help available for `x`.' });
    });
  });

  describe('`list`', () => {
    it('replies with a clear "no sessions" message when the store is empty', async () => {
      const decision = await decideReply(post({ message: 'list' }), context, fakeDeps({ sessionStore: fakeSessionStore([]) }));

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).toMatch(/no sessions/i);
    });

    it('reads from the injected session store and lists running sessions above stopped ones', async () => {
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
      const decision = await decideReply(post({ message: 'list' }), context, fakeDeps({ sessionStore: fakeSessionStore(sessions) }));

      expect(decision.shouldReply).toBe(true);
      const message = decision.replyMessage ?? '';
      expect(message).toContain('#2 : dev-vm');
      expect(message).toContain('opencode');
      expect(message).toContain('/home/jon/project-b');
      expect(message.indexOf('#2 : dev-vm')).toBeLessThan(message.indexOf('stopped-session'));
    });

    it('is case-insensitive and tolerant of surrounding whitespace', async () => {
      const decision = await decideReply(post({ message: '  LIST  ' }), context, fakeDeps({ sessionStore: fakeSessionStore([]) }));

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).toMatch(/no sessions/i);
    });
  });

  describe('`start`', () => {
    it('dispatches into runStart and returns its reply -- happy path creates a session', async () => {
      const sessionStore = fakeSessionStore();
      const deps = fakeDeps({ sessionStore });

      const decision = await decideReply(post({ message: 'start opencode /home/jon/project' }), context, deps);

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).toContain('#4 : devsix');
      expect(sessionStore.addSession).toHaveBeenCalled();
    });

    it('asks for harness and folder when neither is given', async () => {
      const decision = await decideReply(post({ message: 'start' }), context, fakeDeps());

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).toMatch(/harness/i);
    });

    it('is case-insensitive on the command name itself', async () => {
      const decision = await decideReply(post({ message: 'START opencode /home/jon/project' }), context, fakeDeps());

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).not.toBe(UNKNOWN_COMMAND_REPLY);
    });
  });

  describe('`stop`', () => {
    it('dispatches into runStop and returns its reply -- stops a running session by identifier', async () => {
      const session: Session = {
        id: 'sess-1',
        identifier: '#4 : devsix',
        host: 'devsix',
        status: 'running',
        harness: 'opencode',
        folder: '/home/jon/project',
        channelId: 'chan-4',
      };
      const handle = fakeHandle();
      const sessionStore = fakeSessionStore([session]);
      const sessionRuntime = fakeSessionRuntime({ get: vi.fn().mockReturnValue(handle) });
      const deps = fakeDeps({ sessionStore, sessionRuntime });

      const decision = await decideReply(post({ message: 'stop #4 : devsix' }), context, deps);

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).toContain('#4 : devsix');
      expect(handle.stop).toHaveBeenCalled();
      expect(sessionStore.markStopped).toHaveBeenCalledWith('sess-1');
    });

    it('asks which session when no identifier is given', async () => {
      const decision = await decideReply(post({ message: 'stop' }), context, fakeDeps());

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).toMatch(/which session/i);
    });

    it('replies with a clear not-found message for an unknown identifier', async () => {
      const decision = await decideReply(post({ message: 'stop #9 : devsix' }), context, fakeDeps({ sessionStore: fakeSessionStore([]) }));

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).toMatch(/no session found|not found/i);
    });

    it('replies with a clear no-op message for a session that is already stopped', async () => {
      const session: Session = {
        id: 'sess-1',
        identifier: '#4 : devsix',
        host: 'devsix',
        status: 'stopped',
        harness: 'opencode',
        folder: '/home/jon/project',
        channelId: 'chan-4',
      };
      const decision = await decideReply(post({ message: 'stop #4 : devsix' }), context, fakeDeps({ sessionStore: fakeSessionStore([session]) }));

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).toMatch(/already stopped/i);
    });

    it('is case-insensitive on the command name itself', async () => {
      const decision = await decideReply(post({ message: 'STOP #4 : devsix' }), context, fakeDeps({ sessionStore: fakeSessionStore([]) }));

      expect(decision.shouldReply).toBe(true);
      expect(decision.replyMessage).not.toBe(UNKNOWN_COMMAND_REPLY);
    });
  });
});
