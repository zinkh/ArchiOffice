import { describe, expect, test } from 'vitest';
import { reporterConvocation } from '../siteReportCarryOver';

describe('reporterConvocation', () => {
  test('reprend les statuts de présence, dont « Non convoqué »', () => {
    const r = reporterConvocation({
      attendance: [
        { name: 'A', role: '00 — VRD', present: false, status: 'NC' },
        { name: 'B', role: '04 — GROS-ŒUVRE', present: true, status: 'P' },
      ],
    });
    expect(r.attendance.map(a => a.status)).toEqual(['NC', 'P']);
  });

  test('reprend lieu, heure, statut et « Convoqué suiv. » sans les retards ni pénalités', () => {
    const r = reporterConvocation({
      heure_convocation: '09:00',
      lot_tracking: [
        { lot_id: 'l4', status: 'P', convoque_reunion_suivante: true, lieu: 'Agence AACZ', heure: '10:30', retard_semaine: 3, effectif: 2, penalites: [{ id: 'p' } as any] },
      ],
    });
    expect(r.heure_convocation).toBe('09:00');
    expect(r.lot_tracking).toEqual([{ lot_id: 'l4', status: 'P', convoque_reunion_suivante: true, lieu: 'Agence AACZ', heure: '10:30' }]);
  });

  test('ignore les lignes de suivi sans information de convocation', () => {
    const r = reporterConvocation({ lot_tracking: [{ lot_id: 'l1', retard_semaine: 2 }] });
    expect(r.lot_tracking).toEqual([]);
  });

  test('sans compte-rendu précédent, ne reporte rien', () => {
    expect(reporterConvocation(null)).toEqual({ attendance: [], lot_tracking: [], heure_convocation: null });
  });
});
