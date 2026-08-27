import { describe, expect, it } from 'vitest';
import { formatDigestEmail, formatSingleMatchEmail } from '../../src/email/formatter.js';
import type { TenderMatch } from '../../src/domain/tender.js';

const sample: TenderMatch = {
  id: '12250999000106-1-000014/2026',
  title: 'Contratação de empresa para produção audiovisual do evento institucional',
  description: 'Contratação de empresa para produção audiovisual do evento institucional, incluindo captação e edição de vídeo.',
  publisherName: 'Fundação Cultural de Florianópolis',
  unitName: 'Diretoria de Eventos',
  publicationDate: '2026-08-20',
  municipio: 'Florianópolis',
  uf: 'SC',
  modality: 'Pregão Eletrônico',
  link: 'https://pncp.gov.br/app/editais/12250999000106/2026/14',
};

const sample2: TenderMatch = {
  ...sample,
  id: '99999999000199-1-000002/2026',
  title: 'Contratação de serviços de filmagem para cobertura de audiências públicas',
  description: 'Contratação de serviços de filmagem para cobertura de audiências públicas do legislativo municipal.',
  publisherName: 'Prefeitura de Curitiba',
  uf: 'PR',
  link: 'https://pncp.gov.br/app/editais/99999999000199/2026/2',
};

describe('formatSingleMatchEmail', () => {
  it('includes all required tender fields and the direct link in the plain-text body', () => {
    const email = formatSingleMatchEmail(sample);
    expect(email.text).toContain(sample.title);
    expect(email.text).toContain(sample.publisherName);
    expect(email.text).toContain(sample.publicationDate);
    expect(email.text).toContain(sample.description);
    expect(email.text).toContain(sample.municipio);
    expect(email.text).toContain(sample.uf);
    expect(email.text).toContain(sample.modality);
    expect(email.text).toContain(sample.link);
  });

  it('includes the direct link as a clickable href in the html body', () => {
    const email = formatSingleMatchEmail(sample);
    const escapedLink = sample.link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(email.html).toMatch(new RegExp(`href=['"]${escapedLink}['"]`));
  });

  it('includes the publisher and state in the subject line', () => {
    const email = formatSingleMatchEmail(sample);
    expect(email.subject).toContain(sample.publisherName);
    expect(email.subject).toContain(sample.uf);
  });

  it('escapes a quote character in the link so it cannot break out of the href attribute', () => {
    const tenderWithQuoteInLink: TenderMatch = {
      ...sample,
      link: 'https://pncp.gov.br/app/editais/1"><script>alert(1)</script>',
    };
    const email = formatSingleMatchEmail(tenderWithQuoteInLink);
    // Asserting the raw payload is gone isn't enough on its own (a naive fix
    // could blacklist this exact string) — also assert no <script> tag exists
    // anywhere in the output at all, which a real attribute-escaping fix
    // guarantees and a partial/hacky one would not.
    expect(email.html).not.toContain('"><script>alert(1)</script>');
    expect(email.html).not.toMatch(/<script/i);
  });
});

describe('formatDigestEmail', () => {
  it('includes every tender link and title when digesting multiple matches', () => {
    const email = formatDigestEmail([sample, sample2]);
    expect(email.text).toContain(sample.link);
    expect(email.text).toContain(sample.title);
    expect(email.text).toContain(sample2.link);
    expect(email.text).toContain(sample2.title);
  });

  it('includes the total count of matches in the subject', () => {
    const email = formatDigestEmail([sample, sample2]);
    expect(email.subject).toMatch(/\b2\b/);
  });
});
