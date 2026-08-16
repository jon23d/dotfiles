import { describe, expect, it, vi } from 'vitest';
import { createInMemorySessionStore } from './sessionStore.js';
import { createStartSerializer, runStart } from './startCommand.js';
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
    archiveChannel: vi.fn().mockResolvedValue(undefined),
    renameChannel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function fakeSessionStore(overrides: Partial<SessionStore> = {}): SessionStore {
  return {
    listSessions: vi.fn().mockReturnValue([]),
    addSession: vi.fn(),
    findByChannelId: vi.fn().mockReturnValue(undefined),
    markStopped: vi.fn(),
    renameSession: vi.fn(),
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
    provisionChannelId: vi.fn().mockResolvedValue(undefined),
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
    // A fresh serializer per test by default -- with only one `runStart`
    // call in flight at a time (the common case here), it's equivalent to
    // no serialization at all. Tests that actually race concurrent calls
    // (see 'concurrency serialization (review kan8-1 F1)' below) share one
    // explicit instance across both calls instead.
    serializeStart: createStartSerializer(),
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

    expect(adapter.start).toHaveBeenCalledWith(
      expect.objectContaining({ folder: '/home/jon/project', operatorUserId: 'jon-1' }),
    );
    expect(restClient.createPrivateChannel).toHaveBeenCalledWith('team-1', expect.stringContaining('4'), '#4 : devsix');
    expect(restClient.addChannelMember).toHaveBeenCalledWith('new-channel-id', 'jon-1');
    // KAN-10: the harness session must be told its own channel id -- never
    // left to resolve or guess it -- only once that channel actually exists.
    expect(handle.provisionChannelId).toHaveBeenCalledWith('new-channel-id');
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

  it('proactively posts a clear notice into the session\'s own channel when its harness process exits unexpectedly (review kan5-1 F4)', async () => {
    let capturedExitCallback: ((info: { code: number | null }) => void) | undefined;
    const handle = fakeHandle({
      onExit: vi.fn((cb: (info: { code: number | null }) => void) => {
        capturedExitCallback = cb;
      }),
    });
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const restClient = fakeRestClient();
    const d = deps({ restClient, harnesses: { opencode: adapter } });

    await runStart(['opencode', '/home/jon/project'], d);
    capturedExitCallback?.({ code: 1 });
    // The post happens fire-and-forget inside the onExit callback -- flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(restClient.createPost).toHaveBeenCalledWith('new-channel-id', expect.stringMatching(/crash|no longer running|exited/i));
  });

  it('skips the crash notice (and does not re-call markStopped) when the exit fires after the session was already marked stopped -- an operator-initiated `stop` (KAN-6), not a crash', async () => {
    let capturedExitCallback: ((info: { code: number | null }) => void) | undefined;
    const handle = fakeHandle({
      onExit: vi.fn((cb: (info: { code: number | null }) => void) => {
        capturedExitCallback = cb;
      }),
    });
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const restClient = fakeRestClient();
    const sessionStore = fakeSessionStore({
      // Simulates KAN-6's `stop` having already flipped this session's
      // status before the harness's exit event reaches this callback.
      findByChannelId: vi.fn().mockReturnValue({
        id: 'sess-1',
        identifier: '#4 : devsix',
        host: 'devsix',
        status: 'stopped',
        harness: 'opencode',
        folder: '/home/jon/project',
        channelId: 'new-channel-id',
      }),
    });
    const d = deps({ restClient, sessionStore, harnesses: { opencode: adapter } });

    await runStart(['opencode', '/home/jon/project'], d);
    capturedExitCallback?.({ code: 0 });
    await Promise.resolve();
    await Promise.resolve();

    expect(restClient.createPost).not.toHaveBeenCalled();
    expect(sessionStore.markStopped).not.toHaveBeenCalled();
  });

  it('logs loudly (and does not throw) if posting the unexpected-exit notice itself fails', async () => {
    let capturedExitCallback: ((info: { code: number | null }) => void) | undefined;
    const handle = fakeHandle({
      onExit: vi.fn((cb: (info: { code: number | null }) => void) => {
        capturedExitCallback = cb;
      }),
    });
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const restClient = fakeRestClient({ createPost: vi.fn().mockRejectedValue(new Error('mattermost 500')) });
    const logger = silentLogger();
    const d = deps({ restClient, logger, harnesses: { opencode: adapter } });

    await runStart(['opencode', '/home/jon/project'], d);
    expect(() => capturedExitCallback?.({ code: 1 })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalled();
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

  it('when adding the operator to the new channel fails, stops the harness session, archives the orphaned channel, and registers nothing (review kan5-1 F3)', async () => {
    const handle = fakeHandle();
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const restClient = fakeRestClient({ addChannelMember: vi.fn().mockRejectedValue(new Error('forbidden')) });
    const sessionStore = fakeSessionStore();
    const d = deps({ restClient, sessionStore, harnesses: { opencode: adapter } });

    const reply = await runStart(['opencode', '/home/jon/project'], d);

    expect(reply).toMatch(/channel/i);
    expect(handle.stop).toHaveBeenCalled();
    expect(sessionStore.addSession).not.toHaveBeenCalled();
    // The channel WAS created (only adding the operator failed) -- it must
    // be cleaned up, not left as an invisible orphan nothing references.
    expect(restClient.archiveChannel).toHaveBeenCalledWith('new-channel-id');
    // The reply must not claim the channel "could not be created" -- it
    // was created; only adding the operator to it failed. That's a
    // different, more specific failure and the operator deserves the
    // accurate story.
    expect(reply).not.toMatch(/could not be created/i);
    expect(reply).toMatch(/forbidden/);
    // Never reached: addChannelMember already failed, so the session must
    // never be told a channel id for a channel it was never actually added to.
    expect(handle.provisionChannelId).not.toHaveBeenCalled();
  });

  it('when telling the harness session its own channel id fails, stops the session, archives the orphaned channel, and registers nothing (KAN-10 AC4: never a silent fallback)', async () => {
    const handle = fakeHandle({ provisionChannelId: vi.fn().mockRejectedValue(new Error('disk full')) });
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const restClient = fakeRestClient();
    const sessionStore = fakeSessionStore();
    const sessionRuntime = fakeSessionRuntime();
    const d = deps({ restClient, sessionStore, sessionRuntime, harnesses: { opencode: adapter } });

    const reply = await runStart(['opencode', '/home/jon/project'], d);

    expect(handle.provisionChannelId).toHaveBeenCalledWith('new-channel-id');
    expect(reply).toMatch(/channel/i);
    expect(handle.stop).toHaveBeenCalled();
    expect(sessionStore.addSession).not.toHaveBeenCalled();
    expect(sessionRuntime.register).not.toHaveBeenCalled();
    // The channel WAS created (only telling the session its id failed) -- it
    // must be cleaned up, not left as an invisible orphan.
    expect(restClient.archiveChannel).toHaveBeenCalledWith('new-channel-id');
    expect(reply).toMatch(/disk full/);
  });

  it('when channel creation itself fails, does not attempt to archive anything (there is no channel to clean up)', async () => {
    const handle = fakeHandle();
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const restClient = fakeRestClient({ createPrivateChannel: vi.fn().mockRejectedValue(new Error('channel name already exists')) });
    const d = deps({ restClient, harnesses: { opencode: adapter } });

    await runStart(['opencode', '/home/jon/project'], d);

    expect(restClient.archiveChannel).not.toHaveBeenCalled();
  });

  it('when archiving the orphaned channel also fails, still reports the original addChannelMember failure, does not throw, and does NOT falsely claim the channel was cleaned up (review kan5-2 F5)', async () => {
    const handle = fakeHandle();
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const restClient = fakeRestClient({
      addChannelMember: vi.fn().mockRejectedValue(new Error('forbidden')),
      archiveChannel: vi.fn().mockRejectedValue(new Error('archive also failed')),
    });
    const logger = silentLogger();
    const d = deps({ restClient, logger, harnesses: { opencode: adapter } });

    const reply = await runStart(['opencode', '/home/jon/project'], d);

    expect(reply).toMatch(/forbidden/);
    expect(logger.error).toHaveBeenCalled();
    // The archive attempt itself failed -- the channel is still there,
    // leaked. The reply must not tell the operator it was cleaned up when
    // it wasn't (review kan5-2 F5), and should instead say it needs manual
    // removal.
    expect(reply).not.toMatch(/channel has been cleaned up/i);
    expect(reply).toMatch(/manual|could not be (automatically )?(cleaned up|removed|archived)/i);
  });

  it('when archiving the orphaned channel succeeds, the reply accurately says the channel was cleaned up', async () => {
    const handle = fakeHandle();
    const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
    const restClient = fakeRestClient({ addChannelMember: vi.fn().mockRejectedValue(new Error('forbidden')) });
    const d = deps({ restClient, harnesses: { opencode: adapter } });

    const reply = await runStart(['opencode', '/home/jon/project'], d);

    expect(restClient.archiveChannel).toHaveBeenCalledWith('new-channel-id');
    expect(reply).toMatch(/channel has been cleaned up/i);
  });

  describe('concurrency refusal (KAN-8)', () => {
    function runningSession(overrides: Partial<Session> = {}): Session {
      return {
        id: 'sess-existing',
        identifier: '#5 : devsix',
        host: 'devsix',
        status: 'running',
        harness: 'opencode',
        folder: '/home/jon/other-project',
        channelId: 'chan-5',
        ...overrides,
      };
    }

    it('refuses when a session is already running, naming its identifier, and creates no new session or channel', async () => {
      const existing = runningSession();
      const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([existing]) });
      const restClient = fakeRestClient();
      const adapter = fakeOpencodeAdapter();
      const d = deps({ sessionStore, restClient, harnesses: { opencode: adapter } });

      const reply = await runStart(['opencode', '/home/jon/project'], d);

      expect(reply).toContain('#5 : devsix');
      expect(reply).toMatch(/already running/i);
      expect(reply).toMatch(/--force/);
      expect(d.allocateSessionNumber).not.toHaveBeenCalled();
      expect(restClient.getMyTeams).not.toHaveBeenCalled();
      expect(adapter.start).not.toHaveBeenCalled();
      expect(restClient.createPrivateChannel).not.toHaveBeenCalled();
      expect(sessionStore.addSession).not.toHaveBeenCalled();
    });

    it('proceeds with the normal start flow when `--force` is given, even with a session already running', async () => {
      const existing = runningSession();
      const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([existing]) });
      const d = deps({ sessionStore });

      const reply = await runStart(['opencode', '/home/jon/project', '--force'], d);

      expect(reply).toContain('#4 : devsix');
      expect(sessionStore.addSession).toHaveBeenCalled();
    });

    it('recognizes `--force` anywhere in the args, not just at the end', async () => {
      const existing = runningSession();
      const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([existing]) });
      const d = deps({ sessionStore });

      const reply = await runStart(['--force', 'opencode', '/home/jon/project'], d);

      expect(reply).toContain('#4 : devsix');
      expect(sessionStore.addSession).toHaveBeenCalled();
    });

    it('proceeds exactly as today when no session is currently running (no `--force` needed)', async () => {
      const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([]) });
      const d = deps({ sessionStore });

      const reply = await runStart(['opencode', '/home/jon/project'], d);

      expect(reply).toContain('#4 : devsix');
      expect(sessionStore.addSession).toHaveBeenCalled();
    });

    it('ignores a stopped session -- only `running` status blocks a new start', async () => {
      const stopped = runningSession({ id: 'sess-stopped', status: 'stopped' });
      const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([stopped]) });
      const d = deps({ sessionStore });

      const reply = await runStart(['opencode', '/home/jon/project'], d);

      expect(reply).toContain('#4 : devsix');
      expect(sessionStore.addSession).toHaveBeenCalled();
    });

    it('when more than one session is already running, names more than just the first (lists all of them)', async () => {
      const first = runningSession({ id: 'sess-a', identifier: '#5 : devsix' });
      const second = runningSession({ id: 'sess-b', identifier: '#6 : devsix', channelId: 'chan-6' });
      const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([first, second]) });
      const d = deps({ sessionStore });

      const reply = await runStart(['opencode', '/home/jon/project'], d);

      expect(reply).toContain('#5 : devsix');
      expect(reply).toContain('#6 : devsix');
      expect(d.allocateSessionNumber).not.toHaveBeenCalled();
    });

    it('sanitizes backticks out of a running session\'s (possibly agent-renamed) identifier before interpolating it into the refusal', async () => {
      const existing = runningSession({ identifier: 'KAN-4`; rm -rf / : devsix' });
      const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([existing]) });
      const d = deps({ sessionStore });

      const reply = await runStart(['opencode', '/home/jon/project'], d);

      expect(reply).not.toContain('KAN-4`;');
    });

    it('checks for a running session before validating harness/folder args, per the "before that whole flow begins" design', async () => {
      const existing = runningSession();
      const sessionStore = fakeSessionStore({ listSessions: vi.fn().mockReturnValue([existing]) });
      const d = deps({ sessionStore });

      const reply = await runStart([], d);

      expect(reply).toMatch(/already running/i);
      expect(reply).not.toMatch(/harness/i);
    });

    it('serializes two truly concurrent `start` calls so only one session is created, even though neither observes anything running yet (review kan8-1 F1)', async () => {
      // A real, stateful SessionStore (not the always-empty fake) and one
      // shared serializer across both calls -- exactly the two pieces the
      // race needs: `addSession` from the winning call must actually be
      // visible to the second call's running-session check, and both calls
      // must be genuinely in flight together (`Promise.all`, no `await`
      // between them), matching the pattern sessionNumberStore.test.ts's
      // post-kan5-1-F2 regression test already uses for the same class of
      // check-then-act race.
      const sessionStore = createInMemorySessionStore();
      const serializeStart = createStartSerializer();
      const restClient = fakeRestClient();
      const adapter = fakeOpencodeAdapter();
      const d = deps({ sessionStore, restClient, serializeStart, harnesses: { opencode: adapter } });

      const [replyA, replyB] = await Promise.all([
        runStart(['opencode', '/home/jon/project-a'], d),
        runStart(['opencode', '/home/jon/project-b'], d),
      ]);

      // Without serialization, both calls would see `listSessions()` return
      // `[]` (neither has called `addSession` yet) and both would proceed --
      // exactly the bug this test guards against.
      expect(sessionStore.listSessions()).toHaveLength(1);
      expect(adapter.start).toHaveBeenCalledTimes(1);
      const replies = [replyA, replyB];
      expect(replies.filter((reply) => /already running/i.test(reply))).toHaveLength(1);
      expect(replies.filter((reply) => /^Started/.test(reply))).toHaveLength(1);
    });
  });

  describe('onRename wiring (KAN-7)', () => {
    function withCapturedRenameCallback() {
      let capturedRenameCallback: ((identifier: string) => void) | undefined;
      const handle = fakeHandle({
        onRename: vi.fn((cb: (identifier: string) => void) => {
          capturedRenameCallback = cb;
        }),
      });
      const adapter = fakeOpencodeAdapter({ start: vi.fn().mockResolvedValue(handle) });
      return { handle, adapter, fire: (identifier: string) => capturedRenameCallback?.(identifier) };
    }

    it('renames the Mattermost channel to `<identifier> : <hostName>`, preserving the host suffix, and updates the session store', async () => {
      const { adapter, fire } = withCapturedRenameCallback();
      const restClient = fakeRestClient();
      const sessionStore = fakeSessionStore();
      const d = deps({ restClient, sessionStore, harnesses: { opencode: adapter } });

      await runStart(['opencode', '/home/jon/project'], d);
      fire('KAN-4');
      await Promise.resolve();
      await Promise.resolve();

      expect(restClient.renameChannel).toHaveBeenCalledWith(
        'new-channel-id',
        expect.stringMatching(/kan-4/),
        'KAN-4 : devsix',
      );
      expect(sessionStore.renameSession).toHaveBeenCalledWith(expect.any(String), 'KAN-4 : devsix');
    });

    it('renames again on a second, later signal (AC2: work identity can change again)', async () => {
      const { adapter, fire } = withCapturedRenameCallback();
      const restClient = fakeRestClient();
      const sessionStore = fakeSessionStore();
      const d = deps({ restClient, sessionStore, harnesses: { opencode: adapter } });

      await runStart(['opencode', '/home/jon/project'], d);
      fire('KAN-4');
      fire('KAN-9');
      // Renames are now serialized (kan7-1 F2), which adds an extra
      // microtask hop per attempt -- wait for the end state rather than
      // counting exact ticks, so this test doesn't depend on that
      // implementation detail.
      await vi.waitFor(() => expect(sessionStore.renameSession).toHaveBeenNthCalledWith(2, expect.any(String), 'KAN-9 : devsix'));

      expect(restClient.renameChannel).toHaveBeenCalledTimes(2);
      expect(restClient.renameChannel).toHaveBeenNthCalledWith(2, 'new-channel-id', expect.stringMatching(/kan-9/), 'KAN-9 : devsix');
    });

    it('when the Mattermost rename fails (e.g. a name collision), logs it loudly, posts a failure notice into the channel, and does not update the session store (AC3: never fail silently)', async () => {
      const { adapter, fire } = withCapturedRenameCallback();
      const restClient = fakeRestClient({ renameChannel: vi.fn().mockRejectedValue(new Error('channel name already exists')) });
      const sessionStore = fakeSessionStore();
      const logger = silentLogger();
      const d = deps({ restClient, sessionStore, logger, harnesses: { opencode: adapter } });

      await runStart(['opencode', '/home/jon/project'], d);
      fire('KAN-4');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalled();
      expect(restClient.createPost).toHaveBeenCalledWith(
        'new-channel-id',
        expect.stringMatching(/rename|already exists/i),
      );
      expect(sessionStore.renameSession).not.toHaveBeenCalled();
    });

    it('logs loudly (and does not throw) if posting the rename-failure notice itself also fails', async () => {
      const { adapter, fire } = withCapturedRenameCallback();
      const restClient = fakeRestClient({
        renameChannel: vi.fn().mockRejectedValue(new Error('channel name already exists')),
        createPost: vi.fn().mockRejectedValue(new Error('mattermost 500')),
      });
      const logger = silentLogger();
      const d = deps({ restClient, logger, harnesses: { opencode: adapter } });

      await runStart(['opencode', '/home/jon/project'], d);
      expect(() => fire('KAN-4')).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalled();
    });

    it('sanitizes backticks out of the agent-controlled title before interpolating it into the rename-failure notice (kan7-1 F1)', async () => {
      const { adapter, fire } = withCapturedRenameCallback();
      const restClient = fakeRestClient({ renameChannel: vi.fn().mockRejectedValue(new Error('channel name already exists')) });
      const d = deps({ restClient, harnesses: { opencode: adapter } });

      await runStart(['opencode', '/home/jon/project'], d);
      // A backtick embedded in the agent-set title must not survive
      // unescaped into a backtick-quoted span of the reply (same class of
      // issue as kan3-1 F1 / kan4-1 F1 -- see markdown.ts's stripBackticks).
      fire('KAN-4`; rm -rf /');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(restClient.createPost).toHaveBeenCalledWith(
        'new-channel-id',
        expect.not.stringContaining('KAN-4`;'),
      );
    });

    it('serializes rename attempts per session so a rapid second signal is never overwritten in the store by the first settling later (kan7-1 F2)', async () => {
      const { adapter, fire } = withCapturedRenameCallback();
      const resolvers: Array<() => void> = [];
      const renameChannel = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve);
          }),
      );
      const restClient = fakeRestClient({ renameChannel });
      const sessionStore = fakeSessionStore();
      const d = deps({ restClient, sessionStore, harnesses: { opencode: adapter } });

      await runStart(['opencode', '/home/jon/project'], d);
      // Fired back-to-back with no await between -- exactly how
      // opencodeHarness.ts's synchronous SSE handler invokes onRename
      // callbacks for two title changes.
      fire('KAN-4');
      fire('KAN-9');
      await Promise.resolve();
      await Promise.resolve();

      // Serialized: the second renameChannel call must not even be *issued*
      // yet -- it's chained behind the first's completion, so there is
      // never a moment with two in-flight PUTs whose settlement order could
      // race and let the older identifier win the store update.
      expect(renameChannel).toHaveBeenCalledTimes(1);
      expect(renameChannel).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'KAN-4 : devsix');
      expect(sessionStore.renameSession).not.toHaveBeenCalled();

      // Settle the first request -- only now should the second be issued.
      resolvers[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(renameChannel).toHaveBeenCalledTimes(2);
      expect(renameChannel).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), 'KAN-9 : devsix');

      resolvers[1]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(sessionStore.renameSession).toHaveBeenLastCalledWith(expect.any(String), 'KAN-9 : devsix');
    });
  });
});
