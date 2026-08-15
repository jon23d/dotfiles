import { describe, expect, it, vi } from 'vitest';
import { resolveRoutingContext } from './resolveDmChannel.js';
import type { MattermostRestClient } from './mattermostRestClient.js';

function fakeClient(overrides: Partial<MattermostRestClient> = {}): MattermostRestClient {
  return {
    getUserIdByEmail: vi.fn().mockResolvedValue('jon-user-id'),
    getMyUserId: vi.fn().mockResolvedValue('bot-user-id'),
    getOrCreateDirectChannel: vi.fn().mockResolvedValue('dm-channel-id'),
    createPost: vi.fn().mockResolvedValue(undefined),
    getPostsSince: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('resolveRoutingContext', () => {
  it('resolves the bot id, operator id, and DM channel id, looking up the operator by email', async () => {
    const client = fakeClient();

    const context = await resolveRoutingContext(client, 'jon23d@gmail.com');

    expect(context).toEqual({
      botUserId: 'bot-user-id',
      operatorUserId: 'jon-user-id',
      dmChannelId: 'dm-channel-id',
    });
    expect(client.getUserIdByEmail).toHaveBeenCalledWith('jon23d@gmail.com');
  });

  it('creates the direct channel with the bot id and operator id, in that order', async () => {
    const client = fakeClient();

    await resolveRoutingContext(client, 'jon23d@gmail.com');

    expect(client.getOrCreateDirectChannel).toHaveBeenCalledWith('bot-user-id', 'jon-user-id');
  });

  it('propagates a failure resolving the operator id loudly, without falling back to a guess', async () => {
    const client = fakeClient({
      getUserIdByEmail: vi.fn().mockRejectedValue(new Error('user not found')),
    });

    await expect(resolveRoutingContext(client, 'nope@example.com')).rejects.toThrow('user not found');
  });

  it('propagates a failure resolving the bot own id loudly', async () => {
    const client = fakeClient({
      getMyUserId: vi.fn().mockRejectedValue(new Error('401 unauthorized')),
    });

    await expect(resolveRoutingContext(client, 'jon23d@gmail.com')).rejects.toThrow('401 unauthorized');
  });
});
