// PV d'OPR par lot : statut déduit, formulaire de décision, contrôles, délais, assainissement.
import { describe, expect, it } from 'vitest';
import {
  ajouterJours, conditionsSuggerees, controlerPv, estDateIso, formulaireDecision, formulairesDuPv,
  joursEntre, naturesImpliquees, optionLeveeRetenue, pvVierge, regimeDepuisAffaire, statutPv, type OprPv,
} from '../oprPv';
import { DELAIS_PAR_DEFAUT, aEcheanceEnRetard, delaiEffectif, echeances } from '../oprPvDelais';
import { lirePv, sanitizeOprPayload } from '../oprPvSanitize';

const pvPublic = (surcharge: Partial<OprPv> = {}): OprPv => ({ ...pvVierge('public'), marche_id: 'm1', ...surcharge });
const pvPrive = (surcharge: Partial<OprPv> = {}): OprPv => ({ ...pvVierge('prive'), marche_id: 'm1', ...surcharge });
const codes = (liste: Array<{ code: string }>) => liste.map(a => a.code);

describe('régime', () => {
  it("se déduit du maître d'ouvrage de l'affaire", () => {
    expect(regimeDepuisAffaire(true)).toBe('public');
    expect(regimeDepuisAffaire(false)).toBe('prive');
    expect(regimeDepuisAffaire(undefined)).toBe('prive');
  });
});

describe('statutPv', () => {
  it('se déduit de ce qui est renseigné, jamais saisi', () => {
    const pv = pvPrive();
    expect(statutPv(pv)).toBe('a_planifier');
    pv.date_opr = '2026-11-03';
    expect(statutPv(pv)).toBe('opr_realisee');
    pv.proposition.avis = 'avec_reserve';
    expect(statutPv(pv)).toBe('proposition_emise');
    pv.decision.issue = 'avec_reserve';
    expect(statutPv(pv)).toBe('receptionnee_avec_reserves');
    pv.decision.issue = 'sans_reserve';
    expect(statutPv(pv)).toBe('receptionnee');
    pv.decision.issue = 'non_receptionnee';
    expect(statutPv(pv)).toBe('non_receptionnee');
  });
});

describe('formulaires du marché public', () => {
  it("la décision suit la proposition, puis la décision elle-même : EXE7 pour une non-réception, EXE6 sinon", () => {
    const pv = pvPublic();
    expect(formulaireDecision(pv)).toBeNull();
    pv.proposition.avis = 'sans_reserve';
    expect(formulaireDecision(pv)).toBe('EXE6');
    pv.proposition.avis = 'non_reception';
    expect(formulaireDecision(pv)).toBe('EXE7');
    pv.decision.issue = 'avec_reserve';
    expect(formulaireDecision(pv)).toBe('EXE6');
  });

  it('un privé n\'a aucun cerfa', () => {
    expect(formulaireDecision(pvPrive({ proposition: { ...pvVierge('prive').proposition, avis: 'sans_reserve' } }))).toBeNull();
    expect(formulairesDuPv(pvPrive())).toEqual([]);
  });

  it("enchaîne EXE4 à EXE9, sans levée des réserves après une non-réception", () => {
    const pv = pvPublic();
    expect(formulairesDuPv(pv)).toEqual(['EXE4', 'EXE5']);
    pv.proposition.avis = 'avec_reserve';
    expect(formulairesDuPv(pv)).toEqual(['EXE4', 'EXE5', 'EXE6', 'EXE8', 'EXE9']);
    pv.proposition.avis = 'non_reception';
    expect(formulairesDuPv(pv)).toEqual(['EXE4', 'EXE5', 'EXE7']);
  });
});

