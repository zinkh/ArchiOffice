import { describe, expect, it } from 'vitest';
import {
  analyserDocument, archivePrete, avisSuggere, cheminsArchive, classerPiece, construireRelance,
  construireSollicitation, couvertureDossier, expirationLienDoe, nomSur, numeroVisa, piecesRequises,
  prochaineRelance, relanceDue, statutEntreprise, syntheseOperation,
  type DoeDocument, type DoePieceKey,
} from '../doeAtelier';

const REQ: DoePieceKey[] = ['plans_execution', 'notices'];
const doc = (id: string, piece: string | null, avis = 'pending', uploaded = '2026-10-01T10:00:00Z'): DoeDocument =>
  ({ id, name: `${id}.pdf`, doe_piece: piece, validation_status: avis, uploaded_at: uploaded });

describe('pièces requises', () => {
  it('reprend les pièces par défaut sans choix valable', () => {
    expect(piecesRequises(undefined)).toContain('plans_execution');
    expect(piecesRequises(['n_importe_quoi'])).toEqual(piecesRequises());
  });
  it('garde les pièces choisies, sans doublon', () => {
    expect(piecesRequises(['notices', 'notices', 'garanties'])).toEqual(['notices', 'garanties']);
  });
});

describe('couverture et statut', () => {
  it('une pièce couverte seulement par un document refusé reste manquante', () => {
    const c = couvertureDossier([doc('a', 'plans_execution', 'rejected'), doc('b', 'notices', 'approved')], REQ);
    expect(c.manquantes).toEqual(['plans_execution']);
    expect(c.validees).toEqual(['notices']);
  });

  it('suit le cycle : à solliciter, sollicitée, incomplet, à analyser, à corriger, conforme, visé', () => {
    const base = { requises: REQ };
    expect(statutEntreprise({ ...base, sollicitee: false, documents: [] })).toBe('a_solliciter');
    expect(statutEntreprise({ ...base, sollicitee: true, documents: [] })).toBe('sollicitee');
    expect(statutEntreprise({ ...base, sollicitee: true, documents: [doc('a', 'notices')] })).toBe('partiel');
    expect(statutEntreprise({ ...base, sollicitee: true, documents: [doc('a', 'notices'), doc('b', 'plans_execution')] })).toBe('a_analyser');
    expect(statutEntreprise({ ...base, sollicitee: true, documents: [doc('a', 'notices', 'approved'), doc('b', 'plans_execution', 'commented')] })).toBe('a_corriger');
    const ok = [doc('a', 'notices', 'approved'), doc('b', 'plans_execution', 'approved')];
    expect(statutEntreprise({ ...base, sollicitee: true, documents: ok })).toBe('conforme');
    expect(statutEntreprise({ ...base, sollicitee: true, documents: ok, visa: { avis: 'favorable', issued_at: '2026-10-05T00:00:00Z' } })).toBe('vise');
  });

  it("un document déposé après le visa rouvre l'analyse", () => {
    const docs = [doc('a', 'notices', 'approved'), doc('b', 'plans_execution', 'approved'), doc('c', 'plans_execution', 'pending', '2026-10-09T00:00:00Z')];
    const s = statutEntreprise({ requises: REQ, sollicitee: true, documents: docs, visa: { avis: 'favorable', issued_at: '2026-10-05T00:00:00Z' } });
    expect(s).toBe('a_analyser');
  });

  it('un visa défavorable laisse le dossier « à corriger », jamais « visé »', () => {
    const ok = [doc('a', 'notices', 'approved'), doc('b', 'plans_execution', 'approved')];
    const s = statutEntreprise({ requises: REQ, sollicitee: true, documents: ok, visa: { avis: 'defavorable', issued_at: '2026-10-05T00:00:00Z' } });
    expect(s).toBe('a_corriger');
    expect(archivePrete([s, 'vise'])).toBe(false);
  });

  it("un dossier reçu hors sollicitation n'est pas « à solliciter »", () => {
    expect(statutEntreprise({ requises: REQ, sollicitee: false, documents: [doc('a', 'notices')] })).toBe('partiel');
  });
});

