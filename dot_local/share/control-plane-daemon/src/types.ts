/** A Mattermost post, normalized to the fields this daemon cares about. */
export interface IncomingPost {
  id: string;
  userId: string;
  channelId: string;
  message: string;
  createAt: number;
}

/** Identities resolved once at startup via the REST API. */
export interface RoutingContext {
  botUserId: string;
  operatorUserId: string;
  dmChannelId: string;
}

export interface ReplyDecision {
  shouldReply: boolean;
  replyMessage?: string;
}