describe('réserves déduites des constats', () => {
  it('chaque constat négatif ou « à l\'exception de » appelle une nature de réserve', () => {
    const pv = pvPublic();
    expect(naturesImpliquees(pv.constats)).toEqual([]);
    pv.constats = {
      ...pv.constats,
      epreuves: 'concluantes_sauf_annexe', travaux: 'executes_sauf_annexe', ouvrages: 'conformes_sauf_annexe',
      installations: 'repliees', terrains: 'non_remis_en_etat', pose_equipements: 'non_conforme',
      annexes: { epreuves: '1', malfacons: '3' },
    };
    expect(naturesImpliquees(pv.constats)).toEqual(['epreuves', 'travaux', 'malfacons', 'installations', 'pose']);
    expect(conditionsSuggerees(pv.constats).find(c => c.nature === 'malfacons')).toEqual({ nature: 'malfacons', avant_le: null, annexe: '3' });
  });

  it('des constats conformes n\'impliquent rien', () => {
    const c = { ...pvVierge('public').constats, epreuves: 'concluantes' as const, travaux: 'executes' as const, ouvrages: 'conformes' as const, installations: 'repliees' as const, terrains: 'remis_en_etat' as const, pose_equipements: 'conforme' as const };
    expect(naturesImpliquees(c)).toEqual([]);
  });
});

describe('controlerPv', () => {
  it('exige un lot, et signale le CCAG manquant en public seulement', () => {
    const sansLot = { ...pvPublic(), marche_id: null };
    expect(codes(controlerPv(sansLot).erreurs)).toContain('lot_manquant');
    expect(codes(controlerPv(pvPublic()).avertissements)).toContain('ccag_manquant');
    expect(codes(controlerPv(pvPrive()).avertissements)).not.toContain('ccag_manquant');
    expect(codes(controlerPv(pvPublic({ ccag_version: '2021' })).avertissements)).not.toContain('ccag_manquant');
  });

  it('refuse « sans réserve » quand des réserves restent à lever', () => {
    const pv = pvPrive();
    pv.proposition.avis = 'sans_reserve';
    expect(controlerPv(pv).erreurs).toEqual([]);
    expect(codes(controlerPv(pv, { reservesOuvertes: 2 }).erreurs)).toContain('reserves_ouvertes');
    pv.proposition.avis = null;
    pv.decision.issue = 'sans_reserve';
    expect(codes(controlerPv(pv, { reservesOuvertes: 1 }).erreurs)).toContain('reserves_ouvertes');
  });

  it("avertit quand « sans réserve » contredit les constats", () => {
    const pv = pvPrive();
    pv.constats.ouvrages = 'conformes_sauf_annexe';
    pv.proposition.avis = 'sans_reserve';
    expect(codes(controlerPv(pv).avertissements)).toContain('avis_incoherent_constats');
  });

  it('une réception avec réserve doit dire ce qui reste à faire, avec une date pour malfaçons, repli et pose', () => {
    const pv = pvPrive();
    pv.proposition.avis = 'avec_reserve';
    expect(codes(controlerPv(pv).erreurs)).toContain('proposition_conditions_manquantes');
    pv.proposition.conditions = [{ nature: 'malfacons', avant_le: null, annexe: '1' }];
    expect(codes(controlerPv(pv).erreurs)).toContain('proposition_date_manquante');
    pv.proposition.conditions = [{ nature: 'malfacons', avant_le: '2026-12-01', annexe: '1' }];
    expect(controlerPv(pv).erreurs).toEqual([]);
  });

  it('en public, « sous réserve » ne porte que épreuves et travaux, « avec réserve » que malfaçons, repli et pose', () => {
    const pv = pvPublic({ ccag_version: '2021' });
    pv.proposition.avis = 'sous_reserve';
    pv.proposition.conditions = [{ nature: 'malfacons', avant_le: '2026-12-01', annexe: null }];
    expect(codes(controlerPv(pv).erreurs)).toContain('proposition_nature_incompatible');
    pv.proposition.conditions = [{ nature: 'epreuves', avant_le: null, annexe: '1' }];
    expect(controlerPv(pv).erreurs).toEqual([]);
    // Le modèle simplifié du privé réunit les deux volets.
    const prive = pvPrive();
    prive.proposition.avis = 'sous_reserve';
    prive.proposition.conditions = [{ nature: 'malfacons', avant_le: '2026-12-01', annexe: null }];
    expect(controlerPv(prive).erreurs).toEqual([]);
  });

  it('sans réserve ni réception, aucune condition ne peut figurer', () => {
    const pv = pvPrive();
    pv.proposition.avis = 'non_reception';
    pv.proposition.conditions = [{ nature: 'epreuves', avant_le: null, annexe: null }];
    expect(codes(controlerPv(pv).erreurs)).toContain('proposition_conditions_inattendues');
  });

  it("exige l'annexe d'un constat « à l'exception de » en public, et la convocation d'une entreprise absente", () => {
    const pv = pvPublic({ ccag_version: '2009' });
    pv.constats.travaux = 'executes_sauf_annexe';
    pv.presences.entreprise = 'absente_convoquee';
    const erreurs = codes(controlerPv(pv).erreurs);
    expect(erreurs).toContain('annexe_manquante');
    expect(erreurs).toContain('convocation_manquante');
    pv.constats.annexes.travaux = '2';
    pv.presences.date_convocation = '2026-10-20';
    expect(controlerPv(pv).erreurs).toEqual([]);
  });

  it('refuse une proposition ou une décision antérieure aux OPR', () => {
    const pv = pvPrive({ date_opr: '2026-11-03' });
    pv.proposition.date_proposition = '2026-11-02';
    pv.decision.date_decision = '2026-11-01';
    const erreurs = codes(controlerPv(pv).erreurs);
    expect(erreurs).toContain('proposition_avant_opr');
    expect(erreurs).toContain('decision_avant_opr');
  });
});

