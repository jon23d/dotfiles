import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

  it('paginates past the `since` endpoint\'s 1000-post page cap instead of silently truncating a large backlog', async () => {
    const CAP = 1000;
    const firstPage = Array.from({ length: CAP }, (_, i) => ({
      id: `p${i}`,
      user_id: 'jon-1',
      channel_id: 'dm-1',
      message: `msg${i}`,
      create_at: 1000 + i,
    }));
    const secondPage = [
      { id: 'p-last', user_id: 'jon-1', channel_id: 'dm-1', message: 'final', create_at: 1000 + CAP },
    ];
    const newestFirstPageMs = 1000 + CAP - 1;

    let calls = 0;
    server.use(
      http.get(`${BASE_URL}/api/v4/channels/:channelId/posts`, ({ request }) => {
        calls += 1;
        const since = new URL(request.url).searchParams.get('since');
        if (calls === 1) {
          expect(since).toBe('1000');
          return HttpResponse.json({
            order: firstPage.map((p) => p.id),
            posts: Object.fromEntries(firstPage.map((p) => [p.id, p])),
          });
        }
        expect(since).toBe(String(newestFirstPageMs + 1));
        return HttpResponse.json({
          order: secondPage.map((p) => p.id),
          posts: Object.fromEntries(secondPage.map((p) => [p.id, p])),
        });
      }),
    );

    const warn = vi.fn();
    const c = createMattermostRestClient({
      baseUrl: BASE_URL,
      token: TOKEN,
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });

    const posts = await c.getPostsSince('dm-1', 1000);

    expect(calls).toBe(2);
    expect(posts).toHaveLength(CAP + 1);
    expect(posts[posts.length - 1]?.id).toBe('p-last');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('page cap'), expect.any(Object));
  });

  it('does not paginate further when a page comes back short of the cap', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v4/channels/:channelId/posts`, () =>
        HttpResponse.json({
          order: ['p1'],
          posts: { p1: { id: 'p1', user_id: 'jon-1', channel_id: 'dm-1', message: 'only one', create_at: 1100 } },
        }),
      ),
    );

    const posts = await client().getPostsSince('dm-1', 1000);

    expect(posts).toHaveLength(1);
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

  it('getMyTeams resolves the ids of every team the bot belongs to', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v4/users/me/teams`, ({ request }) => {
        expect(request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
        return HttpResponse.json([
          { id: 'team-1', name: 'devops' },
          { id: 'team-2', name: 'eng' },
        ]);
      }),
    );

    const teams = await client().getMyTeams();

    expect(teams).toEqual([
      { id: 'team-1', name: 'devops' },
      { id: 'team-2', name: 'eng' },
    ]);
  });

  it('getMyTeams resolves an empty array when the bot belongs to zero teams (the KAN-5 blocker)', async () => {
    server.use(http.get(`${BASE_URL}/api/v4/users/me/teams`, () => HttpResponse.json([])));

    await expect(client().getMyTeams()).resolves.toEqual([]);
  });

  it('createPrivateChannel posts team/name/display_name/type=P and returns the new channel id', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v4/channels`, async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({
          team_id: 'team-1',
          name: 'session-4-devsix',
          display_name: '#4 : devsix',
          type: 'P',
        });
        return HttpResponse.json({ id: 'new-channel-id' });
      }),
    );

    const id = await client().createPrivateChannel('team-1', 'session-4-devsix', '#4 : devsix');

    expect(id).toBe('new-channel-id');
  });

  it('createPrivateChannel throws a loud error including status and body on failure (e.g. duplicate slug)', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v4/channels`, () =>
        HttpResponse.json({ message: 'A channel with that name already exists' }, { status: 400 }),
      ),
    );

    await expect(client().createPrivateChannel('team-1', 'dup', 'dup')).rejects.toThrow(/400/);
  });

  it('addChannelMember posts the user id to add to the channel', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v4/channels/chan-1/members`, async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({ user_id: 'jon-user-id' });
        return HttpResponse.json({ channel_id: 'chan-1', user_id: 'jon-user-id' });
      }),
    );

    await expect(client().addChannelMember('chan-1', 'jon-user-id')).resolves.toBeUndefined();
  });

  it('addChannelMember throws a loud error on failure', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v4/channels/chan-1/members`, () =>
        HttpResponse.json({ message: 'forbidden' }, { status: 403 }),
      ),
    );

    await expect(client().addChannelMember('chan-1', 'jon-user-id')).rejects.toThrow(/403/);
  });
});
