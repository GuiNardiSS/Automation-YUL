import { describe, expect, it } from 'vitest';
import { matchesTargetState } from '../../src/filters/stateFilter.js';
import type { TenderMatch } from '../../src/domain/tender.js';

function makeTender(uf: string): TenderMatch {
  return {
    id: '1',
    title: 'x',
    description: 'x',
    publisherName: 'x',
    unitName: 'x',
    publicationDate: '2026-01-01',
    municipio: 'x',
    uf,
    modality: 'x',
    link: 'https://example.com',
  };
}

describe('matchesTargetState', () => {
  it.each(['SC', 'PR', 'RS'])('accepts %s', (uf) => {
    expect(matchesTargetState(makeTender(uf))).toBe(true);
  });

  it.each(['SP', 'RJ', 'MG', ''])('rejects %s', (uf) => {
    expect(matchesTargetState(makeTender(uf))).toBe(false);
  });

  it('accepts a state code regardless of letter case', () => {
    expect(matchesTargetState(makeTender('sc'))).toBe(true);
  });
});
