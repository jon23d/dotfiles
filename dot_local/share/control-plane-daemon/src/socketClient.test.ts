import { describe, expect, it, vi } from 'vitest';
import { createMattermostSocketClient } from './socketClient.js';
import type { Logger } from './logger.js';
import type { WebSocketLike, WebSocketListener } from './socketClient.js';

function silentLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A controllable double for the global WebSocket -- no real network. */
function fakeSocket() {
  const listeners: Record<string, WebSocketListener[]> = {};
  const sent: string[] = [];
  const socket: WebSocketLike = {
    send: (data: string) => sent.push(data),
    close: () => {
      // Real WebSockets emit a 'close' event asynchronously after close();
      // tests trigger it explicitly via emit('close', ...) to control timing.
    },
    addEventListener: (type, listener) => {
      (listeners[type] ??= []).push(listener);
    },
  };
  return {
    socket,
    sent,
    emit: (type: string, event: unknown = {}) => {
      for (const l of listeners[type] ?? []) l(event);
    },
  };
}

function postedEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: JSON.stringify({
      event: 'posted',
      data: {
        post: JSON.stringify({
          id: 'post-1',
          user_id: 'jon-1',
          channel_id: 'dm-1',
          message: 'hi',
          create_at: 1000,
          ...overrides,
        }),
      },
    }),
  };
}

describe('createMattermostSocketClient', () => {
  it('sends an authentication_challenge with the token as soon as the socket opens', () => {
    const fake = fakeSocket();
    const client = createMattermostSocketClient({
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      logger: silentLogger(),
      onPost: vi.fn(),
      createSocket: () => fake.socket,
      scheduleReconnect: vi.fn(),
    });

    client.start();
    fake.emit('open');

    expect(fake.sent).toHaveLength(1);
    expect(JSON.parse(fake.sent[0] as string)).toEqual({
      seq: 1,
      action: 'authentication_challenge',
      data: { token: 'tok-123' },
    });
  });

  it('parses a posted event and calls onPost with a normalized post', () => {
    const fake = fakeSocket();
    const onPost = vi.fn();
    const client = createMattermostSocketClient({
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      logger: silentLogger(),
      onPost,
      createSocket: () => fake.socket,
      scheduleReconnect: vi.fn(),
    });

    client.start();
    fake.emit('open');
    fake.emit('message', postedEvent());

    expect(onPost).toHaveBeenCalledWith({
      id: 'post-1',
      userId: 'jon-1',
      channelId: 'dm-1',
      message: 'hi',
      createAt: 1000,
    });
  });

  it('ignores non-posted WS events (e.g. hello) without calling onPost, crashing, or logging an error', () => {
    const fake = fakeSocket();
    const onPost = vi.fn();
    const logger = silentLogger();
    const client = createMattermostSocketClient({
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      logger,
      onPost,
      createSocket: () => fake.socket,
      scheduleReconnect: vi.fn(),
    });

    client.start();
    fake.emit('open');
    fake.emit('message', { data: JSON.stringify({ event: 'hello', data: { server_version: '9.0.0' } }) });

    expect(onPost).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs an OK command ack (e.g. the auth challenge reply) at debug level, not as an error', () => {
    const fake = fakeSocket();
    const logger = silentLogger();
    const client = createMattermostSocketClient({
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      logger,
      onPost: vi.fn(),
      createSocket: () => fake.socket,
      scheduleReconnect: vi.fn(),
    });

    client.start();
    fake.emit('open');
    fake.emit('message', { data: JSON.stringify({ status: 'OK', seq_reply: 1 }) });

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('logs a non-OK command ack (e.g. a rejected auth challenge) loudly as an error', () => {
    const fake = fakeSocket();
    const logger = silentLogger();
    const client = createMattermostSocketClient({
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      logger,
      onPost: vi.fn(),
      createSocket: () => fake.socket,
      scheduleReconnect: vi.fn(),
    });

    client.start();
    fake.emit('open');
    fake.emit('message', { data: JSON.stringify({ status: 'FAIL', seq_reply: 1, error: { message: 'invalid token' } }) });

    expect(logger.error).toHaveBeenCalled();
  });

  it('logs an error and does not crash when a message event contains invalid JSON', () => {
    const fake = fakeSocket();
    const logger = silentLogger();
    const onPost = vi.fn();
    const client = createMattermostSocketClient({
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      logger,
      onPost,
      createSocket: () => fake.socket,
      scheduleReconnect: vi.fn(),
    });

    client.start();
    fake.emit('open');
    expect(() => fake.emit('message', { data: 'not json{{{' })).not.toThrow();

    expect(onPost).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('logs the raw error event loudly -- never swallowed', () => {
    const fake = fakeSocket();
    const logger = silentLogger();
    const client = createMattermostSocketClient({
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      logger,
      onPost: vi.fn(),
      createSocket: () => fake.socket,
      scheduleReconnect: vi.fn(),
    });

    client.start();
    fake.emit('error', { message: 'boom' });

    expect(logger.error).toHaveBeenCalled();
  });

  it('on close, logs a warning and schedules a reconnect using the injected backoff for attempt 1', () => {
    const fake = fakeSocket();
    const logger = silentLogger();
    const scheduleReconnect = vi.fn();
    const backoffMs = vi.fn().mockReturnValue(1234);
    const client = createMattermostSocketClient({
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      logger,
      onPost: vi.fn(),
      createSocket: () => fake.socket,
      scheduleReconnect,
      backoffMs,
    });

    client.start();
    fake.emit('close', { code: 1006, reason: 'abnormal' });

    expect(logger.warn).toHaveBeenCalled();
    expect(backoffMs).toHaveBeenCalledWith(1);
    expect(scheduleReconnect).toHaveBeenCalledWith(expect.any(Function), 1234);
  });

  it('increments the attempt number across successive drops, and resets it after a clean re-open', () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const scheduleReconnect = vi.fn((fn: () => void) => fn()); // run reconnect synchronously
    const backoffMs = vi.fn().mockReturnValue(1);
    const client = createMattermostSocketClient({
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      logger: silentLogger(),
      onPost: vi.fn(),
      createSocket: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s.socket;
      },
      scheduleReconnect,
      backoffMs,
    });

    client.start();
    sockets[0]?.emit('close'); // attempt 1 -> reconnect creates socket[1]
    sockets[1]?.emit('close'); // attempt 2 -> reconnect creates socket[2]

    expect(backoffMs).toHaveBeenNthCalledWith(1, 1);
    expect(backoffMs).toHaveBeenNthCalledWith(2, 2);

    sockets[2]?.emit('open'); // clean re-open resets the counter
    sockets[2]?.emit('close'); // next drop should be attempt 1 again

    expect(backoffMs).toHaveBeenNthCalledWith(3, 1);
  });

  it('stop() prevents a subsequent close event from scheduling a reconnect', () => {
    const fake = fakeSocket();
    const scheduleReconnect = vi.fn();
    const client = createMattermostSocketClient({
      wsUrl: 'wss://mattermost.example.com/api/v4/websocket',
      token: 'tok-123',
      logger: silentLogger(),
      onPost: vi.fn(),
      createSocket: () => fake.socket,
      scheduleReconnect,
    });

    client.start();
    client.stop();
    fake.emit('close', { code: 1000, reason: 'stopped' });

    expect(scheduleReconnect).not.toHaveBeenCalled();
  });
});
