import { describe, expect, it } from 'vitest';
import { createInMemorySessionStore } from './sessionStore.js';

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
});
