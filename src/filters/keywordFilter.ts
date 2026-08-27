import type { TenderMatch } from '../domain/tender.js';
import { AUDIOVISUAL_KEYWORDS } from './keywords.js';

const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalize(text: string): string {
  return text.normalize('NFD').replace(COMBINING_DIACRITICS, '').toLowerCase();
}

export function matchesKeywords(tender: TenderMatch): boolean {
  const normalizedDescription = normalize(tender.description);
  return AUDIOVISUAL_KEYWORDS.some((keyword) => normalizedDescription.includes(keyword));
}
