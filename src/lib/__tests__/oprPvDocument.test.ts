// Contenu et rendu du PV d'OPR privé (modèle simplifié du cabinet).
import { describe, expect, it } from 'vitest';
import { pvVierge, type OprPv } from '../oprPv';
import { construirePvPrive, dateFr, libelleLot, type BlocPv, type DonneesPvPrive } from '../oprPvDocument';

const donnees = (surcharge: Partial<DonneesPvPrive> = {}, pv: Partial<OprPv> = {}): DonneesPvPrive => ({
  pv: { ...pvVierge('prive'), marche_id: 'm1', date_opr: '2023-10-11', ...pv },
  reference: 'OPR-2023-001',
  maitreOuvrage: 'SCI ACORIS Hôtel Club',
  objetMarche: 'Création de 6 SdB et réhabilitation de 6 chambres',
  dateMarche: '2023-03-02',
  lot: libelleLot('01', 'Démolition, gros œuvre'),
  entreprise: 'BTS',
  maitreOeuvre: 'Atelier ZOMENO SEKTAOUI',
  reserves: [],
  ...surcharge,
});

type Case = Extract<BlocPv, { t: 'case' }>;
const cases = (blocs: BlocPv[]): Case[] => blocs.filter((b): b is Case => b.t === 'case');
const cochees = (blocs: BlocPv[]): string[] => cases(blocs).filter(c => c.cochee).map(c => c.text);
const titres = (blocs: BlocPv[]): string[] => blocs.filter((b): b is Extract<BlocPv, { t: 'titre' }> => b.t === 'titre').map(b => b.text);

describe('libellés', () => {
  it('le lot et les dates', () => {
    expect(libelleLot('01', 'Gros œuvre')).toBe('Lot 01 · Gros œuvre');
    expect(libelleLot(null, 'Gros œuvre')).toBe('Gros œuvre');
    expect(dateFr('2023-10-11')).toBe('11/10/2023');
    expect(dateFr('2023-10-11T08:30:00Z')).toBe('11/10/2023');
    expect(dateFr('bientôt')).toBe('');
    expect(dateFr(null)).toBe('');
  });
});

