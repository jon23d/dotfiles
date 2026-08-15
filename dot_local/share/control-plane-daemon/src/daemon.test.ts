import { describe, expect, it, vi } from 'vitest';
import { createDaemon } from './daemon.js';
import { UNKNOWN_COMMAND_REPLY } from './messageRouter.js';
import type { Logger } from './logger.js';
import type { MattermostRestClient } from './mattermostRestClient.js';
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
      logger: silentLogger(),
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });
    await daemon.start();

    await socket.firePost(post({ id: 'p1', createAt: 5000 }));

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

  it('on socket open, catches up on posts since the last watermark (inclusive) and replies to each in order, deduping the already-processed post by id', async () => {
    const restClient = fakeRestClient({
      getPostsSince: vi.fn().mockResolvedValue([
        // same-millisecond as the persisted watermark -- this is the post
        // that was already processed and must be deduped by id, not skipped
        // (or kept) based on timestamp alone (KAN-2 review F2).
        post({ id: 'p0', createAt: 5000, message: 'already processed' }),
        post({ id: 'p1', createAt: 5001, message: 'first' }),
        post({ id: 'p2', createAt: 5002, message: 'second' }),
      ]),
    });
    const stateStore = fakeStateStore({ readLastSeen: vi.fn().mockResolvedValue({ ms: 5000, id: 'p0' }) });
    const socket = fakeSocketClientFactory();
    const daemon = createDaemon({
      restClient,
      stateStore,
      logger: silentLogger(),
      operatorEmail: 'jon23d@gmail.com',
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      createSocketClient: socket.factory,
    });
    await daemon.start();

    await socket.fireOpen();

    expect(restClient.getPostsSince).toHaveBeenCalledWith('dm-1', 5000);
    expect(restClient.createPost).toHaveBeenCalledTimes(2);
    expect(restClient.createPost).not.toHaveBeenCalledWith('dm-1', expect.stringContaining('already processed'));
    expect(stateStore.writeLastSeen).toHaveBeenLastCalledWith(5002, 'p2');
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
