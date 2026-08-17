import { describe, expect, it, vi } from 'vitest';
import { createSessionRuntimeRegistry } from './sessionRuntime.js';
import type { HarnessSessionHandle } from './harness.js';

function fakeHandle(overrides: Partial<HarnessSessionHandle> = {}): HarnessSessionHandle {
  return {
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    onExit: vi.fn(),
    onRename: vi.fn(),
    onError: vi.fn(),
    provisionChannelId: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('createSessionRuntimeRegistry', () => {
  it('returns undefined for a channel that was never registered', () => {
    const registry = createSessionRuntimeRegistry();

    expect(registry.get('unknown-channel')).toBeUndefined();
  });

  it('returns the handle that was registered for a given channel id', () => {
    const registry = createSessionRuntimeRegistry();
    const handle = fakeHandle();

    registry.register('chan-1', handle);

    expect(registry.get('chan-1')).toBe(handle);
  });

  it('remove() makes a subsequent get() return undefined again', () => {
    const registry = createSessionRuntimeRegistry();
    registry.register('chan-1', fakeHandle());

    registry.remove('chan-1');

    expect(registry.get('chan-1')).toBeUndefined();
  });

  it('keeps handles for different channels independent', () => {
    const registry = createSessionRuntimeRegistry();
    const a = fakeHandle();
    const b = fakeHandle();

    registry.register('chan-a', a);
    registry.register('chan-b', b);

    expect(registry.get('chan-a')).toBe(a);
    expect(registry.get('chan-b')).toBe(b);
  });
});
