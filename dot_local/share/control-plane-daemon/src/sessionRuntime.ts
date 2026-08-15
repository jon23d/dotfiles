import type { HarnessSessionHandle } from './harness.js';

/**
 * Maps a session's dedicated Mattermost channel id to the live handle
 * daemon.ts uses to forward operator messages into that session's harness
 * process (KAN-5 AC3). Deliberately separate from `SessionStore`:
 * `SessionStore` holds plain, renderable session data (what `list` reads);
 * this holds live behavior (a handle wired to a real child process /
 * HTTP client), which doesn't belong in a value object that tests compare
 * with `toEqual`. Both are in-memory only, for the same reason
 * `SessionStore` is (see sessionStore.ts) -- a daemon restart already loses
 * track of running sessions; this doesn't add a new gap.
 */
export interface SessionRuntimeRegistry {
  register(channelId: string, handle: HarnessSessionHandle): void;
  get(channelId: string): HarnessSessionHandle | undefined;
  remove(channelId: string): void;
}

export function createSessionRuntimeRegistry(): SessionRuntimeRegistry {
  const handles = new Map<string, HarnessSessionHandle>();

  return {
    register(channelId, handle) {
      handles.set(channelId, handle);
    },
    get(channelId) {
      return handles.get(channelId);
    },
    remove(channelId) {
      handles.delete(channelId);
    },
  };
}
