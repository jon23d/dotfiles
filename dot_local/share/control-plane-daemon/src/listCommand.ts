import { stripBackticks } from './markdown.js';
import type { Session } from './sessionStore.js';

/**
 * Renders the `list` reply: every known session, running ones first (KAN-4
 * AC), each showing its identifier and which harness/folder it's using.
 * Pure function -- takes the already-fetched session array as a parameter,
 * the same way renderCommandList takes the command registry -- so it's
 * fully testable with fixture data without a real SessionStore behind it.
 */
export function renderSessionList(sessions: readonly Session[]): string {
  if (sessions.length === 0) {
    return 'No sessions -- nothing is running or tracked on this VM yet.';
  }

  // Array.prototype.sort is stable (ES2019+), so this only reorders
  // running-vs-stopped and leaves each group's relative order untouched.
  const ordered = [...sessions].sort((a, b) => {
    if (a.status === b.status) return 0;
    return a.status === 'running' ? -1 : 1;
  });

  const lines = ordered.map(
    (session) => `\`${stripBackticks(session.identifier)}\` - ${session.status} - ${session.harness} @ ${session.folder}`,
  );
  return ['Sessions:', ...lines].join('\n');
}