describe('construirePvPrive', () => {
  it('suit le modèle : identification, A, B, C puis annexe', () => {
    const doc = construirePvPrive(donnees());
    expect(doc.titre).toBe("PROCÈS-VERBAL D'OPR");
    expect(doc.intitule).toBe('PROCÈS-VERBAL DES OPÉRATIONS PRÉALABLES À LA RÉCEPTION');
    expect(doc.sousTitre).toBe('Lot 01 · Démolition, gros œuvre · BTS');
    expect(doc.reference).toBe('OPR-2023-001');
    expect(doc.date).toBe('11/10/2023');
    expect(titres(doc.blocs)).toEqual([
      'A. Procès-verbal des opérations préalables à la réception',
      "B. Proposition du maître d'œuvre au maître de l'ouvrage",
      "C. Décision du maître de l'ouvrage",
      'Annexe au procès-verbal des opérations préalables à la réception',
    ]);
    const fiche = doc.blocs[0] as Extract<BlocPv, { t: 'fiche' }>;
    expect(fiche.lignes).toContainEqual(['Date du marché', '02/03/2023']);
    expect(fiche.lignes).toContainEqual(['Date des OPR', '11/10/2023']);
  });

  it("n'imprime que ce qui est renseigné : un PV vierge n'a aucune case cochée", () => {
    const doc = construirePvPrive(donnees({ dateMarche: null, entreprise: null }));
    expect(cochees(doc.blocs)).toEqual([]);
    const fiche = doc.blocs[0] as Extract<BlocPv, { t: 'fiche' }>;
    expect(fiche.lignes.map(([k]) => k)).not.toContain('Date du marché');
    expect(fiche.lignes.map(([k]) => k)).not.toContain('Entreprise');
  });

  it('coche les constats choisis et les présences, avec la convocation', () => {
    const pv = pvVierge('prive');
    pv.presences = { moa: 'present', entreprise: 'absente_convoquee', date_convocation: '2023-10-02' };
    pv.constats = { ...pv.constats, epreuves: 'concluantes', travaux: 'executes_sauf_annexe', ouvrages: 'conformes', installations: 'non_repliees', terrains: 'remis_en_etat' };
    const doc = construirePvPrive(donnees({}, pv));
    expect(cochees(doc.blocs)).toEqual([
      "en présence du maître d'ouvrage",
      "en l'absence de l'entrepreneur dûment convoqué (convocation par courrier du 02/10/2023)",
      'sont concluantes.',
      "ont été exécutés, à l'exception de ceux indiqués en annexe.",
      'sont conformes aux spécifications du marché.',
      "n'ont pas été repliées.",
      'ont été remis en état.',
    ]);
  });

  it('une proposition sans réserve coche la date d\'achèvement retenue, pas les conditions', () => {
    const pv = pvVierge('prive');
    pv.proposition = { ...pv.proposition, avis: 'sans_reserve', date_achevement_retenue: '2023-10-09', date_proposition: '2023-10-12' };
    const doc = construirePvPrive(donnees({}, pv));
    const sans = cases(doc.blocs).find(c => c.text.startsWith('sans réserve, en retenant'))!;
    expect(sans).toMatchObject({ cochee: true, valeur: '09/10/2023' });
    expect(cochees(doc.blocs)).not.toContain('sous réserve de :');
  });

  it('une réception sous réserve coche ses conditions, avec dates et réfaction', () => {
    const pv = pvVierge('prive');
    pv.proposition = {
      ...pv.proposition, avis: 'sous_reserve', refaction_montant: 1234.5,
      conditions: [
        { nature: 'malfacons', avant_le: '2023-11-15', annexe: null },
        { nature: 'installations', avant_le: '2023-11-30', annexe: null },
      ],
    };
    const doc = construirePvPrive(donnees({}, pv));
    const b = cases(doc.blocs).filter(c => c.niveau === 1).slice(0, 5);
    expect(b.map(c => c.cochee)).toEqual([false, false, true, true, true]);
    expect(b[2]).toMatchObject({ valeur: '15/11/2023' });
    expect(b[3].valeur).toBe('1 234,50 €');
    expect(b[3].valeur).not.toMatch(/[  ]/);
    // Une date manquante s'imprime en pointillés, jamais inventée.
    expect(b[0].valeur).toBe('');
  });

  it("la pose des équipements, absente du modèle simplifié, n'est imprimée que si elle est retenue", () => {
    const sans = construirePvPrive(donnees());
    expect(cases(sans.blocs).some(c => /pose des équipements/.test(c.text))).toBe(false);
    const pv = pvVierge('prive');
    pv.proposition = { ...pv.proposition, avis: 'sous_reserve', conditions: [{ nature: 'pose', avant_le: '2023-12-01', annexe: null }] };
    const avec = construirePvPrive(donnees({}, pv));
    expect(cases(avec.blocs).find(c => /pose des équipements/.test(c.text))).toMatchObject({ cochee: true, valeur: '01/12/2023' });
  });

  it('la décision du maître d\'ouvrage reprend la réfaction acceptée et la non-réception', () => {
    const pv = pvVierge('prive');
    pv.decision = { ...pv.decision, issue: 'avec_reserve', refaction_montant: 500, conditions: [{ nature: 'travaux', avant_le: null, annexe: null }] };
    const doc = construirePvPrive(donnees({}, pv));
    expect(cases(doc.blocs).find(c => /réfaction acceptée/.test(c.text))).toMatchObject({ cochee: true, valeur: '500,00 €' });

    const non = pvVierge('prive');
    non.decision = { ...non.decision, issue: 'non_receptionnee' };
    expect(cochees(construirePvPrive(donnees({}, non)).blocs)).toContain("Il n'y a pas lieu de prononcer la réception.");
  });

  it('les blocs de signature portent les dates des trois volets', () => {
    const pv = pvVierge('prive');
    pv.date_opr = '2023-10-11';
    pv.proposition = { ...pv.proposition, date_proposition: '2023-10-12' };
    pv.decision = { ...pv.decision, date_decision: '2023-10-20' };
    const signatures = construirePvPrive(donnees({}, pv)).blocs.filter((b): b is Extract<BlocPv, { t: 'signatures' }> => b.t === 'signatures');
    expect(signatures.map(s => s.cases[0].date)).toEqual(['11/10/2023', '12/10/2023', '20/10/2023']);
    expect(signatures[0].cases[0].sous).toBe('Atelier ZOMENO SEKTAOUI');
  });
});