describe('avis suggéré', () => {
  it('défavorable quand une pièce manque', () => {
    expect(avisSuggere([doc('a', 'notices', 'approved')], REQ)).toBe('defavorable');
  });
  it('avec observations quand un document est commenté ou remplacé', () => {
    expect(avisSuggere([doc('a', 'notices', 'approved'), doc('b', 'plans_execution', 'commented')], REQ)).toBe('avec_observations');
    expect(avisSuggere([doc('a', 'notices', 'approved'), doc('b', 'plans_execution', 'approved'), doc('c', 'plans_execution', 'rejected')], REQ)).toBe('avec_observations');
  });
  it('favorable quand tout est favorable', () => {
    expect(avisSuggere([doc('a', 'notices', 'approved'), doc('b', 'plans_execution', 'approved')], REQ)).toBe('favorable');
  });
});

describe('relances automatiques', () => {
  const demande = { sent_at: '2026-10-01T08:00:00Z', email: 'a@b.fr', reminder_count: 0 };
  it("relance après l'intervalle, pas avant", () => {
    const p = prochaineRelance(demande, { reminder_interval_days: 7 }, 'sollicitee')!;
    expect(p.toISOString()).toBe('2026-10-08T08:00:00.000Z');
    expect(relanceDue(demande, {}, 'sollicitee', new Date('2026-10-07T00:00:00Z'))).toBe(false);
    expect(relanceDue(demande, {}, 'sollicitee', new Date('2026-10-08T09:00:00Z'))).toBe(true);
  });
  it('repart de la dernière relance', () => {
    const p = prochaineRelance({ ...demande, last_reminder_at: '2026-10-08T08:00:00Z', reminder_count: 1 }, {}, 'partiel')!;
    expect(p.toISOString()).toBe('2026-10-15T08:00:00.000Z');
  });
  it("s'arrête : coupée, plafond, sans adresse, révoquée, dossier qui n'attend plus l'entreprise", () => {
    expect(prochaineRelance(demande, { reminder_enabled: false }, 'sollicitee')).toBeNull();
    expect(prochaineRelance({ ...demande, reminder_count: 4 }, {}, 'sollicitee')).toBeNull();
    expect(prochaineRelance({ ...demande, email: null }, {}, 'sollicitee')).toBeNull();
    expect(prochaineRelance({ ...demande, revoked_at: '2026-10-02T00:00:00Z' }, {}, 'sollicitee')).toBeNull();
    expect(prochaineRelance(demande, {}, 'a_analyser')).toBeNull();
    expect(prochaineRelance(demande, {}, 'vise')).toBeNull();
    expect(prochaineRelance({ sent_at: null, email: 'a@b.fr' }, {}, 'sollicitee')).toBeNull();
  });
  it("plafonne l'intervalle et le nombre de relances", () => {
    const p = prochaineRelance(demande, { reminder_interval_days: 1 }, 'sollicitee')!;
    expect(p.toISOString()).toBe('2026-10-03T08:00:00.000Z');
    expect(prochaineRelance({ ...demande, reminder_count: 10 }, { reminder_max: 99 }, 'sollicitee')).toBeNull();
  });
  it("ne programme rien au-delà de l'expiration du lien", () => {
    expect(prochaineRelance({ ...demande, expires_at: '2026-10-05T00:00:00Z' }, {}, 'sollicitee')).toBeNull();
  });
});

describe('expiration du lien', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  it('repousse après la date limite, jamais avant maintenant', () => {
    expect(expirationLienDoe('2026-12-01T00:00:00Z', now).toISOString()).toBe('2027-01-30T00:00:00.000Z');
    expect(expirationLienDoe('2026-01-01T00:00:00Z', now).getTime()).toBeGreaterThan(now.getTime());
    expect(expirationLienDoe(null, now).toISOString()).toBe('2027-03-30T00:00:00.000Z');
  });
});

