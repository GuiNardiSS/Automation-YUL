import type { TenderMatch } from '../domain/tender.js';
import { matchesKeywords } from './keywordFilter.js';
import { matchesTargetState } from './stateFilter.js';

export function filterAudiovisualTenders(tenders: TenderMatch[]): TenderMatch[] {
  return tenders.filter((tender) => matchesTargetState(tender) && matchesKeywords(tender));
}
