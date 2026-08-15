import { describe, expect, it } from 'vitest';
import { renderSessionList } from './listCommand.js';
import type { Session } from './sessionStore.js';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    identifier: '#1 : dev-vm',
    host: 'dev-vm',
    status: 'running',
    harness: 'claude-code',
    folder: '/home/jon/project',
    ...overrides,
  };
}

describe('renderSessionList', () => {
  it('returns a clear "no sessions" reply when the store is empty', () => {
    const output = renderSessionList([]);

    expect(output).toMatch(/no sessions/i);
  });

  it('lists a single running session with its identifier, harness, and folder visible', () => {
    const output = renderSessionList([
      session({ identifier: '#1 : dev-vm', harness: 'claude-code', folder: '/home/jon/project' }),
    ]);

    expect(output).toContain('#1 : dev-vm');
    expect(output).toContain('claude-code');
    expect(output).toContain('/home/jon/project');
  });

  it('shows a renamed ticket identifier just like the default `#<n> : host` form', () => {
    const output = renderSessionList([session({ identifier: 'KAN-4' })]);

    expect(output).toContain('KAN-4');
  });

  it('lists running sessions above stopped ones regardless of input order', () => {
    const stoppedFirst = [
      session({ id: 'a', identifier: 'stopped-one', status: 'stopped' }),
      session({ id: 'b', identifier: 'running-one', status: 'running' }),
    ];

    const output = renderSessionList(stoppedFirst);

    expect(output.indexOf('running-one')).toBeLessThan(output.indexOf('stopped-one'));
  });

  it('preserves relative order within the running group and within the stopped group', () => {
    const sessions = [
      session({ id: 'a', identifier: 'running-a', status: 'running' }),
      session({ id: 'b', identifier: 'stopped-b', status: 'stopped' }),
      session({ id: 'c', identifier: 'running-c', status: 'running' }),
      session({ id: 'd', identifier: 'stopped-d', status: 'stopped' }),
    ];

    const output = renderSessionList(sessions);

    expect(output.indexOf('running-a')).toBeLessThan(output.indexOf('running-c'));
    expect(output.indexOf('stopped-b')).toBeLessThan(output.indexOf('stopped-d'));
    expect(output.indexOf('running-c')).toBeLessThan(output.indexOf('stopped-b'));
  });

  it('does not mutate the array it was given', () => {
    const sessions = [
      session({ id: 'a', identifier: 'stopped-one', status: 'stopped' }),
      session({ id: 'b', identifier: 'running-one', status: 'running' }),
    ];
    const original = [...sessions];

    renderSessionList(sessions);

    expect(sessions).toEqual(original);
  });

  it('sanitizes backticks in an identifier so it cannot break the reply\'s markdown span', () => {
    const output = renderSessionList([session({ identifier: 'weird`name' })]);

    expect(output).toContain('weirdname');
    expect(output).not.toContain('weird`name');
  });
});
