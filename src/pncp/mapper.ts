import type { TenderMatch } from '../domain/tender.js';
import type { PncpContratacaoItem } from './types.js';

export function toTenderMatch(item: PncpContratacaoItem): TenderMatch {
  return {
    id: item.numeroControlePNCP,
    title: item.objetoCompra,
    description: item.objetoCompra,
    publisherName: item.orgaoEntidade.razaoSocial,
    unitName: item.unidadeOrgao.nomeUnidade,
    publicationDate: item.dataPublicacaoPncp,
    municipio: item.unidadeOrgao.municipioNome,
    uf: item.unidadeOrgao.ufSigla,
    modality: item.modalidadeNome,
    link: `https://pncp.gov.br/app/editais/${item.orgaoEntidade.cnpj}/${item.anoCompra}/${item.sequencialCompra}`,
  };
}

export function toTenderMatchesSafely(
  items: PncpContratacaoItem[],
  onSkip?: (item: PncpContratacaoItem, error: Error) => void,
): TenderMatch[] {
  const matches: TenderMatch[] = [];

  for (const item of items) {
    try {
      matches.push(toTenderMatch(item));
    } catch (error) {
      onSkip?.(item, error instanceof Error ? error : new Error(String(error)));
    }
  }

  return matches;
}
