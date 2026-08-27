// Hypothesis based on secondary sources — Task 0 (scripts/verify-api.ts) must confirm
// these field names/shapes against the live API before this is treated as ground truth.

export interface PncpOrgaoEntidade {
  cnpj: string;
  razaoSocial: string;
}

export interface PncpUnidadeOrgao {
  nomeUnidade: string;
  municipioNome: string;
  ufSigla: string;
}

export interface PncpContratacaoItem {
  numeroControlePNCP: string;
  objetoCompra: string;
  dataPublicacaoPncp: string;
  modalidadeNome: string;
  anoCompra: number;
  sequencialCompra: number;
  orgaoEntidade: PncpOrgaoEntidade;
  unidadeOrgao: PncpUnidadeOrgao;
}

export interface PncpPublicacaoResponse {
  data: PncpContratacaoItem[];
  totalRegistros: number;
  totalPaginas: number;
  numeroPagina: number;
  paginasRestantes: number;
  empty: boolean;
}
