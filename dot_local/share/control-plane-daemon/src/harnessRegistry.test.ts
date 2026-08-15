import { describe, expect, it } from 'vitest';
import { createHarnessRegistry, KNOWN_HARNESS_NAMES } from './harnessRegistry.js';

describe('createHarnessRegistry', () => {
  it('registers a working `opencode` adapter', () => {
    const registry = createHarnessRegistry();

    expect(registry.opencode).toBeDefined();
    expect(registry.opencode?.name).toBe('opencode');
  });

  it('does not register `claude-code` -- deferred per KAN-5 scope decision, not guessed at', () => {
    const registry = createHarnessRegistry();

    expect(registry['claude-code']).toBeUndefined();
  });
});

describe('KNOWN_HARNESS_NAMES', () => {
  it('lists both harnesses named in the KAN-5 AC, even though only opencode is implemented', () => {
    expect(KNOWN_HARNESS_NAMES).toEqual(['opencode', 'claude-code']);
  });
});
