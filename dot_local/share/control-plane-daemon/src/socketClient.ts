import { z } from 'zod';
import { computeBackoffMs } from './reconnectBackoff.js';
import type { Logger } from './logger.js';
import type { IncomingPost } from './types.js';

/** Minimal surface of the WebSocket API this module needs -- lets tests
 * supply a fake instead of hitting a real socket. Node's global
 * `WebSocket` (and the browser one) both satisfy this shape. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: WebSocketListener): void;
}

export type WebSocketListener = (event: unknown) => void;

/** Real WebSocket 'message'/'close'/'error' events all carry different
 * shapes; narrow defensively instead of assuming a `.data` field exists. */
function extractEventData(event: unknown): unknown {
  if (typeof event === 'object' && event !== null && 'data' in event) {
    return (event as Record<string, unknown>).data;
  }
  return undefined;
}

export interface MattermostSocketClient {
  start(): void;
  stop(): void;
}

export interface MattermostSocketClientConfig {
  wsUrl: string;
  token: string;
  logger: Logger;
  onPost: (post: IncomingPost) => void;
  /** Called on every successful connection (before/after auth challenge is
   * sent) -- daemon.ts uses this hook to trigger REST catch-up. */
  onOpen?: () => void;
  createSocket?: (url: string) => WebSocketLike;
  scheduleReconnect?: (fn: () => void, delayMs: number) => void;
  backoffMs?: (attempt: number) => number;
}

// Mattermost's WS stream carries many event types (hello, status_change,
// typing, ...) that never have a `post` field -- only validate the base
// shape here, and validate the posted-specific `data.post` field
// separately, only once we know `event === 'posted'`. Otherwise every
// non-post event would log as a schema-validation "error", drowning out
// genuine anomalies.
const wsEnvelopeSchema = z.object({
  event: z.string(),
  data: z.unknown().optional(),
});

const postedEventDataSchema = z.object({ post: z.string() }).passthrough();

// Command acks (the reply to our own authentication_challenge, ping/pong,
// etc.) come back as `{status, seq_reply}` -- a different shape than a
// pushed `event`. Recognize this shape explicitly so it doesn't get logged
// as a schema-validation error.
const statusReplySchema = z.object({ status: z.string(), seq_reply: z.number().optional() }).passthrough();

const postSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  channel_id: z.string().min(1),
  message: z.string(),
  create_at: z.number(),
});

function defaultCreateSocket(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

/**
 * Owns the single Mattermost real-time WebSocket connection: sends the
 * authentication_challenge on open, decodes `posted` events into
 * IncomingPost, and reconnects with exponential backoff on every drop.
 * Every failure mode (bad JSON, socket error, disconnect) is logged -- none
 * of them silently stop the daemon from trying again.
 */
export function createMattermostSocketClient(config: MattermostSocketClientConfig): MattermostSocketClient {
  const {
    wsUrl,
    token,
    logger,
    onPost,
    onOpen,
    createSocket = defaultCreateSocket,
    scheduleReconnect = (fn, delayMs) => setTimeout(fn, delayMs),
    backoffMs = (attempt) => computeBackoffMs(attempt),
  } = config;

  let stopped = false;
  let attempt = 0;
  let current: WebSocketLike | undefined;

  function handleOpen(): void {
    attempt = 0; // a clean open means we're healthy again -- reset backoff
    logger.info('websocket connected, sending auth challenge');
    current?.send(JSON.stringify({ seq: 1, action: 'authentication_challenge', data: { token } }));
    onOpen?.();
  }

  function handleMessage(event: unknown): void {
    const raw = extractEventData(event);
    if (typeof raw !== 'string') {
      logger.error('websocket message had non-string payload', { raw });
      return;
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch (cause) {
      logger.error('failed to parse websocket message as JSON', { cause, raw });
      return;
    }

    const parsedEnvelope = wsEnvelopeSchema.safeParse(envelope);
    if (!parsedEnvelope.success) {
      const parsedStatusReply = statusReplySchema.safeParse(envelope);
      if (parsedStatusReply.success) {
        const { status, seq_reply: seqReply } = parsedStatusReply.data;
        if (status === 'OK') {
          logger.debug('websocket command acknowledged', { status, seqReply });
        } else {
          // A non-OK ack (e.g. a rejected authentication_challenge) is a
          // real problem the operator needs to see, not routine chatter.
          logger.error('websocket command was rejected by the server', { status, seqReply });
        }
        return;
      }
      logger.error('websocket message did not match expected envelope shape', {
        issues: parsedEnvelope.error.issues,
      });
      return;
    }

    if (parsedEnvelope.data.event !== 'posted') {
      logger.debug('ignoring non-posted websocket event', { event: parsedEnvelope.data.event });
      return; // hello/status/typing/etc -- not our concern
    }

    const parsedPostedData = postedEventDataSchema.safeParse(parsedEnvelope.data.data);
    if (!parsedPostedData.success) {
      logger.error('posted event was missing its post payload', { issues: parsedPostedData.error.issues });
      return;
    }
    const postRaw = parsedPostedData.data.post;

    let postJson: unknown;
    try {
      postJson = JSON.parse(postRaw);
    } catch (cause) {
      logger.error('failed to parse embedded post JSON', { cause, postRaw });
      return;
    }

    const parsedPost = postSchema.safeParse(postJson);
    if (!parsedPost.success) {
      logger.error('post payload did not match expected shape', { issues: parsedPost.error.issues });
      return;
    }

    const p = parsedPost.data;
    logger.info('received post', { postId: p.id, userId: p.user_id, channelId: p.channel_id });
    onPost({ id: p.id, userId: p.user_id, channelId: p.channel_id, message: p.message, createAt: p.create_at });
  }

  function handleError(event: unknown): void {
    logger.error('websocket error', { event });
  }

  function handleClose(event: unknown): void {
    if (stopped) {
      logger.info('websocket closed after stop() -- not reconnecting', { event });
      return;
    }
    attempt += 1;
    const delayMs = backoffMs(attempt);
    logger.warn('websocket closed, scheduling reconnect', { attempt, delayMs, event });
    scheduleReconnect(() => connect(), delayMs);
  }

  function connect(): void {
    logger.info('connecting to websocket', { wsUrl, attempt });
    const socket = createSocket(wsUrl);
    current = socket;
    socket.addEventListener('open', handleOpen);
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('error', handleError);
    socket.addEventListener('close', handleClose);
  }

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      current?.close();
    },
  };
}
