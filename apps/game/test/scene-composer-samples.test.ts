import { describe, expect, it } from 'vitest';
import { composerSamples } from '../src/client/scene/composer-samples';

describe('composerSamples', () => {
  it('multisamples on an ordinary screen', () => {
    expect(composerSamples(1)).toBe(4);
    expect(composerSamples(1.5)).toBe(4);
  });

  it('leaves a dense screen without samples', () => {
    expect(composerSamples(2)).toBe(0);
    expect(composerSamples(3)).toBe(0);
  });
});
