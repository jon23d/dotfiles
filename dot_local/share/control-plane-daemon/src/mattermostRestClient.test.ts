import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMattermostRestClient } from './mattermostRestClient.js';

const BASE_URL = 'https://mattermost.example.com';
const TOKEN = 'test-token-123';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function client() {
  return createMattermostRestClient({ baseUrl: BASE_URL, token: TOKEN });
}

describe('createMattermostRestClient', () => {
  it('getUserIdByEmail resolves the id for the given email, authenticated with the bot token', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v4/users/email/:email`, ({ request, params }) => {
        expect(request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
        expect(params.email).toBe('jon23d@gmail.com');
        return HttpResponse.json({ id: 'jon-user-id' });
      }),
    );

    const id = await client().getUserIdByEmail('jon23d@gmail.com');

    expect(id).toBe('jon-user-id');
  });

  it('getMyUserId resolves the bot own id', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v4/users/me`, () => HttpResponse.json({ id: 'bot-user-id' })),
    );

    const id = await client().getMyUserId();

    expect(id).toBe('bot-user-id');
  });

  it('getOrCreateDirectChannel posts both user ids and returns the channel id', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v4/channels/direct`, async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual(['bot-user-id', 'jon-user-id']);
        return HttpResponse.json({ id: 'dm-channel-id' });
      }),
    );

    const id = await client().getOrCreateDirectChannel('bot-user-id', 'jon-user-id');

    expect(id).toBe('dm-channel-id');
  });

  it('createPost posts the channel id and message', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v4/posts`, async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({ channel_id: 'dm-channel-id', message: 'Unknown command. Try `help`.' });
        return HttpResponse.json({ id: 'new-post-id' });
      }),
    );

    await expect(
      client().createPost('dm-channel-id', 'Unknown command. Try `help`.'),
    ).resolves.toBeUndefined();
  });

  it('getPostsSince maps and orders posts oldest-first', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v4/channels/:channelId/posts`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('since')).toBe('1000');
        return HttpResponse.json({
          order: ['p2', 'p1'],
          posts: {
            p1: { id: 'p1', user_id: 'jon-1', channel_id: 'dm-1', message: 'first', create_at: 1100 },
            p2: { id: 'p2', user_id: 'jon-1', channel_id: 'dm-1', message: 'second', create_at: 1200 },
          },
        });
      }),
    );

    const posts = await client().getPostsSince('dm-1', 1000);

    expect(posts.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(posts[0]).toEqual({
      id: 'p1',
      userId: 'jon-1',
      channelId: 'dm-1',
      message: 'first',
      createAt: 1100,
    });
  });

  it('throws a loud error including status and body when the API responds non-2xx', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v4/users/me`, () =>
        HttpResponse.json({ message: 'invalid or expired session' }, { status: 401 }),
      ),
    );

    await expect(client().getMyUserId()).rejects.toThrow(/401/);
  });

  it('throws a loud error on a network-level failure, never resolving silently', async () => {
    server.use(http.get(`${BASE_URL}/api/v4/users/me`, () => HttpResponse.error()));

    await expect(client().getMyUserId()).rejects.toThrow();
  });
});
