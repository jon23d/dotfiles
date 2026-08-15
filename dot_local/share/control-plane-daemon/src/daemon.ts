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
      logger.info('posted reply to Mattermost', { postId: post.id, channelId: context.dmChannelId });
    } catch (err) {
      logger.error('failed to post reply to Mattermost', { err, postId: post.id });
      // Do NOT advance the watermark here: if we did, the next catch-up
      // would treat this post as already handled and it would never be
      // retried, silently dropping the operator's message on a transient
      // Mattermost failure (KAN-2 review F1). Leaving the watermark alone
      // means this exact post is fetched and retried on the next catch-up.
      return;
    }

    try {
      await stateStore.writeLastSeen(post.createAt, post.id);
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
      const lastSeen = await stateStore.readLastSeen();
      if (lastSeen === null) {
        logger.info('no prior watermark -- skipping catch-up (fresh install)');
        return;
      }
      // Same-millisecond posts can share createAt, so a boundary based on
      // time alone can silently skip one of them (KAN-2 review F2). When we
      // know the last-processed post's id, fetch inclusively and dedupe by
      // id, which is exact. Older state files that predate id tracking
      // don't have an id to dedupe against, so they fall back to the
      // original exclusive `ms + 1` boundary for this one catch-up.
      const sinceMs = lastSeen.id === null ? lastSeen.ms + 1 : lastSeen.ms;
      const fetched = await restClient.getPostsSince(context.dmChannelId, sinceMs);
      const missed = lastSeen.id === null ? fetched : fetched.filter((p) => p.id !== lastSeen.id);
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
