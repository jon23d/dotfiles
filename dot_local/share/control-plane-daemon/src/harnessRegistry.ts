import { createOpencodeHarness } from './opencodeHarness.js';
import type { OpencodeHarnessConfig } from './opencodeHarness.js';
import type { HarnessAdapter } from './harness.js';

/**
 * Every harness name the `start` UX offers the operator (KAN-5 AC1: "which
 * harness (Claude Code, opencode)"), independent of which ones actually have
 * a working adapter registered below. Keeping this list separate from
 * `createHarnessRegistry`'s keys lets startCommand.ts give a specific,
 * honest "not implemented yet" error for a recognized-but-deferred harness
 * (`claude-code`) instead of lumping it in with a genuine typo.
 */
export const KNOWN_HARNESS_NAMES = ['opencode', 'claude-code'] as const;
export type KnownHarnessName = (typeof KNOWN_HARNESS_NAMES)[number];

export interface HarnessRegistryConfig {
  opencode?: OpencodeHarnessConfig;
}

/**
 * Assembles the harness-name -> adapter registry `start` dispatches through
 * -- mirrors commands.ts's registry pattern so adding Claude Code later is
 * one more entry here (plus its own adapter module), not a redesign of
 * startCommand.ts. Only `opencode` is registered this round; Claude Code's
 * headless/session-resume story is unverified and explicitly deferred (KAN-5
 * scope decision) rather than stubbed in.
 */
export function createHarnessRegistry(config: HarnessRegistryConfig = {}): Partial<Record<KnownHarnessName, HarnessAdapter>> {
  return {
    opencode: createOpencodeHarness(config.opencode),
  };
}