describe("annexe des réserves", () => {
  const tableau = (d: DonneesPvPrive) => construirePvPrive(d).blocs.find((b): b is Extract<BlocPv, { t: 'tableau' }> => b.t === 'tableau')!;

  it('sans réserve, laisse des lignes vides à compléter à la main', () => {
    const t = tableau(donnees());
    expect(t.lignes).toHaveLength(4);
    expect(t.lignes.every(l => Array.isArray(l) && l.every(c => c === ''))).toBe(true);
    expect(t.entetes).toHaveLength(t.largeurs.length);
  });

  it("numéro, localisation, date et points à lever ; les colonnes de levée restent vides pour la suite", () => {
    const t = tableau(donnees({ reserves: [{ numero: 2, localisation: 'Chambre 4', date: '2023-10-11T10:00:00Z', points: 'Reprise du joint silicone' }] }));
    expect(t.lignes).toEqual([['2', 'Chambre 4', '11/10/2023', 'Reprise du joint silicone', '', '']]);
  });

  it('groupe par bâtiment dès que plusieurs existent, dans l\'ordre des numéros', () => {
    const t = tableau(donnees({ reserves: [
      { numero: 3, batiment: 'B', localisation: 'RDC', points: 'c' },
      { numero: 1, batiment: 'A', localisation: 'R+1', points: 'a' },
      { numero: 2, batiment: 'A', localisation: 'R+2', points: 'b' },
    ] }));
    expect(t.lignes.map(l => (Array.isArray(l) ? l[0] : l.groupe))).toEqual(['Bâtiment A', '1', '2', 'Bâtiment B', '3']);
  });

  it("n'ajoute aucun groupe quand aucune réserve n'a de bâtiment", () => {
    const t = tableau(donnees({ reserves: [{ numero: 1, localisation: 'x', points: 'a' }, { numero: 2, localisation: 'y', points: 'b' }] }));
    expect(t.lignes.every(l => Array.isArray(l))).toBe(true);
  });
});

describe('rendu', () => {
  it('le PDF a au moins deux pages (le PV puis l\'annexe) et se génère sans bloc manquant', async () => {
    const [{ jsPDF }, autoTable] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const { rendreDocPv } = await import('../oprPvPdf');
    const pv = pvVierge('prive');
    pv.presences = { moa: 'present', entreprise: 'presente', date_convocation: null };
    pv.proposition = { ...pv.proposition, avis: 'sous_reserve', conditions: [{ nature: 'malfacons', avant_le: '2023-11-15', annexe: null }] };
    const reserves = Array.from({ length: 40 }, (_, i) => ({ numero: i + 1, localisation: `Chambre ${i + 1}`, points: 'Reprise des finitions'.repeat(3) }));
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    rendreDocPv(
      { pdf, autoTable: autoTable.default as any, settings: { agencyName: 'Atelier ZOMENO SEKTAOUI' } as any, logo: null },
      construirePvPrive(donnees({ reserves }, pv)),
    );
    // PV (1 à 2 pages) + annexe de 40 lignes (plusieurs pages) : le tableau se poursuit d'une page à l'autre.
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(3);
  });

  it('le Word est un document valide, avec le même contenu', async () => {
    const { construireDocxPv } = await import('../oprPvDocx');
    const blob = await construireDocxPv(construirePvPrive(donnees({ reserves: [{ numero: 1, localisation: 'Chambre 4', points: 'Joint' }] })), { agencyName: 'Atelier ZOMENO SEKTAOUI' } as any);
    const octets = new Uint8Array(await blob.arrayBuffer());
    expect(blob.size).toBeGreaterThan(2000);
    // Un .docx est une archive ZIP.
    expect(String.fromCharCode(octets[0], octets[1])).toBe('PK');
  });
});
