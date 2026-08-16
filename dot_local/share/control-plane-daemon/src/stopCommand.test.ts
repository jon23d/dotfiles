import { describe, expect, it, vi } from 'vitest';
import { runStop } from './stopCommand.js';
import type { StopDeps } from './stopCommand.js';
import type { HarnessSessionHandle } from './harness.js';
import type { Logger } from './logger.js';
import type { SessionRuntimeRegistry } from './sessionRuntime.js';
import type { Session, SessionStore } from './sessionStore.js';

function silentLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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

function runningSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    identifier: '#4 : devsix',
    host: 'devsix',
    status: 'running',
    harness: 'opencode',
    folder: '/home/jon/project',
    channelId: 'chan-4',
    ...overrides,
  };
}

function deps(overrides: Partial<StopDeps> = {}): StopDeps {
  return {
    sessionStore: fakeSessionStore(),
    sessionRuntime: fakeSessionRuntime(),
    logger: silentLogger(),
    ...overrides,
  };
}

describe('runStop', () => {
  it('asks which session when no identifier is given', async () => {
    const reply = await runStop([], deps());

    expect(reply).toMatch(/which session/i);
    expect(reply).toMatch(/stop <identifier>/);
  });

  it('replies with a clear not-found message for an unknown identifier, not an error', async () => {
    const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([]) });

    const reply = await runStop(['#9', ':', 'devsix'], deps({ sessionStore }));

    expect(reply).toMatch(/no session found|not found/i);
    expect(reply).toContain('#9 : devsix');
  });

  it('rejoins whitespace-split argument tokens back into the full identifier before matching', async () => {
    const session = runningSession();
    const handle = fakeHandle();
    const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([session]) });
    const sessionRuntime = fakeSessionRuntime({ get: vi.fn().mockReturnValue(handle) });

    // "stop #4 : devsix" arrives as three separate tokens from messageRouter's
    // whitespace-based parser.
    const reply = await runStop(['#4', ':', 'devsix'], deps({ sessionStore, sessionRuntime }));

    expect(reply).toContain('#4 : devsix');
    expect(handle.stop).toHaveBeenCalled();
  });

  it('is case-insensitive when matching the identifier', async () => {
    const session = runningSession();
    const handle = fakeHandle();
    const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([session]) });
    const sessionRuntime = fakeSessionRuntime({ get: vi.fn().mockReturnValue(handle) });

    const reply = await runStop(['#4', ':', 'DEVSIX'], deps({ sessionStore, sessionRuntime }));

    expect(handle.stop).toHaveBeenCalled();
    expect(reply).toMatch(/stopped/i);
  });

  it('replies with a clear no-op message for a session that is already stopped, without touching its runtime handle', async () => {
    const session = runningSession({ status: 'stopped' });
    const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([session]) });
    const sessionRuntime = fakeSessionRuntime();

    const reply = await runStop(['#4', ':', 'devsix'], deps({ sessionStore, sessionRuntime }));

    expect(reply).toMatch(/already stopped/i);
    expect(sessionRuntime.get).not.toHaveBeenCalled();
    expect(sessionStore.markStopped).not.toHaveBeenCalled();
  });

  it('on success: marks the session stopped BEFORE calling handle.stop() (so a synchronous onExit sees it already stopped), terminates the process, and clears the runtime handle', async () => {
    const session = runningSession();
    const callOrder: string[] = [];
    const handle = fakeHandle({ stop: vi.fn(() => callOrder.push('handle.stop')) });
    const sessionStore = fakeSessionStore({
      listSessions: vi.fn().mockReturnValue([session]),
      markStopped: vi.fn(() => callOrder.push('markStopped')),
    });
    const sessionRuntime = fakeSessionRuntime({ get: vi.fn().mockReturnValue(handle) });

    const reply = await runStop(['#4', ':', 'devsix'], deps({ sessionStore, sessionRuntime }));

    expect(callOrder).toEqual(['markStopped', 'handle.stop']);
    expect(sessionStore.markStopped).toHaveBeenCalledWith('sess-1');
    expect(sessionRuntime.get).toHaveBeenCalledWith('chan-4');
    expect(sessionRuntime.remove).toHaveBeenCalledWith('chan-4');
    expect(reply).toContain('#4 : devsix');
    expect(reply).toMatch(/stopped/i);
  });

  it('logs loudly and returns a clear internal-error reply (but still marks the session stopped) when a running session has no live runtime handle', async () => {
    const session = runningSession();
    const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([session]) });
    const sessionRuntime = fakeSessionRuntime({ get: vi.fn().mockReturnValue(undefined) });
    const logger = silentLogger();

    const reply = await runStop(['#4', ':', 'devsix'], deps({ sessionStore, sessionRuntime, logger }));

    expect(logger.error).toHaveBeenCalled();
    expect(sessionStore.markStopped).toHaveBeenCalledWith('sess-1');
    expect(reply).toMatch(/internal error/i);
    expect(reply).toContain('#4 : devsix');
  });
});
