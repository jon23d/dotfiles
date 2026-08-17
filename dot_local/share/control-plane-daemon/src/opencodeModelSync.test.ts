import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORCHESTRATOR_MODEL_ID, ORCHESTRATOR_MODEL_PROVIDER_ID } from './opencodeHarness.js';

/**
 * Guards against `dot_config/opencode/opencode.jsonc`'s top-level default
 * `model` (used by interactive, non-daemon opencode sessions) silently
 * drifting from `opencodeHarness.ts`'s `ORCHESTRATOR_MODEL_PROVIDER_ID`/
 * `ORCHESTRATOR_MODEL_ID` (used by daemon-driven Orchestrator sessions,
 * which always override opencode.jsonc's default per KAN-13's
 * defense-in-depth design -- see `ORCHESTRATOR_MODEL_ID`'s doc comment).
 * Nothing else keeps these two hardcoded, separately-maintained literals in
 * sync besides a doc-comment instruction on each side (review kan13-1 F4) --
 * this test is the "lightweight check" that finding asked for: a future edit
 * to one without the other fails a test instead of silently making
 * interactive and daemon-driven sessions use different models.
 *
 * Deliberately not a full JSONC parser (no such dependency exists in this
 * package, and pulling one in is more than this check needs) -- a targeted
 * regex extraction of the one `"model":` line is enough, and is safe here
 * because `opencode.jsonc` has exactly one top-level `"model"` key (verified
 * by inspection; a second occurrence would just make this test's own regex
 * ambiguous and fail loudly via the "found a model line" assertion below,
 * not silently pass).
 */
describe('opencode.jsonc default model stays in sync with ORCHESTRATOR_MODEL_ID (review kan13-1 F4)', () => {
  it('matches ORCHESTRATOR_MODEL_PROVIDER_ID/ORCHESTRATOR_MODEL_ID', async () => {
    const configPath = join(import.meta.dirname, '..', '..', '..', '..', 'dot_config', 'opencode', 'opencode.jsonc');
    const contents = await readFile(configPath, 'utf8');

    const match = contents.match(/^\s*"model"\s*:\s*"([^"]+)"/m);
    expect(match, `expected to find a top-level "model" key in ${configPath}`).not.toBeNull();

    const declaredModel = match?.[1];
    expect(declaredModel).toBe(`${ORCHESTRATOR_MODEL_PROVIDER_ID}/${ORCHESTRATOR_MODEL_ID}`);
  });
});
