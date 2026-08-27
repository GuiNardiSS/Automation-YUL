import type { TenderMatch } from '../domain/tender.js';

const TARGET_STATES = new Set(['SC', 'PR', 'RS']);

export function matchesTargetState(tender: TenderMatch): boolean {
  return TARGET_STATES.has(tender.uf.toUpperCase());
}
