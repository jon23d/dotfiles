export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  jitterRatio?: number;
}

const DEFAULTS = {
  baseMs: 1000,
  maxMs: 60_000,
  factor: 2,
  jitterRatio: 0.2,
} satisfies Required<BackoffOptions>;

/**
 * Full-jitter exponential backoff. `attempt` is 1-indexed (first retry).
 * `random` is injectable so tests can pin jitter to deterministic values --
 * production callers should pass nothing and get Math.random.
 */
export function computeBackoffMs(
  attempt: number,
  options: BackoffOptions = {},
  random: () => number = Math.random,
): number {
  const { baseMs, maxMs, factor, jitterRatio } = { ...DEFAULTS, ...options };
  const raw = Math.min(baseMs * factor ** (attempt - 1), maxMs);
  const jitterOffset = raw * jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(raw + jitterOffset));
}
