// Archivage des affaires : src/lib/projectArchive.ts.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETENTION_YEARS, buildArchiveChecklist, checklistWarnings, normalizeRetentionYears, retentionUntil,
} from '../projectArchive';
import { libelleStatutFacture, totauxFactures } from '../closureDossierPdf';

describe('normalizeRetentionYears', () => {
  it('rend 10 ans quand la valeur est absente ou illisible', () => {
    expect(normalizeRetentionYears(undefined)).toBe(DEFAULT_RETENTION_YEARS);
    expect(normalizeRetentionYears(null)).toBe(10);
    expect(normalizeRetentionYears('')).toBe(10);
    expect(normalizeRetentionYears('abc')).toBe(10);
  });

  it('borne la durée entre 1 et 50 ans', () => {
    expect(normalizeRetentionYears(0)).toBe(1);
    expect(normalizeRetentionYears(200)).toBe(50);
    expect(normalizeRetentionYears('15')).toBe(15);
  });
});

describe('retentionUntil', () => {
  it('ajoute la durée à la date d’archivage', () => {
    expect(retentionUntil('2026-10-24T10:00:00.000Z', 10)).toBe('2036-10-24');
  });

  it('ramène le 29 février au 28 février d’une année non bissextile', () => {
    expect(retentionUntil('2024-02-29T08:00:00.000Z', 1)).toBe('2025-02-28');
    expect(retentionUntil('2024-02-29T08:00:00.000Z', 4)).toBe('2028-02-29');
  });
});

describe('totauxFactures', () => {
  it('compte comme reste à encaisser tout ce qui n’est pas payé', () => {
    const totaux = totauxFactures([
      { numero: 'F1', totalTtc: 1200, statut: 'Paid' },
      { numero: 'F2', totalTtc: 300.5, statut: 'Sent' },
      { numero: 'F3', totalTtc: 99.5, statut: 'Overdue' },
    ]);
    expect(totaux).toEqual({ total: 1600, paye: 1200, reste: 400 });
  });

  it('ignore un montant illisible au lieu de propager NaN', () => {
    expect(totauxFactures([{ numero: 'F1', totalTtc: Number.NaN, statut: 'Paid' }]).total).toBe(0);
    expect(totauxFactures([])).toEqual({ total: 0, paye: 0, reste: 0 });
  });
});

describe('libelleStatutFacture', () => {
  it('traduit les statuts connus et garde les autres tels quels', () => {
    expect(libelleStatutFacture('Paid')).toBe('Payée');
    expect(libelleStatutFacture('Autre')).toBe('Autre');
  });
});

describe('buildArchiveChecklist', () => {
  const clean = {
    projectStatus: 'Completed',
    invoices: [{ status: 'Paid' }],
    reserves: [{ status: 'Levée' }, { status: 'Quitus Transmis' }],
    tasks: [{ status: 'done' }],
    doeVisaCount: 1,
  };

  it('ne signale rien sur une affaire soldée, levée et visée', () => {
    const items = buildArchiveChecklist(clean);
    expect(items.every(i => i.state === 'ok')).toBe(true);
    expect(checklistWarnings(items)).toHaveLength(0);
  });

  it('signale factures, réserves, tâches, statut et DOE', () => {
    const items = buildArchiveChecklist({
      projectStatus: 'In Progress',
      invoices: [{ status: 'Sent' }, { status: 'Paid' }],
      reserves: [{ status: 'A faire' }],
      tasks: [{ status: 'todo' }, { status: 'review' }],
      doeVisaCount: 0,
    });
    expect(checklistWarnings(items).map(i => i.id)).toEqual(['status', 'invoices', 'reserves', 'tasks', 'doe']);
    expect(items.find(i => i.id === 'tasks')?.detail).toContain('2');
  });

  it('ne présente jamais un DOE illisible comme non visé', () => {
    const items = buildArchiveChecklist({ ...clean, doeVisaCount: null });
    expect(items.find(i => i.id === 'doe')?.state).toBe('unknown');
    expect(checklistWarnings(items)).toHaveLength(0);
  });
});
