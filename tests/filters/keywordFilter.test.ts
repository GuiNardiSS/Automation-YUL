import { describe, expect, it } from 'vitest';
import { matchesKeywords } from '../../src/filters/keywordFilter.js';
import type { TenderMatch } from '../../src/domain/tender.js';

function makeTender(description: string): TenderMatch {
  return {
    id: '1',
    title: 'untitled',
    description,
    publisherName: 'x',
    unitName: 'x',
    publicationDate: '2026-01-01',
    municipio: 'x',
    uf: 'SC',
    modality: 'x',
    link: 'https://example.com',
  };
}

describe('matchesKeywords', () => {
  it('matches a description containing an exact keyword', () => {
    expect(matchesKeywords(makeTender('Contratação de empresa para produção audiovisual do evento.'))).toBe(true);
  });

  it('matches regardless of letter case', () => {
    expect(matchesKeywords(makeTender('SERVIÇOS DE EDIÇÃO DE VÍDEO institucional'))).toBe(true);
  });

  it('matches when the description omits Portuguese accents', () => {
    expect(matchesKeywords(makeTender('Prestacao de servicos de captacao de imagem para documentario.'))).toBe(true);
  });

  it('matches when the keyword itself has no accent but the text does', () => {
    expect(matchesKeywords(makeTender('Serviços de filmagem para cobertura institucional.'))).toBe(true);
  });

  it('does not match a description unrelated to audiovisual work', () => {
    expect(matchesKeywords(makeTender('Aquisição de material de escritório e papelaria diversa.'))).toBe(false);
  });

  it('matches a coincidental substring inside an unrelated word (plain substring matching by design, not word-boundary matching)', () => {
    expect(matchesKeywords(makeTender('Reforma do cinemascópio decorativo da praça central.'))).toBe(true);
  });
});