describe('dates', () => {
  it('ne valide que de vraies dates AAAA-MM-JJ', () => {
    expect(estDateIso('2026-02-28')).toBe(true);
    expect(estDateIso('2026-02-30')).toBe(false);
    expect(estDateIso('03/11/2026')).toBe(false);
    expect(estDateIso(null)).toBe(false);
  });

  it('calcule en UTC, sans décalage de changement d\'heure', () => {
    expect(ajouterJours('2026-03-20', 20)).toBe('2026-04-09');
    expect(ajouterJours('2026-10-20', 10)).toBe('2026-10-30');
    expect(joursEntre('2026-03-25', '2026-03-30')).toBe(5);
    expect(joursEntre('2026-03-30', '2026-03-25')).toBe(-5);
  });
});

describe('échéances', () => {
  const parCle = (pv: OprPv, jour: string) => Object.fromEntries(echeances(pv, jour).map(e => [e.cle, e]));

  it('par défaut : OPR sous 20 jours, décision sous 30, transmission de la levée sous 5', () => {
    expect(DELAIS_PAR_DEFAUT).toEqual({ opr: 20, transmission_levee: 5, decision: 30, carence: 30 });
    const pv = pvPrive({ date_avis_achevement: '2026-10-01', date_opr: '2026-10-15' });
    pv.levee.date_pv = '2026-11-02';
    const e = parCle(pv, '2026-10-16');
    expect(e.opr).toMatchObject({ date_limite: '2026-10-21', etat: 'respectee' });
    expect(e.decision).toMatchObject({ depart: '2026-10-15', date_limite: '2026-11-14', etat: 'a_venir', jours_restants: 29 });
    expect(e.transmission_levee).toMatchObject({ date_limite: '2026-11-07' });
  });

  it("le départ des OPR est le plus tardif de l'avis et de l'achèvement annoncé", () => {
    const pv = pvPrive({ date_avis_achevement: '2026-10-01', date_achevement_annoncee: '2026-10-10' });
    expect(parCle(pv, '2026-10-02').opr.date_limite).toBe('2026-10-30');
  });

  it('une échéance faite après sa date limite est hors délai, avant elle respectée', () => {
    const tard = pvPrive({ date_avis_achevement: '2026-10-01', date_opr: '2026-10-25' });
    expect(parCle(tard, '2026-10-26').opr.etat).toBe('hors_delai');
    expect(aEcheanceEnRetard(echeances(tard, '2026-10-26'))).toBe(true);
  });

  it('dépassée, proche ou à venir selon les jours restants', () => {
    const base = { date_avis_achevement: '2026-10-01' };
    expect(parCle(pvPrive(base), '2026-10-22').opr).toMatchObject({ etat: 'depasse', jours_restants: -1 });
    expect(parCle(pvPrive(base), '2026-10-16').opr).toMatchObject({ etat: 'proche', jours_restants: 5 });
    expect(parCle(pvPrive(base), '2026-10-10').opr.etat).toBe('a_venir');
  });

  it("sans date de départ, rien n'est en retard", () => {
    const e = parCle(pvPrive(), '2030-01-01');
    expect(e.opr).toMatchObject({ etat: 'sans_depart', date_limite: null });
    expect(aEcheanceEnRetard(echeances(pvPrive(), '2030-01-01'))).toBe(false);
    expect(e.carence).toBeUndefined();
  });

  it('une date illisible n\'est jamais un retard', () => {
    const pv = pvPrive({ date_avis_achevement: 'bientôt' });
    expect(parCle(pv, '2030-01-01').opr.etat).toBe('sans_depart');
  });

  it("la carence apparaît quand le délai des OPR est dépassé, puis court depuis la lettre recommandée", () => {
    const pv = pvPrive({ date_avis_achevement: '2026-09-01' });
    expect(parCle(pv, '2026-10-26').carence).toMatchObject({ etat: 'sans_depart' });
    pv.carence.date_lettre = '2026-10-20';
    expect(parCle(pv, '2026-10-26').carence).toMatchObject({ date_limite: '2026-11-19', etat: 'a_venir' });
    pv.carence.date_fixation = '2026-11-10';
    expect(parCle(pv, '2026-11-12').carence.etat).toBe('respectee');
  });

  it('les délais du marché l\'emportent, sauf valeur absurde', () => {
    const pv = pvPrive({ date_avis_achevement: '2026-10-01', delais: { opr: 10, decision: 0 } });
    expect(parCle(pv, '2026-10-02').opr.date_limite).toBe('2026-10-11');
    expect(delaiEffectif({ decision: 0 }, 'decision')).toBe(30);
    expect(delaiEffectif({ decision: 400 }, 'decision')).toBe(30);
    expect(delaiEffectif({ decision: 1.5 }, 'decision')).toBe(30);
    expect(delaiEffectif(undefined, 'opr')).toBe(20);
  });
});

