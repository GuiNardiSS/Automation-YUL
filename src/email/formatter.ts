import type { TenderMatch } from '../domain/tender.js';

interface FormattedEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tenderTextBlock(tender: TenderMatch): string {
  return [
    `Title: ${tender.title}`,
    `Publisher: ${tender.publisherName} (${tender.unitName})`,
    `Publication Date: ${tender.publicationDate}`,
    `Location: ${tender.municipio}, ${tender.uf}`,
    `Hiring Method: ${tender.modality}`,
    `Description: ${tender.description}`,
    `Link: ${tender.link}`,
  ].join('\n');
}

function tenderHtmlBlock(tender: TenderMatch): string {
  return [
    `<h2>${escapeHtml(tender.title)}</h2>`,
    `<p><strong>Publisher:</strong> ${escapeHtml(tender.publisherName)} (${escapeHtml(tender.unitName)})</p>`,
    `<p><strong>Publication Date:</strong> ${escapeHtml(tender.publicationDate)}</p>`,
    `<p><strong>Location:</strong> ${escapeHtml(tender.municipio)}, ${escapeHtml(tender.uf)}</p>`,
    `<p><strong>Hiring Method:</strong> ${escapeHtml(tender.modality)}</p>`,
    `<p><strong>Description:</strong> ${escapeHtml(tender.description)}</p>`,
    `<p><a href="${escapeHtml(tender.link)}">${escapeHtml(tender.link)}</a></p>`,
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
    subject: `[PNCP] ${tenders.length} new audiovisual tenders found`,
    text: tenders.map(tenderTextBlock).join('\n\n---\n\n'),
    html: tenders.map(tenderHtmlBlock).join('<hr>'),
  };
}
