import { describe, expect, it } from 'vitest';
import { filterAudiovisualTenders } from '../../src/filters/index.js';
import type { TenderMatch } from '../../src/domain/tender.js';

function makeTender(overrides: Partial<TenderMatch>): TenderMatch {
  return {
    id: '1',
    title: 'untitled',
    description: 'Aquisição de material de escritório.',
    publisherName: 'x',
    unitName: 'x',
    publicationDate: '2026-01-01',
    municipio: 'x',
    uf: 'SP',
    modality: 'x',
    link: 'https://example.com',
    ...overrides,
  };
}

describe('filterAudiovisualTenders', () => {
  it('keeps a tender that matches both the target state and an audiovisual keyword', () => {
    const tender = makeTender({ id: 'a', uf: 'SC', description: 'Produção audiovisual para evento.' });
    expect(filterAudiovisualTenders([tender])).toEqual([tender]);
  });

  it('drops a tender in the target state whose description is unrelated', () => {
    const tender = makeTender({ id: 'b', uf: 'PR', description: 'Aquisição de material de escritório.' });
    expect(filterAudiovisualTenders([tender])).toEqual([]);
  });

  it('drops an audiovisual tender outside the target states', () => {
    const tender = makeTender({ id: 'c', uf: 'SP', description: 'Produção audiovisual para evento.' });
    expect(filterAudiovisualTenders([tender])).toEqual([]);
  });

  it('returns only the matching subset from a mixed list', () => {
    const match = makeTender({ id: 'd', uf: 'RS', description: 'Serviços de edição de vídeo institucional.' });
    const nonMatch = makeTender({ id: 'e', uf: 'SP', description: 'Compra de veículos administrativos.' });
    expect(filterAudiovisualTenders([nonMatch, match])).toEqual([match]);
  });

  it('returns an empty array when given no tenders', () => {
    expect(filterAudiovisualTenders([])).toEqual([]);
  });
});
