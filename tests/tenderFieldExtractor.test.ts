// server/tenderFieldExtractor.ts — pure heuristic parsing of an RSS tender
// announcement's description text. type_marche is the newest field: it has
// no stable label across sources (unlike ville_execution or montant_travaux),
// so it's detected by keyword rather than by a "Label :" pattern — these
// tests pin the precedence ('Concours' wins over 'MAPA' when both appear)
// and the "leave it blank rather than guess" behavior for anything else.
import { describe, expect, it } from 'vitest';
import { extractTenderFields } from '../server/tenderFieldExtractor';

describe('extractTenderFields — type_marche', () => {
  it('detects a concours', () => {
    const result = extractTenderFields('Avis de concours de maîtrise d\'œuvre pour la réhabilitation du groupe scolaire.');
    expect(result.type_marche).toBe('Concours');
  });

  it('detects a MAPA from "procédure adaptée"', () => {
    const result = extractTenderFields('Marché passé selon une procédure adaptée (article L2123-1).');
    expect(result.type_marche).toBe('MAPA');
  });

  it('detects a MAPA from the bare acronym', () => {
    const result = extractTenderFields('MAPA — Réhabilitation de la mairie.');
    expect(result.type_marche).toBe('MAPA');
  });

  it('prefers Concours when both appear', () => {
    const result = extractTenderFields('Concours restreint mené selon une procédure adaptée.');
    expect(result.type_marche).toBe('Concours');
  });

  it('leaves type_marche undefined rather than guessing', () => {
    const result = extractTenderFields('Appel d\'offres ouvert pour des travaux de charpente.');
    expect(result.type_marche).toBeUndefined();
  });

  it('returns an empty object for an empty description', () => {
    expect(extractTenderFields(null)).toEqual({});
    expect(extractTenderFields('')).toEqual({});
  });
});
