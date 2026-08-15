import { decideReply } from './messageRouter.js';
import { resolveRoutingContext } from './resolveDmChannel.js';
import { createMattermostSocketClient } from './socketClient.js';
import type { Logger } from './logger.js';
import type { MattermostRestClient } from './mattermostRestClient.js';
import type { MattermostSocketClient, MattermostSocketClientConfig } from './socketClient.js';
import type { StateStore } from './stateStore.js';
import type { IncomingPost, RoutingContext } from './types.js';

export interface Daemon {
  start(): Promise<void>;
  stop(): void;
}

export interface DaemonConfig {
  restClient: MattermostRestClient;
  stateStore: StateStore;
  logger: Logger;
  operatorEmail: string;
  wsUrl: string;
  token: string;
  createSocketClient?: (config: MattermostSocketClientConfig) => MattermostSocketClient;
}

/**
 * Wires the pieces together: resolve who's who, open the socket, route
 * incoming DMs to a reply, and catch up on anything missed while
 * disconnected. Every code path here either succeeds or logs loudly and
 * keeps running -- nothing is allowed to take the process down silently
 * except a genuinely fatal startup failure (bad token, unresolvable
 * operator email), which index.ts turns into a loud non-zero exit so
 * systemd's Restart=always and journald both see it.
 */
export function createDaemon(config: DaemonConfig): Daemon {
  const {
    restClient,
    stateStore,
    logger,
    operatorEmail,
    wsUrl,
    token,
    createSocketClient = createMattermostSocketClient,
  } = config;

  let context: RoutingContext | undefined;
  let socketClient: MattermostSocketClient | undefined;

  async function replyIfWarranted(post: IncomingPost): Promise<void> {
    if (!context) return; // should be unreachable once start() has resolved
    const decision = decideReply(post, context);
    if (!decision.shouldReply || decision.replyMessage === undefined) return;

    try {
      await restClient.createPost(context.dmChannelId, decision.replyMessage);
    } catch (err) {
      logger.error('failed to post reply to Mattermost', { err, postId: post.id });
    }

    try {
      await stateStore.writeLastSeenMs(post.createAt);
    } catch (err) {
      logger.error('failed to persist last-seen watermark', { err, postId: post.id });
    }
  }

  async function handlePost(post: IncomingPost): Promise<void> {
    try {
      await replyIfWarranted(post);
    } catch (err) {
      // Belt-and-braces: replyIfWarranted already catches its own I/O, but
      // nothing here may ever throw back into the socket client's fire-and
      // forget call site, or Node reports an unhandled rejection and moves
      // on without anyone noticing.
      logger.error('unexpected error handling incoming post', { err, postId: post.id });
    }
  }

  async function catchUp(): Promise<void> {
    if (!context) return;
    try {
      const lastSeenMs = await stateStore.readLastSeenMs();
      if (lastSeenMs === null) {
        logger.info('no prior watermark -- skipping catch-up (fresh install)');
        return;
      }
      const missed = await restClient.getPostsSince(context.dmChannelId, lastSeenMs + 1);
      logger.info('catch-up fetched missed posts', { count: missed.length });
      for (const post of missed) {
        await replyIfWarranted(post);
      }
    } catch (err) {
      logger.error('catch-up after (re)connect failed', { err });
    }
  }

  return {
    async start() {
      context = await resolveRoutingContext(restClient, operatorEmail);
      logger.info('resolved routing context', { ...context });

      socketClient = createSocketClient({
        wsUrl,
        token,
        logger,
        // handlePost/catchUp are typed void-returning here (matching
        // MattermostSocketClientConfig) but each fully catches its own
        // errors and returns the settled promise -- the socket client
        // never awaits it, but tests can, for deterministic assertions.
        onPost: (post) => handlePost(post),
        onOpen: () => catchUp(),
      });
      socketClient.start();
    },

    stop() {
      socketClient?.stop();
    },
  };
}
