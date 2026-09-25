// Only the fields this project reads; the live response carries many more.
// Verified against the live /v1/contratacoes/publicacao response (2026-09-25).

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
