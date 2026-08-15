import { describe, expect, it, vi } from 'vitest';
import { createDaemon } from './daemon.js';
import { UNKNOWN_COMMAND_REPLY } from './messageRouter.js';
import type { Logger } from './logger.js';
import type { MattermostRestClient } from './mattermostRestClient.js';
import type { SessionStore } from './sessionStore.js';
import type { MattermostSocketClient, MattermostSocketClientConfig } from './socketClient.js';
import type { StateStore } from './stateStore.js';
import type { IncomingPost } from './types.js';

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
    ...overrides,
  };
}

function fakeStateStore(overrides: Partial<StateStore> = {}): StateStore {
  return {
    readLastSeen: vi.fn().mockResolvedValue(null),
    writeLastSeen: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Nothing writes real sessions yet (KAN-5/KAN-6 land later), so these tests
 * only need an empty store -- they're exercising daemon wiring, not `list`'s
 * own rendering logic (that's covered directly in messageRouter.test.ts /
 * listCommand.test.ts). */
function fakeSessionStore(overrides: Partial<SessionStore> = {}): SessionStore {
  return {
    listSessions: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

function post(overrides: Partial<IncomingPost> = {}): IncomingPost {
  return { id: 'p1', userId: 'jon-1', channelId: 'dm-1', message: 'list', createAt: 1000, ...overrides };
}

/** Captures the config createMattermostSocketClient was called with, so
 * tests can invoke onPost/onOpen directly instead of a real socket. */
function fakeSocketClientFactory() {
  let captured: MattermostSocketClientConfig | undefined;
  const client: MattermostSocketClient = { start: vi.fn(), stop: vi.fn() };
  const factory = vi.fn((config: MattermostSocketClientConfig) => {
    captured = config;
    return client;
  });
  return {
    factory,
    client,
    // onPost/onOpen are typed void-returning but the daemon's real
    // implementations are async and self-catching; casting here lets tests
    // await completion deterministically instead of polling.
    async firePost(p: IncomingPost) {
      await (captured?.onPost(p) as unknown as Promise<void> | undefined);
    },
    async fireOpen() {
      await (captured?.onOpen?.() as unknown as Promise<void> | undefined);
    },
  };
}

describe('createDaemon', () => {
  it('start() resolves the routing context and starts a socket client for the right ws URL', async () => {
    const restClient = fakeRestClient();
    const socket = fakeSocketClientFactory();
    const daemon = createDaemon({
      restClient,
      stateStore: fakeStateStore(),
      sessionStore: fakeSessionStore(),
      logger: silentLogger(),
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });

    await daemon.start();

    expect(socket.factory).toHaveBeenCalledWith(
      expect.objectContaining({ wsUrl: 'wss://mattermost.example.com/api/v4/websocket', token: 'tok-123' }),
    );
    expect(socket.client.start).toHaveBeenCalled();
  });

  it('replies with the unknown-command message and advances the watermark when the operator sends a DM', async () => {
    const restClient = fakeRestClient();
    const stateStore = fakeStateStore();
    const socket = fakeSocketClientFactory();
    const daemon = createDaemon({
      restClient,
      stateStore,
      sessionStore: fakeSessionStore(),
      logger: silentLogger(),
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });
    await daemon.start();

    // `list` is now a real registered command (KAN-4), so this test uses an
    // explicitly-unrecognized message rather than post()'s default.
    await socket.firePost(post({ id: 'p1', createAt: 5000, message: 'boguscommand' }));

    expect(restClient.createPost).toHaveBeenCalledWith('dm-1', UNKNOWN_COMMAND_REPLY);
    expect(stateStore.writeLastSeen).toHaveBeenCalledWith(5000, 'p1');
  });

  it('logs an info line with the post id and channel id after a reply is successfully posted', async () => {
    const restClient = fakeRestClient();
    const logger = silentLogger();
    const socket = fakeSocketClientFactory();
    const daemon = createDaemon({
      restClient,
      stateStore: fakeStateStore(),
      sessionStore: fakeSessionStore(),
      logger,
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });
    await daemon.start();

    await socket.firePost(post({ id: 'p1' }));

    expect(logger.info).toHaveBeenCalledWith(
      'posted reply to Mattermost',
      expect.objectContaining({ postId: 'p1', channelId: 'dm-1' }),
    );
  });

  it('does not reply to the bot own post', async () => {
    const restClient = fakeRestClient();
    const socket = fakeSocketClientFactory();
    const daemon = createDaemon({
      restClient,
      stateStore: fakeStateStore(),
      sessionStore: fakeSessionStore(),
      logger: silentLogger(),
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });
    await daemon.start();

    await socket.firePost(post({ userId: 'bot-1' }));

    expect(restClient.createPost).not.toHaveBeenCalled();
  });

  it('on socket open, catches up across a same-millisecond sibling of the watermark that a real Mattermost server would drop under an exclusive `since` boundary, deduping only the exact already-processed post by id', async () => {
    // Mattermost's real `since` filter is `WHERE UpdateAt > ?` -- strictly
    // exclusive of the boundary millisecond (KAN-2 review F2b). This mock
    // reproduces that by filtering on the `since` value it's actually
    // called with, unlike a naive mock that unconditionally returns every
    // post regardless of `since`. That means this test only passes if
    // daemon.ts queries with `since = lastSeen.ms - 1`; the old buggy
    // `since = lastSeen.ms` would cause the server-side filter here to drop
    // both same-ms posts (including the never-processed sibling) before
    // daemon.ts's own dedupe-by-id logic ever sees them.
    const allPosts = [
      post({ id: 'p0', createAt: 5000, message: 'already processed' }),
      // Same millisecond as the watermark, but a distinct post that was
      // never processed -- e.g. it arrived while the daemon was
      // disconnected, in the same millisecond as the last post handled
      // before disconnect. This is the exact scenario KAN-2 review F2/F2b
      // is about.
      post({ id: 'p0b', createAt: 5000, message: 'same-ms sibling, never processed' }),
      post({ id: 'p1', createAt: 5001, message: 'first' }),
    ];
    const restClient = fakeRestClient({
      getPostsSince: vi.fn((_channelId: string, since: number) =>
        Promise.resolve(allPosts.filter((p) => p.createAt > since)),
      ),
    });
    const stateStore = fakeStateStore({ readLastSeen: vi.fn().mockResolvedValue({ ms: 5000, id: 'p0' }) });
    const socket = fakeSocketClientFactory();
    const daemon = createDaemon({
      restClient,
      stateStore,
      sessionStore: fakeSessionStore(),
      logger: silentLogger(),
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });
    await daemon.start();

    await socket.fireOpen();

    expect(restClient.getPostsSince).toHaveBeenCalledWith('dm-1', 4999);
    expect(restClient.createPost).toHaveBeenCalledTimes(2);
    // p0 (id match) must never be re-processed...
    expect(stateStore.writeLastSeen).not.toHaveBeenCalledWith(5000, 'p0');
    // ...but p0b, its same-millisecond sibling, must be -- this is exactly
    // the post the old exclusive-`ms` boundary silently dropped.
    expect(stateStore.writeLastSeen).toHaveBeenCalledWith(5000, 'p0b');
    expect(stateStore.writeLastSeen).toHaveBeenCalledWith(5001, 'p1');
    expect(stateStore.writeLastSeen).toHaveBeenLastCalledWith(5001, 'p1');
  });

  it('falls back to the exclusive ms+1 boundary when the persisted watermark predates id tracking (legacy state file)', async () => {
    const restClient = fakeRestClient({
      getPostsSince: vi.fn().mockResolvedValue([post({ id: 'p1', createAt: 5001, message: 'first' })]),
    });
    const stateStore = fakeStateStore({ readLastSeen: vi.fn().mockResolvedValue({ ms: 5000, id: null }) });
    const socket = fakeSocketClientFactory();
    const daemon = createDaemon({
      restClient,
      stateStore,
      sessionStore: fakeSessionStore(),
      logger: silentLogger(),
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });
    await daemon.start();

    await socket.fireOpen();

    expect(restClient.getPostsSince).toHaveBeenCalledWith('dm-1', 5001);
    expect(restClient.createPost).toHaveBeenCalledTimes(1);
  });

  it('on socket open with no prior watermark (fresh install), skips catch-up entirely', async () => {
    const restClient = fakeRestClient();
    const stateStore = fakeStateStore({ readLastSeen: vi.fn().mockResolvedValue(null) });
    const socket = fakeSocketClientFactory();
    const daemon = createDaemon({
      restClient,
      stateStore,
      sessionStore: fakeSessionStore(),
      logger: silentLogger(),
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });
    await daemon.start();

    await socket.fireOpen();

    expect(restClient.getPostsSince).not.toHaveBeenCalled();
  });

  it('logs loudly and does not throw when catch-up fails', async () => {
    const restClient = fakeRestClient({
      getPostsSince: vi.fn().mockRejectedValue(new Error('mattermost unreachable')),
    });
    const stateStore = fakeStateStore({ readLastSeen: vi.fn().mockResolvedValue({ ms: 5000, id: 'p0' }) });
    const logger = silentLogger();
    const socket = fakeSocketClientFactory();
    const daemon = createDaemon({
      restClient,
      stateStore,
      sessionStore: fakeSessionStore(),
      logger,
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });
    await daemon.start();

    await expect(socket.fireOpen()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('logs loudly, does not throw, and does NOT advance the watermark when posting the reply fails', async () => {
    const restClient = fakeRestClient({
      createPost: vi.fn().mockRejectedValue(new Error('mattermost 500')),
    });
    const stateStore = fakeStateStore();
    const logger = silentLogger();
    const socket = fakeSocketClientFactory();
    const daemon = createDaemon({
      restClient,
      stateStore,
      sessionStore: fakeSessionStore(),
      logger,
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });
    await daemon.start();

    await expect(socket.firePost(post())).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
    // The whole point of KAN-2: a transient post failure must not silently
    // drop the message. If the watermark advanced here, the next catch-up
    // would treat this post as already handled and never retry it.
    expect(stateStore.writeLastSeen).not.toHaveBeenCalled();
  });

  it('stop() stops the underlying socket client', async () => {
    const socket = fakeSocketClientFactory();
    const daemon = createDaemon({
      restClient: fakeRestClient(),
      stateStore: fakeStateStore(),
      sessionStore: fakeSessionStore(),
      logger: silentLogger(),
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });
    await daemon.start();

    daemon.stop();

    expect(socket.client.stop).toHaveBeenCalled();
  });
});
