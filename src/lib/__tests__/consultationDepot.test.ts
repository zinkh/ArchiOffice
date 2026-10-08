import { describe, expect, it } from 'vitest';
import {
  construireAccuse, controlerFichierMeta, controlerLot, estHorsDelai, expirationLien,
  extensionDe, formatAutorise, formatOctets, plisScelles, validerSaisie,
  DEPOT_ACCEPT, MAX_DEPOT_OCTETS, MAX_FICHIER_OCTETS,
} from '../consultationDepot';

const MIO = 1024 * 1024;

describe('formats', () => {
  it('accepte PDF, Word, Excel, ODS et ODT, refuse le reste', () => {
    for (const nom of ['a.pdf', 'a.DOCX', 'a.xlsx', 'a.ods', 'a.odt']) expect(formatAutorise(nom)).toBe(true);
    for (const nom of ['a.dwg', 'a.dxf', 'a.doc', 'a.xls', 'a.docm', 'a.xlsm', 'a.zip', 'a.exe', 'a', 'a.']) expect(formatAutorise(nom)).toBe(false);
  });

  it('expose la liste pour un champ de fichier', () => {
    expect(DEPOT_ACCEPT).toBe('.pdf,.docx,.xlsx,.ods,.odt');
  });

  it("lit l'extension du dernier point", () => {
    expect(extensionDe('devis.v2.final.PDF')).toBe('pdf');
    expect(extensionDe('sans-extension')).toBe('');
  });

  it('formate les tailles', () => {
    expect(formatOctets(500)).toBe('500 o');
    expect(formatOctets(2048)).toBe('2 Ko');
    expect(formatOctets(25 * MIO)).toBe('25,0 Mo');
  });
});

describe('plafonds', () => {
  it('fixe 25 Mo par fichier et 100 Mo par dépôt', () => {
    expect(MAX_FICHIER_OCTETS).toBe(25 * MIO);
    expect(MAX_DEPOT_OCTETS).toBe(100 * MIO);
  });

  it('contrôle un fichier : taille et format', () => {
    expect(controlerFichierMeta('a.pdf', 25 * MIO).ok).toBe(true);
    expect(controlerFichierMeta('a.pdf', 25 * MIO + 1).ok).toBe(false);
    expect(controlerFichierMeta('a.pdf', 0).ok).toBe(false);
    expect(controlerFichierMeta('plan.dwg', 10).ok).toBe(false);
  });

  it('contrôle un lot de fichiers : nombre et poids total', () => {
    expect(controlerLot([]).ok).toBe(false);
    expect(controlerLot(Array.from({ length: 11 }, (_, i) => ({ name: `${i}.pdf`, size: 1 }))).ok).toBe(false);
    // 5 x 25 Mo = 125 Mo > 100 Mo
    expect(controlerLot(Array.from({ length: 5 }, (_, i) => ({ name: `${i}.pdf`, size: 25 * MIO }))).ok).toBe(false);
    expect(controlerLot(Array.from({ length: 4 }, (_, i) => ({ name: `${i}.pdf`, size: 25 * MIO }))).ok).toBe(true);
  });
});

describe('dates', () => {
  const limite = '2026-10-10T12:00:00.000Z';

  it('signale hors délai après la date limite seulement', () => {
    expect(estHorsDelai('2026-10-10T11:59:59.000Z', limite)).toBe(false);
    expect(estHorsDelai('2026-10-10T12:00:01.000Z', limite)).toBe(true);
    expect(estHorsDelai(new Date(), null)).toBe(false);
    expect(estHorsDelai(new Date(), 'pas une date')).toBe(false);
  });

  it('scelle tant que la date limite est dans le futur', () => {
    const r = { sealed: true, deadline_at: limite };
    expect(plisScelles(r, new Date('2026-10-09T00:00:00Z'))).toBe(true);
    expect(plisScelles(r, new Date('2026-10-10T12:00:00Z'))).toBe(false);
    expect(plisScelles({ sealed: false, deadline_at: limite }, new Date('2026-10-09T00:00:00Z'))).toBe(false);
  });

  it('un scellement sans date limite ne scelle rien', () => {
    expect(plisScelles({ sealed: true, deadline_at: null })).toBe(false);
    expect(plisScelles(null)).toBe(false);
  });

  it("laisse 14 jours après la date limite, 90 jours sans date limite", () => {
    const now = new Date('2026-10-01T00:00:00Z');
    expect(expirationLien(limite, now).toISOString()).toBe('2026-10-24T12:00:00.000Z');
    expect(expirationLien(null, now).toISOString()).toBe('2026-12-30T00:00:00.000Z');
  });

  it("ne raccourcit pas un lien neuf dont la date limite est déjà passée", () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(expirationLien(limite, now).toISOString()).toBe('2026-11-15T00:00:00.000Z');
  });
});

