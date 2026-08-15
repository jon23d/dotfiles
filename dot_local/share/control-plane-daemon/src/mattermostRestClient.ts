import { z } from 'zod';
import type { IncomingPost } from './types.js';

export interface MattermostRestClient {
  getUserIdByEmail(email: string): Promise<string>;
  getMyUserId(): Promise<string>;
  getOrCreateDirectChannel(userIdA: string, userIdB: string): Promise<string>;
  createPost(channelId: string, message: string): Promise<void>;
  getPostsSince(channelId: string, sinceMs: number): Promise<IncomingPost[]>;
}

export interface MattermostRestClientConfig {
  baseUrl: string;
  token: string;
}

const userSchema = z.object({ id: z.string().min(1) });
const channelSchema = z.object({ id: z.string().min(1) });
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
  const { baseUrl, token } = config;

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
      const data = await request(
        'GET',
        `/api/v4/channels/${encodeURIComponent(channelId)}/posts?since=${sinceMs}`,
      );
      const page = postsPageSchema.parse(data);
      return page.order
        .map((id) => page.posts[id])
        .filter((p): p is z.infer<typeof postSchema> => p !== undefined)
        .map((p) => ({
          id: p.id,
          userId: p.user_id,
          channelId: p.channel_id,
          message: p.message,
          createAt: p.create_at,
        }))
        .sort((a, b) => a.createAt - b.createAt);
    },
  };
}
