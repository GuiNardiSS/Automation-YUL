import type { TenderMatch } from '../domain/tender.js';

interface FormattedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// PNCP sends "2026-09-25T08:28:28" (or a bare date); shown as "25/09/2026".
// Parsed as text, not via Date, so no timezone shift can move the day.
function formatBrazilianDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function tenderTextBlock(tender: TenderMatch): string {
  return [
    `Título: ${tender.title}`,
    `Órgão: ${tender.publisherName} (${tender.unitName})`,
    `Data de publicação: ${formatBrazilianDate(tender.publicationDate)}`,
    `Local: ${tender.municipio}, ${tender.uf}`,
    `Modalidade: ${tender.modality}`,
    `Objeto: ${tender.description}`,
    `Link do edital: ${tender.link}`,
  ].join('\n');
}

function tenderHtmlBlock(tender: TenderMatch): string {
  return [
    `<h2>${escapeHtml(tender.title)}</h2>`,
    `<p><strong>Órgão:</strong> ${escapeHtml(tender.publisherName)} (${escapeHtml(tender.unitName)})</p>`,
    `<p><strong>Data de publicação:</strong> ${escapeHtml(formatBrazilianDate(tender.publicationDate))}</p>`,
    `<p><strong>Local:</strong> ${escapeHtml(tender.municipio)}, ${escapeHtml(tender.uf)}</p>`,
    `<p><strong>Modalidade:</strong> ${escapeHtml(tender.modality)}</p>`,
    `<p><strong>Objeto:</strong> ${escapeHtml(tender.description)}</p>`,
    `<p><strong>Link do edital:</strong> <a href="${escapeHtml(tender.link)}">${escapeHtml(tender.link)}</a></p>`,
  ].join('\n');
}

export function formatSingleMatchEmail(tender: TenderMatch): FormattedEmail {
  return {
    subject: `[PNCP] ${tender.modality} — ${tender.publisherName} (${tender.uf})`,
    text: tenderTextBlock(tender),
    html: tenderHtmlBlock(tender),
  };
}

export function formatDigestEmail(tenders: TenderMatch[]): FormattedEmail {
  return {
    subject: `[PNCP] ${tenders.length} novas licitações de audiovisual encontradas`,
    text: tenders.map(tenderTextBlock).join('\n\n---\n\n'),
    html: tenders.map(tenderHtmlBlock).join('<hr>'),
  };
}
