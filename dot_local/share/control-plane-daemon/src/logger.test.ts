import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes info logs to stdout as a single JSON line with level, component, message', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = createLogger('socket');

    logger.info('connected', { attempt: 1 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: 'info',
      component: 'socket',
      message: 'connected',
      attempt: 1,
    });
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('writes debug logs to stdout', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = createLogger('socket');

    logger.debug('tick');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({ level: 'debug' });
  });

  it('routes warn logs to stderr, never silently dropping them', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = createLogger('socket');

    logger.warn('reconnecting', { attempt: 3 });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(parsed).toMatchObject({ level: 'warn', message: 'reconnecting', attempt: 3 });
  });

  it('routes error logs to stderr and serializes Error objects with stack + message', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = createLogger('socket');

    logger.error('auth failed', { err: new Error('boom') });

    const parsed = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(parsed.level).toBe('error');
    expect(parsed.err.message).toBe('boom');
    expect(typeof parsed.err.stack).toBe('string');
  });
});
