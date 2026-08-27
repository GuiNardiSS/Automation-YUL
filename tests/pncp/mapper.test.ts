import { describe, expect, it, vi } from 'vitest';
import { toTenderMatch, toTenderMatchesSafely } from '../../src/pncp/mapper.js';
import type { PncpContratacaoItem } from '../../src/pncp/types.js';

const rawItem: PncpContratacaoItem = {
  numeroControlePNCP: '12250999000106-1-000014/2026',
  objetoCompra: 'Contratação de empresa para produção audiovisual do evento institucional.',
  dataPublicacaoPncp: '2026-08-20T10:00:00Z',
  modalidadeNome: 'Pregão Eletrônico',
  anoCompra: 2026,
  sequencialCompra: 14,
  orgaoEntidade: {
    cnpj: '12250999000106',
    razaoSocial: 'Fundação Cultural de Florianópolis',
  },
  unidadeOrgao: {
    nomeUnidade: 'Diretoria de Eventos',
    municipioNome: 'Florianópolis',
    ufSigla: 'SC',
  },
};

describe('toTenderMatch', () => {
  it('maps every required field from the raw PNCP item', () => {
    const tender = toTenderMatch(rawItem);

    expect(tender.id).toBe(rawItem.numeroControlePNCP);
    expect(tender.title).toBe(rawItem.objetoCompra);
    expect(tender.description).toBe(rawItem.objetoCompra);
    expect(tender.publisherName).toBe('Fundação Cultural de Florianópolis');
    expect(tender.unitName).toBe('Diretoria de Eventos');
    expect(tender.publicationDate).toBe(rawItem.dataPublicacaoPncp);
    expect(tender.municipio).toBe('Florianópolis');
    expect(tender.uf).toBe('SC');
    expect(tender.modality).toBe('Pregão Eletrônico');
  });

  it('builds the direct public PNCP link from cnpj, ano, and sequencial', () => {
    const tender = toTenderMatch(rawItem);
    expect(tender.link).toBe('https://pncp.gov.br/app/editais/12250999000106/2026/14');
  });
});

const malformedItem = { ...rawItem, orgaoEntidade: undefined } as unknown as PncpContratacaoItem;

describe('toTenderMatchesSafely', () => {
  it('maps every well-formed item in the list', () => {
    const secondItem: PncpContratacaoItem = { ...rawItem, numeroControlePNCP: 'second-item' };
    const result = toTenderMatchesSafely([rawItem, secondItem]);
    expect(result.map((tender) => tender.id)).toEqual([rawItem.numeroControlePNCP, 'second-item']);
  });

  it('skips a malformed item instead of letting it abort mapping of the rest of the batch', () => {
    const wellFormedItem: PncpContratacaoItem = { ...rawItem, numeroControlePNCP: 'well-formed' };

    const result = toTenderMatchesSafely([malformedItem, wellFormedItem]);

    expect(result.map((tender) => tender.id)).toEqual(['well-formed']);
  });

  it('reports each skipped item to the provided callback instead of swallowing the failure silently', () => {
    const onSkip = vi.fn();

    toTenderMatchesSafely([malformedItem], onSkip);

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledWith(malformedItem, expect.any(Error));
  });
});
