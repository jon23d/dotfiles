import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from './env.js';

// Without this, vi.stubEnv calls in one test (e.g. an intentionally invalid
// MATTERMOST_URL) leak into the next test via process.env and make it
// order-dependent -- tests must be hermetic (see the tdd skill).
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadEnv', () => {
  it('parses a valid environment and fills in defaults', () => {
    vi.stubEnv('MATTERMOST_MCP_TOKEN', 'tok-123');
    vi.stubEnv('MATTERMOST_URL', undefined);
    vi.stubEnv('OPERATOR_EMAIL', undefined);
    vi.stubEnv('STATE_FILE_PATH', undefined);
    vi.stubEnv('LOG_LEVEL', undefined);

    const env = loadEnv();

    expect(env.MATTERMOST_MCP_TOKEN).toBe('tok-123');
    expect(env.MATTERMOST_URL).toBe('https://mattermost.jon23d.cc');
    expect(env.OPERATOR_EMAIL).toBe('jon23d@gmail.com');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('honors overrides for MATTERMOST_URL and OPERATOR_EMAIL', () => {
    vi.stubEnv('MATTERMOST_MCP_TOKEN', 'tok-123');
    vi.stubEnv('MATTERMOST_URL', 'https://mm.example.com');
    vi.stubEnv('OPERATOR_EMAIL', 'someone@example.com');

    const env = loadEnv();

    expect(env.MATTERMOST_URL).toBe('https://mm.example.com');
    expect(env.OPERATOR_EMAIL).toBe('someone@example.com');
  });

  it('throws a clear, non-silent error when MATTERMOST_MCP_TOKEN is missing', () => {
    vi.stubEnv('MATTERMOST_MCP_TOKEN', '');

    expect(() => loadEnv()).toThrow(/MATTERMOST_MCP_TOKEN/);
  });

  it('throws when MATTERMOST_URL is set but not a valid URL', () => {
    vi.stubEnv('MATTERMOST_MCP_TOKEN', 'tok-123');
    vi.stubEnv('MATTERMOST_URL', 'not-a-url');

    expect(() => loadEnv()).toThrow(/MATTERMOST_URL/);
  });

  it('leaves SESSION_NUMBER_FILE_PATH undefined by default, so index.ts falls back to its own default location', () => {
    vi.stubEnv('MATTERMOST_MCP_TOKEN', 'tok-123');
    vi.stubEnv('SESSION_NUMBER_FILE_PATH', undefined);

    const env = loadEnv();

    expect(env.SESSION_NUMBER_FILE_PATH).toBeUndefined();
  });

  it('honors an override for SESSION_NUMBER_FILE_PATH', () => {
    vi.stubEnv('MATTERMOST_MCP_TOKEN', 'tok-123');
    vi.stubEnv('SESSION_NUMBER_FILE_PATH', '/custom/path/session-number.json');

    const env = loadEnv();

    expect(env.SESSION_NUMBER_FILE_PATH).toBe('/custom/path/session-number.json');
  });
});