describe('classement et analyse', () => {
  it('reconnaît une pièce à son nom et à son texte', () => {
    expect(classerPiece('Notice entretien chaudière.pdf')?.piece).toBe('notices');
    expect(classerPiece("PV essais étanchéité à l'air.pdf")?.piece).toBe('pv_essais');
    expect(classerPiece('Certificat de garantie décennale.pdf')?.piece).toBe('garanties');
    expect(classerPiece('scan0001.pdf')).toBeNull();
    expect(classerPiece('scan0001.pdf', "Notice de fonctionnement et manuel d'utilisation. Entretien annuel.")?.piece).toBe('notices');
  });

  it('signale scan, texte court, pièce inconnue, format de plan et doublon', () => {
    const a = analyserDocument({ id: '1', name: 'scan0001.pdf', doe_piece: null }, '');
    expect(a.anomalies).toEqual(expect.arrayContaining(['texte_absent', 'piece_non_reconnue']));
    const b = analyserDocument({ id: '2', name: 'plan.dwg', doe_piece: 'plans_execution' }, undefined);
    expect(b.anomalies).toContain('format_plan');
    const c = analyserDocument({ id: '3', name: 'Notice.pdf', doe_piece: 'notices' }, 'court', [{ id: '4', name: 'notice.PDF' }]);
    expect(c.anomalies).toEqual(expect.arrayContaining(['texte_court', 'doublon']));
  });

  it('signale une pièce déclarée différente de celle détectée', () => {
    const a = analyserDocument({ id: '1', name: 'Notice entretien fonctionnement.pdf', doe_piece: 'garanties' }, null);
    expect(a.anomalies).toContain('piece_differente');
  });
});

describe('synthèse et archive', () => {
  it('compte par statut', () => {
    const s = syntheseOperation(['vise', 'vise', 'a_solliciter', 'conforme', 'a_corriger', 'partiel']);
    expect(s).toMatchObject({ entreprises: 6, visees: 2, aSolliciter: 1, aAnalyser: 1, aCorriger: 1, enAttente: 1 });
    expect(s.avancement).toBeCloseTo(1 / 3);
  });
  it("l'archive n'est prête que si toutes les entreprises sont visées", () => {
    expect(archivePrete([])).toBe(false);
    expect(archivePrete(['vise', 'conforme'])).toBe(false);
    expect(archivePrete(['vise', 'vise'])).toBe(true);
  });
  it('nomme sans caractère dangereux et sans collision', () => {
    expect(nomSur('../../etc/passwd')).not.toContain('/');
    expect(nomSur('a:b*c?.pdf')).toBe('a b c .pdf');
    expect(nomSur('   ', 'x')).toBe('x');
    const chemins = cheminsArchive([
      { nom: 'notice.pdf', dossier: ['02', 'Lot 02'] },
      { nom: 'Notice.pdf', dossier: ['02', 'Lot 02'] },
      { nom: 'notice.pdf', dossier: ['02', 'Lot 03'] },
    ]);
    expect(chemins).toEqual(['02/Lot 02/notice.pdf', '02/Lot 02/Notice (2).pdf', '02/Lot 03/notice.pdf']);
  });
  it('numérote les visas', () => {
    expect(numeroVisa(3, 2026)).toBe('DOE-2026-003');
  });
});

describe('messages', () => {
  const p = {
    cabinet: 'AAZS', operation: 'IUT <Longwy>', entreprise: 'SARL Dupont', lien: 'https://x.test/doe/abc',
    lots: ['Lot 02 Charpente'], piecesAttendues: ['notices', 'garanties'] as DoePieceKey[], deadlineAt: '2099-01-15T00:00:00Z',
  };
  it('la sollicitation liste les pièces et échappe le HTML', () => {
    const m = construireSollicitation(p);
    expect(m.subject).toContain('DOE à remettre');
    expect(m.html).toContain('Notices de fonctionnement');
    expect(m.html).toContain('IUT &lt;Longwy&gt;');
    expect(m.html).toContain('https://x.test/doe/abc');
  });
  it('la relance ne cite que les pièces manquantes', () => {
    const m = construireRelance({ ...p, piecesManquantes: ['garanties'], numeroRelance: 2 });
    expect(m.subject).toContain('relance 2');
    expect(m.html).toContain('Garanties');
    expect(m.html).not.toContain('Notices de fonctionnement');
  });
});