describe('sanitizeOprPayload', () => {
  it("ne retient que les sections présentes et ne lit jamais le régime", () => {
    const { colonnes, erreurs } = sanitizeOprPayload({ regime: 'public', project_id: 'p1', marche_id: ' m1 ', date_opr: '2026-11-03' });
    expect(erreurs).toEqual([]);
    expect(colonnes).toEqual({ marche_id: 'm1', date_opr: '2026-11-03' });
  });

  it('un corps sans champ d\'OPR ne donne aucune colonne (PV générique)', () => {
    expect(sanitizeOprPayload({ date: '2026-01-01', type: 'OPR', has_reserves: true }).colonnes).toEqual({});
    expect(sanitizeOprPayload(null).colonnes).toEqual({});
  });

  it('refuse valeurs de vocabulaire inconnues, dates invalides et montants négatifs', () => {
    const { erreurs } = sanitizeOprPayload({
      ccag_version: '1999', date_opr: '3 novembre',
      proposition: { avis: 'peut-être', refaction_montant: -5, conditions: [{ nature: 'peinture' }] },
      delais: { opr: 0 },
    });
    expect(erreurs.length).toBeGreaterThanOrEqual(5);
  });

  it('assainit les sections : doublons de nature écartés, textes bornés, montant arrondi', () => {
    const { colonnes, erreurs } = sanitizeOprPayload({
      proposition: {
        avis: 'avec_reserve', refaction_montant: '1234.567',
        conditions: [
          { nature: 'malfacons', avant_le: '2026-12-01', annexe: '1', injecte: 'x' },
          { nature: 'malfacons', avant_le: '2027-01-01' },
        ],
      },
      constats: { epreuves: 'concluantes', annexes: { travaux: '2', inconnue: '9' } },
      delais: { opr: '25', decision: '' },
    });
    expect(erreurs).toEqual([]);
    expect(colonnes.proposition).toMatchObject({
      avis: 'avec_reserve', refaction_montant: 1234.57,
      conditions: [{ nature: 'malfacons', avant_le: '2026-12-01', annexe: '1' }],
    });
    expect((colonnes.constats as any).annexes).toEqual({ travaux: '2' });
    expect(colonnes.delais).toEqual({ opr: 25 });
  });

  it('une section à null est remise à null en base', () => {
    expect(sanitizeOprPayload({ carence: null }).colonnes).toEqual({ carence: null });
  });
});

