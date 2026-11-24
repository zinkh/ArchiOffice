import { describe, expect, it } from 'vitest';
import {
  MAX_OBJET_CARACTERES, MAX_QUESTION_CARACTERES, questionsAReprendre, questionsOuvertes, validerQuestion, type QuestionRecue,
} from '../depotQuestions';

describe('validerQuestion', () => {
  it('nettoie la question et l\'objet', () => {
    expect(validerQuestion({ objet: '  Cotes   du  plan ', question: '  Quelle est la cote ?\r\nMerci  ' }))
      .toEqual({ ok: true, objet: 'Cotes du plan', question: 'Quelle est la cote ?\nMerci' });
  });

  it('accepte une question sans objet', () => {
    expect(validerQuestion({ question: 'Quelle épaisseur d\'isolant ?' })).toEqual({ ok: true, objet: null, question: 'Quelle épaisseur d\'isolant ?' });
  });

  it('refuse une question vide, trop courte ou trop longue', () => {
    expect(validerQuestion({ question: '   ' }).ok).toBe(false);
    expect(validerQuestion({ question: 'ab' }).ok).toBe(false);
    expect(validerQuestion({ question: 'x'.repeat(MAX_QUESTION_CARACTERES + 1) }).ok).toBe(false);
    expect(validerQuestion({ question: 'x'.repeat(MAX_QUESTION_CARACTERES) }).ok).toBe(true);
  });

  it('refuse un objet trop long et un corps qui n\'est pas un objet', () => {
    expect(validerQuestion({ objet: 'o'.repeat(MAX_OBJET_CARACTERES + 1), question: 'Une vraie question' }).ok).toBe(false);
    expect(validerQuestion(null).ok).toBe(false);
    expect(validerQuestion('texte').ok).toBe(false);
    expect(validerQuestion({ question: 42 }).ok).toBe(false);
  });

  it('garde le HTML tel quel, comme du texte (jamais interprété)', () => {
    expect(validerQuestion({ question: '<script>alert(1)</script> bonjour' })).toMatchObject({ ok: true, question: '<script>alert(1)</script> bonjour' });
  });
});

describe('questionsOuvertes', () => {
  const limite = '2030-06-10T12:00:00.000Z';
  it('reste ouverte jusqu\'à la date limite comprise', () => {
    expect(questionsOuvertes(limite, new Date('2030-06-10T11:59:59Z'))).toBe(true);
    expect(questionsOuvertes(limite, new Date(limite))).toBe(true);
    expect(questionsOuvertes(limite, new Date('2030-06-10T12:00:01Z'))).toBe(false);
  });

  it('reste ouverte sans date limite ou avec une date illisible', () => {
    expect(questionsOuvertes(undefined)).toBe(true);
    expect(questionsOuvertes('')).toBe(true);
    expect(questionsOuvertes('pas une date')).toBe(true);
  });
});

describe('questionsAReprendre', () => {
  const recue = (id: string, p: Partial<QuestionRecue> = {}): QuestionRecue => ({
    id, entreprise_id: 'e1', entreprise_nom: 'SARL Dupont', lot_id: null, objet: null, question: `Question ${id} ?`,
    created_at: '2026-11-23T08:15:00.000Z', ...p,
  });

  it('ne reprend que les questions absentes de la consultation, sans doublon au rejeu', () => {
    const nouvelles = questionsAReprendre([{ id: 'a' }], [recue('a'), recue('b')]);
    expect(nouvelles.map(q => q.id)).toEqual(['b']);
    expect(questionsAReprendre([{ id: 'a' }, { id: 'b' }], [recue('a'), recue('b')])).toEqual([]);
  });

  it('reprend non publique, avec l\'origine, la date, l\'objet et le lot', () => {
    const [q] = questionsAReprendre([], [recue('a', { objet: 'Cotes', lot_id: 'lot-1' })]);
    expect(q).toEqual({
      id: 'a', entreprise_id: 'e1', entreprise_nom: 'SARL Dupont', question: 'Question a ?', date_question: '2026-11-23',
      publique: false, source: 'depot', objet: 'Cotes', lot_id: 'lot-1',
    });
  });

  it('n\'ajoute ni objet ni lot quand ils sont absents', () => {
    const [q] = questionsAReprendre([], [recue('a')]);
    expect(q).not.toHaveProperty('objet');
    expect(q).not.toHaveProperty('lot_id');
  });
});
