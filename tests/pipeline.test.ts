import { describe, expect, it } from 'vitest';
import { shouldDigest } from '../src/pipeline.js';

describe('shouldDigest', () => {
  it('is false when the match count is at or below the threshold', () => {
    expect(shouldDigest(10, 10)).toBe(false);
    expect(shouldDigest(5, 10)).toBe(false);
  });

  it('is true when the match count exceeds the threshold', () => {
    expect(shouldDigest(11, 10)).toBe(true);
  });
});
