import { describe, expect, it } from 'vitest';
import { computeBackoffMs } from './reconnectBackoff.js';

describe('computeBackoffMs', () => {
  it('doubles the delay each attempt with zero jitter (random pinned to 0.5)', () => {
    const random = () => 0.5; // midpoint -> no jitter offset
    expect(computeBackoffMs(1, {}, random)).toBe(1000);
    expect(computeBackoffMs(2, {}, random)).toBe(2000);
    expect(computeBackoffMs(3, {}, random)).toBe(4000);
    expect(computeBackoffMs(4, {}, random)).toBe(8000);
  });

  it('caps the delay at maxMs regardless of how large the attempt number gets', () => {
    const random = () => 0.5;
    expect(computeBackoffMs(20, { maxMs: 60_000 }, random)).toBe(60_000);
  });

  it('applies jitter within +/- jitterRatio of the raw delay, never negative', () => {
    const raw = 1000;
    const jitterRatio = 0.2;

    const withMinRandom = computeBackoffMs(1, { jitterRatio }, () => 0);
    const withMaxRandom = computeBackoffMs(1, { jitterRatio }, () => 1);

    expect(withMinRandom).toBeGreaterThanOrEqual(raw * (1 - jitterRatio));
    expect(withMaxRandom).toBeLessThanOrEqual(raw * (1 + jitterRatio));
    expect(withMinRandom).toBeGreaterThanOrEqual(0);
  });

  it('respects a custom baseMs and factor', () => {
    const random = () => 0.5;
    expect(computeBackoffMs(1, { baseMs: 500, factor: 3 }, random)).toBe(500);
    expect(computeBackoffMs(2, { baseMs: 500, factor: 3 }, random)).toBe(1500);
    expect(computeBackoffMs(3, { baseMs: 500, factor: 3 }, random)).toBe(4500);
  });
});
