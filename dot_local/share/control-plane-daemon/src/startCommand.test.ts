import { describe, expect, it, vi } from 'vitest';
import { runStart } from './startCommand.js';
import type { StartDeps } from './startCommand.js';
import type { HarnessAdapter, HarnessSessionHandle } from './harness.js';
import type { Logger } from './logger.js';
import type { MattermostRestClient, Team } from './mattermostRestClient.js';
import type { Session, SessionStore } from './sessionStore.js';
import type { SessionRuntimeRegistry } from './sessionRuntime.js';

function silentLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
    ...overrides,
  };
}

function fakeSessionStore(overrides: Partial<SessionStore> = {}): SessionStore {
  return {
    listSessions: vi.fn().mockReturnValue([]),
    addSession: vi.fn(),
    findByChannelId: vi.fn().mockReturnValue(undefined),
    markStopped: vi.fn(),
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

function deps(overrides: Partial<StartDeps> = {}): StartDeps {
  return {
    restClient: fakeRestClient(),
    sessionStore: fakeSessionStore(),
    sessionRuntime: fakeSessionRuntime(),
    harnesses: { opencode: fakeOpencodeAdapter() },
    allocateSessionNumber: vi.fn().mockResolvedValue(4),
    logger: silentLogger(),
    hostname: 'devsix',
    operatorUserId: 'jon-1',
    ...overrides,
  };
}

describe('runStart', () => {
  it('asks which harness and folder when neither is given', async () => {
    const d = deps();

    const reply = await runStart([], d);

    expect(reply).toMatch(/harness/i);
    expect(reply).toMatch(/folder/i);
    expect(d.allocateSessionNumber).not.toHaveBeenCalled();
  });

  it('asks for the missing folder when only a harness is given', async () => {
    const reply = await runStart(['opencode'], deps());

    expect(reply).toMatch(/folder/i);
  });

  it('rejects an unrecognized harness name with a clear error listing valid harnesses', async () => {
    const d = deps();

    const reply = await runStart(['docker', '/tmp/whatever'], d);

    expect(reply).toMatch(/unknown harness/i);
    expect(reply).toContain('opencode');
    expect(d.allocateSessionNumber).not.toHaveBeenCalled();
    expect(d.restClient.getMyTeams).not.toHaveBeenCalled();
  });

  it('gives a distinct, honest error for `claude-code` -- recognized but not implemented yet', async () => {
    const d = deps();

    const reply = await runStart(['claude-code', '/tmp/whatever'], d);

    expect(reply).toMatch(/not implemented|not yet supported|not supported yet/i);
    expect(d.allocateSessionNumber).not.toHaveBeenCalled();
  });

  it('is case-insensitive on the harness name', async () => {
    const d = deps();

    const reply = await runStart(['OpenCode', '/tmp/whatever'], d);

    expect(reply).not.toMatch(/unknown harness/i);
  });

  it('fails fast with a clear error when the bot belongs to no Mattermost team (KAN-5 known blocker) -- before spawning anything', async () => {
    const d = deps({ restClient: fakeRestClient({ getMyTeams: vi.fn().mockResolvedValue([]) }) });

    const reply = await runStart(['opencode', '/tmp/project'], d);

    expect(reply).toMatch(/team/i);
    expect(d.allocateSessionNumber).not.toHaveBeenCalled();
    const adapter = d.harnesses.opencode;
    expect(adapter?.start).not.toHaveBeenCalled();
  });

  it('surfaces a clear error, loudly logged, if looking up team membership fails', async () => {
    const logger = silentLogger();
    const d = deps({
      restClient: fakeRestClient({ getMyTeams: vi.fn().mockRejectedValue(new Error('mattermost 500')) }),
      logger,
    });

    const reply = await runStart(['opencode', '/tmp/project'], d);

    expect(reply).toMatch(/team/i);
    expect(logger.error).toHaveBeenCalled();
  });

  it('on success: allocates a session number, spawns the harness, creates a private channel named `#<n> : <hostname>`, adds the operator, registers the session and its runtime handle', async () => {
    const handle = fakeHandle();
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const restClient = fakeRestClient();
    const sessionStore = fakeSessionStore();
    const sessionRuntime = fakeSessionRuntime();
    const d = deps({ restClient, sessionStore, sessionRuntime, harnesses: { opencode: adapter } });

    const reply = await runStart(['opencode', '/home/jon/project'], d);

    expect(adapter.start).toHaveBeenCalledWith(expect.objectContaining({ folder: '/home/jon/project' }));
    expect(restClient.createPrivateChannel).toHaveBeenCalledWith('team-1', expect.stringContaining('4'), '#4 : devsix');
    expect(restClient.addChannelMember).toHaveBeenCalledWith('new-channel-id', 'jon-1');
    expect(sessionStore.addSession).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: '#4 : devsix',
        host: 'devsix',
        status: 'running',
        harness: 'opencode',
        folder: '/home/jon/project',
        channelId: 'new-channel-id',
      }) satisfies Partial<Session>,
    );
    expect(sessionRuntime.register).toHaveBeenCalledWith('new-channel-id', handle);
    expect(reply).toContain('#4 : devsix');
  });

  it('registers an onExit callback that marks the session stopped in the store when the harness process later dies', async () => {
    let capturedExitCallback: ((info: { code: number | null }) => void) | undefined;
    const handle = fakeHandle({
      onExit: vi.fn((cb: (info: { code: number | null }) => void) => {
        capturedExitCallback = cb;
      }),
    });
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const sessionStore = fakeSessionStore();
    const d = deps({ sessionStore, harnesses: { opencode: adapter } });

    await runStart(['opencode', '/home/jon/project'], d);
    capturedExitCallback?.({ code: 1 });

    expect(sessionStore.markStopped).toHaveBeenCalledWith(expect.any(String));
  });

  it('when the harness fails to start, surfaces a clear error and never creates a channel', async () => {
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockRejectedValue(new Error('opencode serve did not become ready')) });
    const restClient = fakeRestClient();
    const sessionStore = fakeSessionStore();
    const d = deps({ restClient, sessionStore, harnesses: { opencode: adapter } });

    const reply = await runStart(['opencode', '/home/jon/project'], d);

    expect(reply).toMatch(/could not start|failed to start/i);
    expect(reply).toContain('did not become ready');
    expect(restClient.createPrivateChannel).not.toHaveBeenCalled();
    expect(sessionStore.addSession).not.toHaveBeenCalled();
  });

  it('when channel creation fails after the harness already started, stops the harness session and registers nothing', async () => {
    const handle = fakeHandle();
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const restClient = fakeRestClient({ createPrivateChannel: vi.fn().mockRejectedValue(new Error('channel name already exists')) });
    const sessionStore = fakeSessionStore();
    const sessionRuntime = fakeSessionRuntime();
    const d = deps({ restClient, sessionStore, sessionRuntime, harnesses: { opencode: adapter } });

    const reply = await runStart(['opencode', '/home/jon/project'], d);

    expect(reply).toMatch(/channel/i);
    expect(handle.stop).toHaveBeenCalled();
    expect(sessionStore.addSession).not.toHaveBeenCalled();
    expect(sessionRuntime.register).not.toHaveBeenCalled();
  });

  it('when adding the operator to the new channel fails, stops the harness session and registers nothing', async () => {
    const handle = fakeHandle();
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const restClient = fakeRestClient({ addChannelMember: vi.fn().mockRejectedValue(new Error('forbidden')) });
    const sessionStore = fakeSessionStore();
    const d = deps({ restClient, sessionStore, harnesses: { opencode: adapter } });

    const reply = await runStart(['opencode', '/home/jon/project'], d);

    expect(reply).toMatch(/channel/i);
    expect(handle.stop).toHaveBeenCalled();
    expect(sessionStore.addSession).not.toHaveBeenCalled();
  });
});