describe('validerSaisie', () => {
  it('normalise une saisie valide', () => {
    const r = validerSaisie({
      montant_base: '12 345,505', delai_semaines: '8', observations: '  RAS  ',
      lignes: [{ kind: 'option', libelle: ' Isolation ', montant: '1 200' }],
    });
    expect(r).toEqual({ ok: true, saisie: {
      montant_base: 12345.51, delai_semaines: 8, observations: 'RAS',
      lignes: [{ kind: 'option', libelle: 'Isolation', montant: 1200 }],
    } });
  });

  it.each([
    [null], [{}], [{ montant_base: 0 }], [{ montant_base: -1 }], [{ montant_base: 'abc' }],
    [{ montant_base: 2e9 }], [{ montant_base: 10, delai_semaines: -1 }], [{ montant_base: 10, delai_semaines: 9999 }],
    [{ montant_base: 10, lignes: [{ kind: 'autre', libelle: 'x', montant: 1 }] }],
    [{ montant_base: 10, lignes: [{ kind: 'option', libelle: '', montant: 1 }] }],
    [{ montant_base: 10, lignes: [{ kind: 'option', libelle: 'x', montant: -1 }] }],
    [{ montant_base: 10, lignes: Array.from({ length: 31 }, () => ({ kind: 'option', libelle: 'x', montant: 1 })) }],
  ])('refuse %j', (brut) => {
    expect(validerSaisie(brut).ok).toBe(false);
  });

  it('tronque les textes trop longs', () => {
    const r = validerSaisie({ montant_base: 1, observations: 'x'.repeat(5000), lignes: [{ kind: 'variante', libelle: 'y'.repeat(500), montant: 1 }] });
    expect(r.ok && r.saisie.observations!.length).toBe(2000);
    expect(r.ok && r.saisie.lignes[0].libelle.length).toBe(200);
  });
});

describe('construireAccuse', () => {
  const base = {
    cabinet: 'Atelier <Test>', operation: 'Villa "Martin"', entreprise: 'SARL Dupont',
    recuLe: new Date('2026-10-08T10:00:00Z'), horsDelai: false,
    elements: [{ nom: 'devis.pdf', kind: 'fichier' as const, tailleOctets: 2048, sha256: 'abc123', lotLibelle: 'Lot 02 Charpente' }],
  };

  it("cite le fichier, son empreinte et l'opération", () => {
    const { subject, html } = construireAccuse(base);
    expect(subject).toBe('Accusé de réception : Villa "Martin"');
    expect(html).toContain('devis.pdf');
    expect(html).toContain('abc123');
    expect(html).toContain('Lot 02 Charpente');
    expect(html).not.toContain('hors délai');
  });

  it('échappe le HTML des données saisies', () => {
    const { html } = construireAccuse({ ...base, elements: [{ nom: '<img src=x onerror=alert(1)>.pdf', kind: 'fichier' }] });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('Atelier &lt;Test&gt;');
  });

  it('signale une remise hors délai', () => {
    const { html } = construireAccuse({ ...base, horsDelai: true, deadlineAt: '2026-10-07T10:00:00.000Z' });
    expect(html).toContain('hors délai');
    expect(html).toContain('après la date limite');
  });
});
