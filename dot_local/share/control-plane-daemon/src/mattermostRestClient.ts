import { z } from 'zod';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';
import type { IncomingPost } from './types.js';

export interface Team {
  id: string;
  name: string;
}

export interface MattermostRestClient {
  getUserIdByEmail(email: string): Promise<string>;
  getMyUserId(): Promise<string>;
  getOrCreateDirectChannel(userIdA: string, userIdB: string): Promise<string>;
  createPost(channelId: string, message: string): Promise<void>;
  getPostsSince(channelId: string, sinceMs: number): Promise<IncomingPost[]>;
  /** Every team the bot belongs to. Empty when the bot hasn't been added to
   * any team yet -- the known KAN-5 blocker that prevents channel creation. */
  getMyTeams(): Promise<Team[]>;
  /** Creates a private ('P') channel in `teamId` -- Mattermost allows only
   * one DM per user pair, so a session's dedicated chat must be a private
   * channel the bot creates and adds the operator to, not a second DM (see
   * KAN-5 Jira comment). Returns the new channel's id. */
  createPrivateChannel(teamId: string, name: string, displayName: string): Promise<string>;
  addChannelMember(channelId: string, userId: string): Promise<void>;
  /** Archives (soft-deletes) a channel -- used to clean up a session channel
   * that was created but couldn't be fully set up (e.g. the operator
   * couldn't be added to it), so it doesn't leak as an invisible orphan. */
  archiveChannel(channelId: string): Promise<void>;
  /**
   * Renames a channel's slug (`name`) and human-facing `display_name`
   * (KAN-7: the agent renaming its own session chat once it knows a
   * concrete work identity). Throws on any failure -- including the name
   * colliding with another channel's slug, which Mattermost rejects
   * server-side -- so the caller can surface it rather than silently
   * leaving the old name in place.
   */
  renameChannel(channelId: string, name: string, displayName: string): Promise<void>;
}

export interface MattermostRestClientConfig {
  baseUrl: string;
  token: string;
  logger?: Logger;
}

// Mattermost's `since` query param is documented to return at most this
// many posts per call, with no page/per_page cursor of its own (since must
// not be combined with page/per_page/before/after). A long outage can
// accumulate more than this, so getPostsSince below loops, re-issuing with
// a later boundary whenever a page comes back at exactly the cap, instead
// of silently returning a truncated result (KAN-2 review F3).
const SINCE_PAGE_CAP = 1000;

const userSchema = z.object({ id: z.string().min(1) });
const channelSchema = z.object({ id: z.string().min(1) });
const teamSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const teamsSchema = z.array(teamSchema);
const postSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  channel_id: z.string().min(1),
  message: z.string(),
  create_at: z.number(),
});
const postsPageSchema = z.object({
  order: z.array(z.string()),
  posts: z.record(z.string(), postSchema),
});

/**
 * Thin wrapper over Mattermost's REST API v4. Every non-2xx or network-level
 * failure throws with the HTTP method, path, status, and response body
 * inlined -- callers must not have to guess why a request failed, and
 * nothing here is allowed to fail silently (see KAN-2's whole reason for
 * existing).
 */
export function createMattermostRestClient(config: MattermostRestClientConfig): MattermostRestClient {
  const { baseUrl, token, logger = createLogger('mattermostRestClient') } = config;

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      throw new Error(`Mattermost REST ${method} ${path} failed: network error`, { cause });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '<unreadable body>');
      throw new Error(`Mattermost REST ${method} ${path} failed: ${response.status} ${response.statusText} - ${text}`);
    }

    if (response.status === 204) return undefined;
    return response.json();
  }

  return {
    async getUserIdByEmail(email) {
      const data = await request('GET', `/api/v4/users/email/${encodeURIComponent(email)}`);
      return userSchema.parse(data).id;
    },

    async getMyUserId() {
      const data = await request('GET', '/api/v4/users/me');
      return userSchema.parse(data).id;
    },

    async getOrCreateDirectChannel(userIdA, userIdB) {
      const data = await request('POST', '/api/v4/channels/direct', [userIdA, userIdB]);
      return channelSchema.parse(data).id;
    },

    async createPost(channelId, message) {
      await request('POST', '/api/v4/posts', { channel_id: channelId, message });
    },

    async getPostsSince(channelId, sinceMs) {
      const all: IncomingPost[] = [];
      let cursor = sinceMs;

      for (;;) {
        const data = await request(
          'GET',
          `/api/v4/channels/${encodeURIComponent(channelId)}/posts?since=${cursor}`,
        );
        const page = postsPageSchema.parse(data);
        const posts = page.order
          .map((id) => page.posts[id])
          .filter((p): p is z.infer<typeof postSchema> => p !== undefined)
          .map((p) => ({
            id: p.id,
            userId: p.user_id,
            channelId: p.channel_id,
            message: p.message,
            createAt: p.create_at,
          }));
        all.push(...posts);

        if (posts.length < SINCE_PAGE_CAP) break;

        const newestMs = posts.reduce((max, p) => Math.max(max, p.createAt), cursor);
        if (newestMs < cursor) break; // defensive: never loop forever if the API misbehaves

        logger.warn('catch-up hit the Mattermost `since` page cap -- fetching the next page', {
          channelId,
          cursor,
          pageSize: posts.length,
        });
        cursor = newestMs + 1;
      }

      return all.sort((a, b) => a.createAt - b.createAt);
    },

    async getMyTeams() {
      const data = await request('GET', '/api/v4/users/me/teams');
      return teamsSchema.parse(data);
    },

    async createPrivateChannel(teamId, name, displayName) {
      const data = await request('POST', '/api/v4/channels', {
        team_id: teamId,
        name,
        display_name: displayName,
        type: 'P',
      });
      return channelSchema.parse(data).id;
    },

    async addChannelMember(channelId, userId) {
      await request('POST', `/api/v4/channels/${encodeURIComponent(channelId)}/members`, { user_id: userId });
    },

    async archiveChannel(channelId) {
      await request('DELETE', `/api/v4/channels/${encodeURIComponent(channelId)}`);
    },

    async renameChannel(channelId, name, displayName) {
      await request('PUT', `/api/v4/channels/${encodeURIComponent(channelId)}`, {
        id: channelId,
        name,
        display_name: displayName,
      });
    },
  };
}
