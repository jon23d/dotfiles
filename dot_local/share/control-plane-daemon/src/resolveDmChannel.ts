import type { MattermostRestClient } from './mattermostRestClient.js';
import type { RoutingContext } from './types.js';

/**
 * Resolve the bot's own id, the operator's id (by email), and the DM
 * channel between them -- dynamically, every time, per KAN-2's explicit
 * instruction not to hardcode any of these. Any failure here (bad token,
 * operator email typo, network issue) rejects loudly rather than falling
 * back to a stale or guessed id.
 */
export async function resolveRoutingContext(
  client: MattermostRestClient,
  operatorEmail: string,
): Promise<RoutingContext> {
  const botUserId = await client.getMyUserId();
  const operatorUserId = await client.getUserIdByEmail(operatorEmail);
  const dmChannelId = await client.getOrCreateDirectChannel(botUserId, operatorUserId);

  return { botUserId, operatorUserId, dmChannelId };
}
