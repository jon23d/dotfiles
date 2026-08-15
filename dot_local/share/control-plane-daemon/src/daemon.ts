import { hostname as osHostname } from 'node:os';
import { createHarnessRegistry } from './harnessRegistry.js';
import { decideReply } from './messageRouter.js';
import { resolveRoutingContext } from './resolveDmChannel.js';
import { createSessionRuntimeRegistry } from './sessionRuntime.js';
import { createMattermostSocketClient } from './socketClient.js';
import type { HarnessAdapter } from './harness.js';
import type { KnownHarnessName } from './harnessRegistry.js';
import type { Logger } from './logger.js';
import type { MattermostRestClient } from './mattermostRestClient.js';
import type { RouterDeps } from './messageRouter.js';
import type { SessionRuntimeRegistry } from './sessionRuntime.js';
import type { SessionStore } from './sessionStore.js';
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
  sessionStore: SessionStore;
  logger: Logger;
  operatorEmail: string;
  wsUrl: string;
  token: string;
  createSocketClient?: (config: MattermostSocketClientConfig) => MattermostSocketClient;
  /** Live handle registry for forwarding session-channel messages (KAN-5 AC3). Defaults to a fresh in-memory registry. */
  sessionRuntime?: SessionRuntimeRegistry;
  /** Harness dispatch table for `start` (KAN-5). Defaults to the real registry (opencode only -- see harnessRegistry.ts). */
  harnesses?: Partial<Record<KnownHarnessName, HarnessAdapter>>;
  /** Allocates and persists the next `start` session number. Defaults to an in-memory (non-persisted) counter -- index.ts wires the real file-backed one (sessionNumberStore.ts). */
  allocateSessionNumber?: () => Promise<number>;
  /** The VM's hostname, used in `start`'s `#<n> : <hostName>` identifier. Defaults to `os.hostname()`. */
  hostname?: string;
}

function defaultAllocateSessionNumber(): () => Promise<number> {
  let next = 1;
  return () => Promise.resolve(next++);
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
    sessionStore,
    logger,
    operatorEmail,
    wsUrl,
    token,
    createSocketClient = createMattermostSocketClient,
    sessionRuntime = createSessionRuntimeRegistry(),
    harnesses = createHarnessRegistry(),
    allocateSessionNumber = defaultAllocateSessionNumber(),
    hostname = osHostname(),
  } = config;

  let context: RoutingContext | undefined;
  let routerDeps: RouterDeps | undefined;
  let socketClient: MattermostSocketClient | undefined;

  async function replyIfWarranted(post: IncomingPost): Promise<void> {
    if (!context || !routerDeps) return; // should be unreachable once start() has resolved
    const decision = await decideReply(post, context, routerDeps);
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

  /**
   * KAN-5 AC3: a message posted in a session's dedicated channel must reach
   * that session specifically, not the control plane or another session.
   * Deliberately silent on success (no chat reply posted here) -- relaying
   * the harness's own output back into Mattermost is a distinct, larger
   * feature this ticket's ACs don't require; only failure paths post back,
   * per the epic's "never fail silently" principle.
   */
  async function forwardToSessionIfApplicable(post: IncomingPost): Promise<void> {
    if (!context) return;
    const session = sessionStore.findByChannelId(post.channelId);
    if (!session) return; // not a channel this daemon manages -- nothing to do
    if (post.userId === context.botUserId) return; // never react to our own posts
    if (post.userId !== context.operatorUserId) return; // only the operator's messages are forwarded

    if (session.status !== 'running') {
      await restClient
        .createPost(post.channelId, `Session \`${session.identifier}\` is stopped and can't receive messages.`)
        .catch((err: unknown) => {
          logger.error('failed to post stopped-session notice', { err, channelId: post.channelId });
        });
      return;
    }

    const handle = sessionRuntime.get(post.channelId);
    if (!handle) {
      logger.error('session marked running but has no live runtime handle to forward to', {
        sessionId: session.id,
        channelId: post.channelId,
      });
      await restClient
        .createPost(
          post.channelId,
          `Internal error: \`${session.identifier}\` has no live process to receive your message.`,
        )
        .catch((err: unknown) => {
          logger.error('failed to post internal-error notice', { err, channelId: post.channelId });
        });
      return;
    }

    try {
      await handle.sendPrompt(post.message);
      logger.info('forwarded message to session', { sessionId: session.id, channelId: post.channelId, postId: post.id });
    } catch (err) {
      logger.error('failed to forward message to session', {
        err,
        sessionId: session.id,
        channelId: post.channelId,
        postId: post.id,
      });
      const errMessage = err instanceof Error ? err.message : String(err);
      await restClient
        .createPost(post.channelId, `Failed to deliver your message to \`${session.identifier}\`: ${errMessage}`)
        .catch((postErr: unknown) => {
          logger.error('failed to post forwarding-failure notice', { err: postErr, channelId: post.channelId });
        });
    }
  }

  async function handlePost(post: IncomingPost): Promise<void> {
    try {
      if (!context) return; // should be unreachable once start() has resolved
      if (post.channelId === context.dmChannelId) {
        await replyIfWarranted(post);
        return;
      }
      await forwardToSessionIfApplicable(post);
    } catch (err) {
      // Belt-and-braces: both branches above already catch their own I/O,
      // but nothing here may ever throw back into the socket client's
      // fire-and-forget call site, or Node reports an unhandled rejection
      // and moves on without anyone noticing.
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
      // time alone can silently skip one of them (KAN-2 review F2). Mattermost's
      // `since` filter is a strict server-side exclusive boundary
      // (`WHERE UpdateAt > ?`), not inclusive of the exact millisecond (KAN-2
      // review F2b) -- so querying with `since = lastSeen.ms` never returns a
      // sibling post that shares lastSeen's exact millisecond; the server
      // drops it before it ever reaches our dedupe-by-id filter below. To
      // actually get that sibling back from the server, we query one
      // millisecond *below* the watermark and then dedupe client-side by id
      // (not by timestamp), which is exact. Older state files that predate id
      // tracking don't have an id to dedupe against, so they fall back to the
      // original exclusive `ms + 1` boundary for this one catch-up.
      const sinceMs = lastSeen.id === null ? lastSeen.ms + 1 : lastSeen.ms - 1;
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
      routerDeps = {
        restClient,
        sessionStore,
        sessionRuntime,
        harnesses,
        allocateSessionNumber,
        logger,
        hostname,
        operatorUserId: context.operatorUserId,
      };

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
