import { describe, expect, it } from 'vitest';
import { createInMemorySessionStore } from './sessionStore.js';
import type { Session } from './sessionStore.js';

describe('createInMemorySessionStore', () => {
  it('starts with no sessions -- nothing populates the store yet (KAN-5/KAN-6 land later)', () => {
    const store = createInMemorySessionStore();

    expect(store.listSessions()).toEqual([]);
  });

  it('returns a fresh array each call, not a reference callers could mutate to corrupt store state', () => {
    const store = createInMemorySessionStore();

    const first = store.listSessions();
    first.push({
      id: 'x',
      identifier: '#1 : host',
      host: 'host',
      status: 'running',
      harness: 'claude-code',
      folder: '/tmp',
    });

    expect(store.listSessions()).toEqual([]);
  });

  describe('addSession', () => {
    it('makes an added session show up in listSessions (KAN-5: `start` populates the store)', () => {
      const store = createInMemorySessionStore();
      const session: Session = {
        id: 'sess-1',
        identifier: '#1 : dev-vm',
        host: 'dev-vm',
        status: 'running',
        harness: 'opencode',
        folder: '/home/jon/project',
        channelId: 'chan-1',
      };

      store.addSession(session);

      expect(store.listSessions()).toEqual([session]);
    });

    it('keeps sessions added in order across multiple calls', () => {
      const store = createInMemorySessionStore();
      const first: Session = {
        id: 'a',
        identifier: '#1 : dev-vm',
        host: 'dev-vm',
        status: 'running',
        harness: 'opencode',
        folder: '/tmp/a',
      };
      const second: Session = {
        id: 'b',
        identifier: '#2 : dev-vm',
        host: 'dev-vm',
        status: 'running',
        harness: 'opencode',
        folder: '/tmp/b',
      };

      store.addSession(first);
      store.addSession(second);

      expect(store.listSessions()).toEqual([first, second]);
    });
  });

  describe('findByChannelId', () => {
    it('returns the session whose channelId matches, for routing an incoming post to its session', () => {
      const store = createInMemorySessionStore();
      const session: Session = {
        id: 'sess-1',
        identifier: '#1 : dev-vm',
        host: 'dev-vm',
        status: 'running',
        harness: 'opencode',
        folder: '/home/jon/project',
        channelId: 'chan-1',
      };
      store.addSession(session);

      expect(store.findByChannelId('chan-1')).toEqual(session);
    });

    it('returns undefined for a channel id that matches no known session', () => {
      const store = createInMemorySessionStore();

      expect(store.findByChannelId('unknown-channel')).toBeUndefined();
    });
  });

  describe('markStopped', () => {
    it('flips a running session to stopped, visible via listSessions', () => {
      const store = createInMemorySessionStore();
      store.addSession({
        id: 'sess-1',
        identifier: '#1 : dev-vm',
        host: 'dev-vm',
        status: 'running',
        harness: 'opencode',
        folder: '/home/jon/project',
        channelId: 'chan-1',
      });

      store.markStopped('sess-1');

      expect(store.listSessions()).toEqual([
        expect.objectContaining({ id: 'sess-1', status: 'stopped' }),
      ]);
    });

    it('is a no-op (not a throw) for an unknown session id -- callers may race with a session being removed elsewhere', () => {
      const store = createInMemorySessionStore();

      expect(() => store.markStopped('does-not-exist')).not.toThrow();
    });
  });
});