describe('lirePv', () => {
  it('rend null pour un PV générique', () => {
    expect(lirePv({ id: 'r1', regime: null })).toBeNull();
    expect(lirePv(null)).toBeNull();
  });

  it('complète les sections absentes ou abîmées sans lever d\'exception', () => {
    const pv = lirePv({ regime: 'public', marche_id: 'm1', date_opr: 'n\'importe quoi', constats: 'abîmé', proposition: { avis: 'sans_reserve' } })!;
    expect(pv.regime).toBe('public');
    expect(pv.date_opr).toBeNull();
    expect(pv.constats).toEqual(pvVierge('public').constats);
    expect(pv.proposition.avis).toBe('sans_reserve');
    expect(pv.levee).toEqual(pvVierge('public').levee);
  });
});

describe('levée des réserves', () => {
  const recu = (surcharge: Partial<OprPv> = {}): OprPv => {
    const pv = { ...pvPublic({ ccag_version: '2021', date_opr: '2026-10-01' }), ...surcharge };
    pv.public_info = { portee: 'totale', prestations: null, signataire: null, reference_marche: null };
    pv.decision = { ...pv.decision, issue: 'avec_reserve', date_decision: '2026-10-20', conditions: [{ nature: 'malfacons', avant_le: '2026-12-01', annexe: '1' }] };
    return pv;
  };

  it("l'issue retenue est la décision du maître d'ouvrage, ou la proposition quand il l'accepte", () => {
    const pv = recu();
    expect(optionLeveeRetenue(pv.levee)).toBeNull();
    pv.levee.proposition.option = 'lever_toutes';
    expect(optionLeveeRetenue(pv.levee)).toBeNull();
    pv.levee.decision.option = 'accepter';
    expect(optionLeveeRetenue(pv.levee)).toBe('lever_toutes');
    pv.levee.decision.option = 'maintenir_toutes';
    expect(optionLeveeRetenue(pv.levee)).toBe('maintenir_toutes');
  });

  it('le statut suit la levée : réserves levées, réception rapportée, sinon toujours avec réserves', () => {
    const pv = recu();
    expect(statutPv(pv)).toBe('receptionnee_avec_reserves');
    pv.levee.proposition.option = 'lever_toutes';
    pv.levee.decision.option = 'accepter';
    expect(statutPv(pv)).toBe('reserves_levees');
    pv.levee.decision.option = 'rapporter';
    expect(statutPv(pv)).toBe('reception_rapportee');
    pv.levee.decision.option = 'maintenir_toutes';
    expect(statutPv(pv)).toBe('receptionnee_avec_reserves');
    // Une levée sur une réception sans réserve n'a pas de sens : le statut reste « réceptionné ».
    const sans = recu();
    sans.decision.issue = 'sans_reserve';
    sans.levee.decision.option = 'lever_toutes';
    expect(statutPv(sans)).toBe('receptionnee');
  });

  it('une levée sans réception avec réserves est signalée', () => {
    const pv = recu();
    pv.decision = { ...pv.decision, issue: 'sans_reserve', conditions: [] };
    pv.levee.date_pv = '2026-11-20';
    expect(codes(controlerPv(pv).avertissements)).toContain('levee_sans_reserve');
    expect(codes(controlerPv(recu()).avertissements)).not.toContain('levee_sans_reserve');
  });

  it('une levée partielle exige l\'annexe des réserves levées, celles qui sont maintenues et leur date', () => {
    const pv = recu();
    pv.levee.date_pv = '2026-11-20';
    pv.levee.proposition = { option: 'lever_partie', date: '2026-11-21', annexe_levees: null, maintenues: [] };
    let erreurs = codes(controlerPv(pv).erreurs);
    expect(erreurs).toContain('levee_proposition_annexe_manquante');
    expect(erreurs).toContain('levee_proposition_maintenues_manquantes');
    pv.levee.proposition = { option: 'lever_partie', date: '2026-11-21', annexe_levees: '2', maintenues: [{ nature: 'installations', avant_le: null, annexe: null }] };
    expect(codes(controlerPv(pv).erreurs)).toContain('levee_proposition_date_manquante');
    pv.levee.proposition.maintenues = [{ nature: 'installations', avant_le: '2026-12-10', annexe: null }, { nature: 'malfacons', avant_le: null, annexe: '3' }];
    expect(controlerPv(pv).erreurs).toEqual([]);
    // Les réserves maintenues ne se précisent que pour une levée partielle.
    pv.levee.proposition.option = 'maintenir_toutes';
    erreurs = codes(controlerPv(pv).erreurs);
    expect(erreurs).toContain('levee_proposition_maintenues_inattendues');
  });

  it('la décision du maître d\'ouvrage qui accepte les propositions n\'a pas de réserve à préciser', () => {
    const pv = recu();
    pv.levee.date_pv = '2026-11-20';
    pv.levee.proposition = { option: 'lever_toutes', date: '2026-11-21', annexe_levees: null, maintenues: [] };
    pv.levee.decision = { option: 'accepter', date: '2026-11-25', annexe_levees: null, maintenues: [] };
    expect(controlerPv(pv).erreurs).toEqual([]);
  });

  it('la proposition ou la décision sur la levée ne précèdent pas le PV de levée', () => {
    const pv = recu();
    pv.levee.date_pv = '2026-11-20';
    pv.levee.proposition = { option: 'lever_toutes', date: '2026-11-10', annexe_levees: null, maintenues: [] };
    pv.levee.decision = { option: 'lever_toutes', date: '2026-11-11', annexe_levees: null, maintenues: [] };
    const erreurs = codes(controlerPv(pv).erreurs);
    expect(erreurs).toContain('levee_proposition_avant_pv');
    expect(erreurs).toContain('levee_decision_avant_pv');
  });

  it('assainie côté serveur : options de vocabulaire fermé, réserves maintenues bornées', () => {
    const ok = sanitizeOprPayload({ levee: {
      date_pv: '2026-11-20',
      presences: { moa: 'present', entreprise: 'absente_convoquee', date_convocation: '2026-11-10' },
      constats: { epreuves: 'concluantes', ouvrages: 'conformes_sauf_annexe', annexes: { malfacons: '3' } },
      proposition: { option: 'lever_partie', date: '2026-11-21', annexe_levees: '2', maintenues: [{ nature: 'pose', avant_le: '2026-12-01' }, { nature: 'pose' }] },
      decision: { option: 'accepter' },
    } });
    expect(ok.erreurs).toEqual([]);
    const levee = ok.colonnes.levee as any;
    expect(levee.presences).toEqual({ moa: 'present', entreprise: 'absente_convoquee', date_convocation: '2026-11-10' });
    expect(levee.constats.annexes).toEqual({ malfacons: '3' });
    expect(levee.proposition.maintenues).toEqual([{ nature: 'pose', avant_le: '2026-12-01', annexe: null }]);
    expect(levee.decision.option).toBe('accepter');
    expect(sanitizeOprPayload({ levee: { proposition: { option: 'accepter' } } }).erreurs.length).toBe(1); // « accepter » n'est pas une proposition
    expect(sanitizeOprPayload({ levee: { decision: { option: 'tout_lever' } } }).erreurs.length).toBe(1);
  });

  it("lit une levée enregistrée à l'ancienne (deux dates seulement) sans rien perdre", () => {
    const pv = lirePv({ regime: 'public', levee: { date_pv: '2026-11-20', date_transmission: '2026-11-24' } })!;
    expect(pv.levee).toMatchObject({ date_pv: '2026-11-20', date_transmission: '2026-11-24' });
    expect(pv.levee.proposition.option).toBeNull();
    expect(pv.levee.presences.moa).toBeNull();
  });
});
