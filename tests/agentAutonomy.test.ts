// Couvre les quatre pièces ajoutées par le lot « autonomie des agents » :
// le périmètre d'outils selon les capacités, les règles d'alerte métier
// (dont « études sans contrat signé »), le calcul de la prochaine exécution
// planifiée, et la mise en page des documents produits.
import { describe, expect, it } from 'vitest';

import { buildAgentTools, executeAgentAction } from '../packages/archioffice-agents/src/server/tools';
import { capabilitiesFromAgent, AGENT_DEFAULT_ACTION_SCOPES } from '../packages/archioffice-agents/src/types';
import {
  ALERT_RULES_BY_CODE, effectiveSettings, evaluateSnapshot, type TenantSnapshot,
} from '../server/agentAlerts';
import { computeNextRun } from '../packages/archioffice-agents/src/server/scheduler';
import { generateArtifact, parseLines } from '../packages/archioffice-agents/src/server/artifacts';
import { readImageSize, agencyFooterLine, type AgencyIdentity } from '../packages/archioffice-agents/src/server/agencyIdentity';
import { summarizeCctp, summarizeDpgf } from '../packages/archioffice-agents/src/server/projectDocTools';
import { stripGeometry } from '../packages/archioffice-agents/src/server/geoTools';

const NO_CAPS = { action_scopes: [], web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false, geo_enabled: false, docs_read_enabled: false };

function toolNames(agent: Partial<typeof NO_CAPS>) {
  return buildAgentTools(capabilitiesFromAgent({ ...NO_CAPS, ...agent })).map(t => t.name);
}

describe('périmètre des outils selon les capacités', () => {
  it("n'expose aucun outil à un agent sans capacité", () => {
    expect(toolNames({})).toEqual([]);
  });

  it('expose la messagerie en lecture seule quand l\'envoi n\'est pas activé', () => {
    const names = toolNames({ mail_enabled: true });
    expect(names).toContain('search_emails');
    expect(names).toContain('read_email');
    expect(names).not.toContain('send_email');
  });

  it("n'accorde jamais l'envoi de mail sans la lecture", () => {
    // Un réglage incohérent (envoi coché, lecture décochée) ne doit pas
    // ouvrir une capacité que l'interface présente comme dépendante.
    const caps = capabilitiesFromAgent({ ...NO_CAPS, mail_send_enabled: true });
    expect(caps.mailSend).toBe(false);
    expect(buildAgentTools(caps)).toEqual([]);
  });

  it('expose la cartographie et les pièces de projet séparément', () => {
    expect(toolNames({ geo_enabled: true })).toEqual(
      ['search_address', 'get_parcelle_cadastrale', 'get_zone_plu', 'get_risques', 'get_monuments_historiques']
    );
    expect(toolNames({ docs_read_enabled: true })).toEqual(['read_cctp', 'read_dpgf']);
  });

  it('refuse un appel dont la capacité est éteinte, même si le modèle le tente', async () => {
    const caps = capabilitiesFromAgent(NO_CAPS);
    const mail = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, { name: 'send_email', args: { to: 'a@b.fr' } });
    expect(String(mail.response.error)).toMatch(/messagerie/i);
    const geo = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, { name: 'get_zone_plu', args: {} });
    expect(String(geo.response.error)).toMatch(/cartographique/i);
    const docs = await executeAgentAction('http://127.0.0.1:1', 'Bearer x', caps, { name: 'read_cctp', args: {} });
    expect(String(docs.response.error)).toMatch(/CCTP/i);
  });

  it('donne un périmètre d\'écriture par défaut à chaque métier du catalogue', () => {
    expect(AGENT_DEFAULT_ACTION_SCOPES['secretaire']).toContain('meetings');
    expect(AGENT_DEFAULT_ACTION_SCOPES['comptable']).toContain('invoices');
    for (const scopes of Object.values(AGENT_DEFAULT_ACTION_SCOPES)) {
      expect(scopes.length).toBeGreaterThan(0);
    }
  });
});

// ── Alertes ────────────────────────────────────────────────────────────────
const NOW = new Date('2026-06-01T09:00:00Z');

function snapshot(over: Partial<TenantSnapshot> = {}): TenantSnapshot {
  return {
    tenantId: 't1', now: NOW,
    projects: [], phaseHistory: [], contrats: [], invoices: [], proposals: [],
    tenders: [], tasks: [], meetings: [], ordresDeService: [], reserves: [], notesHonoraires: [],
    ...over,
  };
}

function detect(code: string, snap: TenantSnapshot) {
  const settings = effectiveSettings([]).filter(s => s.code === code);
  return evaluateSnapshot(snap, settings).detected;
}

describe('règle « études engagées sans contrat signé »', () => {
  const project = { id: 'p1', name: 'Résidence Les Tilleuls', status: 'In Progress', start_date: '2026-01-10' };

  it('signale un projet entré en phase APS sans contrat signé', () => {
    const found = detect('etudes_sans_contrat', snapshot({
      projects: [project],
      phaseHistory: [{ project_id: 'p1', phase: 'APS', entered_at: '2026-03-01', exited_at: null }],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].dedupKey).toBe('etudes_sans_contrat:p1');
    expect(found[0].severity).toBe('critical');
    expect(found[0].message).toContain('Résidence Les Tilleuls');
  });

  it('ne signale rien si un contrat signé est rattaché au projet', () => {
    const found = detect('etudes_sans_contrat', snapshot({
      projects: [project],
      phaseHistory: [{ project_id: 'p1', phase: 'APS', entered_at: '2026-03-01', exited_at: null }],
      contrats: [{ id: 'c1', project_id: 'p1', status: 'Signé' }],
    }));
    expect(found).toEqual([]);
  });

  it('ne signale pas un contrat seulement envoyé comme suffisant', () => {
    const found = detect('etudes_sans_contrat', snapshot({
      projects: [project],
      phaseHistory: [{ project_id: 'p1', phase: 'APS', entered_at: '2026-03-01', exited_at: null }],
      contrats: [{ id: 'c1', project_id: 'p1', status: 'Envoyé' }],
    }));
    expect(found).toHaveLength(1);
  });

  it('respecte le délai de tolérance avant de déclencher', () => {
    // Études démarrées la veille : sous le seuil par défaut de 15 jours.
    const found = detect('etudes_sans_contrat', snapshot({
      projects: [project],
      phaseHistory: [{ project_id: 'p1', phase: 'APS', entered_at: '2026-05-31', exited_at: null }],
    }));
    expect(found).toEqual([]);
  });

  it('ignore un projet terminé', () => {
    const found = detect('etudes_sans_contrat', snapshot({
      projects: [{ ...project, status: 'Completed' }],
      phaseHistory: [{ project_id: 'p1', phase: 'APS', entered_at: '2026-01-01', exited_at: null }],
    }));
    expect(found).toEqual([]);
  });

  it("ne déclenche sur aucune date inventée quand rien n'est daté", () => {
    const found = detect('etudes_sans_contrat', snapshot({
      projects: [{ id: 'p2', name: 'Sans date', status: 'In Progress', start_date: null }],
    }));
    expect(found).toEqual([]);
  });
});

describe('autres règles d\'alerte', () => {
  it('signale une facture échue non payée, jamais un brouillon', () => {
    const found = detect('facture_echue', snapshot({
      invoices: [
        { id: 'i1', status: 'Sent', due_date: '2026-04-01', invoice_number: 'F-001', total_amount: 4800 },
        { id: 'i2', status: 'Draft', due_date: '2026-04-01', invoice_number: 'F-002' },
        { id: 'i3', status: 'Paid', due_date: '2026-04-01', invoice_number: 'F-003' },
      ],
    }));
    expect(found.map(f => f.targetId)).toEqual(['i1']);
  });

  it("groupe les réserves non levées par projet plutôt qu'une alerte par réserve", () => {
    const reserves = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`, project_id: 'p1', status: 'A faire', created_at: '2026-01-05', due_date: '2026-01-20',
    }));
    const found = detect('reserves_non_levees', snapshot({ projects: [{ id: 'p1', name: 'Chantier' }], reserves }));
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('12');
  });

  it("signale un appel d'offres dont la remise approche", () => {
    const found = detect('ao_echeance_proche', snapshot({
      tenders: [
        { id: 'ao1', title: 'Groupe scolaire', status: 'Draft', submission_deadline: '2026-06-05', archived: 0 },
        { id: 'ao2', title: 'Déjà remis', status: 'Submitted', submission_deadline: '2026-06-05', archived: 0 },
      ],
    }));
    expect(found.map(f => f.targetId)).toEqual(['ao1']);
  });

  it('referme implicitement une situation qui a disparu (plus rien détecté)', () => {
    const settings = effectiveSettings([]).filter(s => s.code === 'facture_echue');
    const { detected, evaluatedCodes } = evaluateSnapshot(snapshot({ invoices: [] }), settings);
    expect(detected).toEqual([]);
    // La règle a bien tourné : c'est ce qui autorise la refermeture des
    // alertes ouvertes de ce code (voir runAlertCycleForTenant).
    expect(evaluatedCodes).toContain('facture_echue');
  });

  it('ne fait rien tourner pour une règle désactivée', () => {
    const settings = effectiveSettings([
      { code: 'facture_echue', enabled: false, threshold_days: null, severity: 'critical', notify_email: false },
    ]).filter(s => s.code === 'facture_echue');
    const { detected, evaluatedCodes } = evaluateSnapshot(
      snapshot({ invoices: [{ id: 'i1', status: 'Sent', due_date: '2026-01-01' }] }),
      settings
    );
    expect(detected).toEqual([]);
    expect(evaluatedCodes).not.toContain('facture_echue');
  });

  it('applique le seuil réglé par le cabinet plutôt que celui par défaut', () => {
    const snap = snapshot({ proposals: [{ id: 'd1', title: 'Devis', status: 'Sent', created_at: '2026-05-20' }] });
    const rule = ALERT_RULES_BY_CODE.get('devis_sans_suite')!;
    expect(rule.evaluate(snap, 30)).toEqual([]); // 12 jours < 30
    expect(rule.evaluate(snap, 10)).toHaveLength(1);
  });
});

// ── Planification ──────────────────────────────────────────────────────────
describe('calcul de la prochaine exécution', () => {
  it('passe au lendemain quand l\'heure du jour est déjà passée', () => {
    const next = computeNextRun({ frequency: 'daily', hour_utc: 6, weekday: null, day_of_month: null }, new Date('2026-06-01T09:00:00Z'));
    expect(next.toISOString()).toBe('2026-06-02T06:00:00.000Z');
  });

  it('reste le jour même si l\'heure est encore à venir', () => {
    const next = computeNextRun({ frequency: 'daily', hour_utc: 18, weekday: null, day_of_month: null }, new Date('2026-06-01T09:00:00Z'));
    expect(next.toISOString()).toBe('2026-06-01T18:00:00.000Z');
  });

  it('vise le bon jour de la semaine', () => {
    // 2026-06-01 est un lundi ; le prochain vendredi (5) est le 5 juin.
    const next = computeNextRun({ frequency: 'weekly', hour_utc: 7, weekday: 5, day_of_month: null }, new Date('2026-06-01T09:00:00Z'));
    expect(next.toISOString()).toBe('2026-06-05T07:00:00.000Z');
    expect(next.getUTCDay()).toBe(5);
  });

  it('bascule au mois suivant quand le jour du mois est dépassé', () => {
    const next = computeNextRun({ frequency: 'monthly', hour_utc: 6, weekday: null, day_of_month: 1 }, new Date('2026-06-01T09:00:00Z'));
    expect(next.toISOString()).toBe('2026-07-01T06:00:00.000Z');
  });

  it('ne renvoie jamais une échéance déjà passée', () => {
    const from = new Date('2026-06-01T09:00:00Z');
    for (const frequency of ['daily', 'weekly', 'monthly'] as const) {
      const next = computeNextRun({ frequency, hour_utc: 9, weekday: 1, day_of_month: 1 }, from);
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    }
  });
});

// ── Documents ──────────────────────────────────────────────────────────────
const AGENCY: AgencyIdentity = {
  name: 'Atelier Test', address: '23 Bd de l\'Europe', phone: '0600000000',
  email: 'contact@test.fr', siret: '000', vatNumber: 'FR00', ape: '', logo: null,
};

describe('documents produits par un agent', () => {
  it('reconnaît un titre, une puce et un tableau', () => {
    const lines = parseLines('# Titre\n- puce\n| A | B |\n|---|---|\n| 1 | 2 |\ntexte');
    expect(lines.map(l => l.kind)).toEqual(['h1', 'bullet', 'table', 'text']);
    const table = lines[2] as any;
    // La ligne de séparation markdown ne doit pas devenir une ligne de données.
    expect(table.cells).toEqual([['A', 'B'], ['1', '2']]);
  });

  it('produit un DOCX portant en-tête, pied de page et pagination', async () => {
    const artifact = await generateArtifact(
      { type: 'docx', filename: 'note', title: 'Note', content: '# Titre\n\ntexte' },
      AGENCY
    );
    expect(artifact.filename).toBe('note.docx');
    const zip = Buffer.from(artifact.data, 'base64').toString('latin1');
    expect(zip).toContain('word/header1.xml');
    expect(zip).toContain('word/footer1.xml');
  });

  it('remplace une extension incohérente au lieu de l\'empiler', async () => {
    const artifact = await generateArtifact({ type: 'pdf', filename: 'rapport.docx', content: 'texte' }, AGENCY);
    expect(artifact.filename).toBe('rapport.pdf');
    expect(artifact.mimeType).toBe('application/pdf');
  });

  it('génère un classeur pour chaque feuille demandée', async () => {
    const artifact = await generateArtifact(
      { type: 'excel', filename: 'suivi', sheets: [{ name: 'Lots', rows: [['Lot', 'Montant'], ['GO', 1000]] }] },
      AGENCY
    );
    expect(artifact.filename).toBe('suivi.xlsx');
    expect(Buffer.from(artifact.data, 'base64').length).toBeGreaterThan(0);
  });

  it('lit les dimensions d\'un PNG pour ne pas déformer le logo', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEklEQVR4nGP8//8/AzJgYkAFuPgAaHYDrDgOaJcAAAAASUVORK5CYII=',
      'base64'
    );
    expect(readImageSize(png)).toEqual({ format: 'png', width: 2, height: 1 });
    expect(readImageSize(Buffer.from('pas une image'))).toBeNull();
  });

  it('n\'imprime dans le pied de page que ce qui est renseigné', () => {
    expect(agencyFooterLine({ ...AGENCY, phone: '', email: '', vatNumber: '' }))
      .toBe("Atelier Test  ·  23 Bd de l'Europe  ·  SIRET 000");
  });
});

// ── Lecture CCTP / DPGF ────────────────────────────────────────────────────
describe('lecture du CCTP et du DPGF', () => {
  const cctp = {
    titre: 'CCTP', version: '1', statut: 'draft',
    lots: [{
      numero: '01', titre: 'Gros œuvre', description: '',
      chapitres: [{ numero: '1.1', titre: 'Fondations', articles: [{ numero: '1.1.1', designation: 'Semelles', description: 'Béton', unite: 'm3', normes: 'NF' }] }],
    }],
  };

  it('renvoie un sommaire tant qu\'aucun lot n\'est demandé', () => {
    const summary = summarizeCctp(cctp) as any;
    expect(summary.lots[0]).toMatchObject({ numero: '01', nb_articles: 1 });
    expect(summary.lot).toBeUndefined();
  });

  it('détaille le lot demandé, par numéro comme par titre', () => {
    expect((summarizeCctp(cctp, '01') as any).lot.chapitres[0].articles[0].designation).toBe('Semelles');
    expect((summarizeCctp(cctp, 'gros œuvre') as any).lot.numero).toBe('01');
  });

  it('signale un lot inexistant au lieu d\'en inventer un', () => {
    const summary = summarizeCctp(cctp, 'plomberie') as any;
    expect(summary.error).toContain('plomberie');
    expect(summary.lots_disponibles).toEqual(['01 Gros œuvre']);
  });

  it('remonte les totaux du DPGF dans le sommaire', () => {
    const summary = summarizeDpgf({ totalHT: 1000, TVA: 200, totalTTC: 1200, lots: [{ numero: '01', titre: 'GO', sousTotal: 1000, chapitres: [] }] }) as any;
    expect(summary).toMatchObject({ total_ht: 1000, total_ttc: 1200, nb_lots: 1 });
  });
});

describe('réponses cartographiques', () => {
  it('retire les géométries, qui coûtent des jetons sans rien apporter', () => {
    const cleaned = stripGeometry({
      features: [{ properties: { zone: 'UB' }, geometry: { type: 'Polygon', coordinates: [[[1, 2]]] } }],
    }) as any;
    expect(cleaned.features[0].properties.zone).toBe('UB');
    expect(cleaned.features[0].geometry).toBeUndefined();
  });

  it('plafonne le nombre d\'entités renvoyées', () => {
    const cleaned = stripGeometry(Array.from({ length: 50 }, (_, i) => ({ id: i }))) as any[];
    expect(cleaned).toHaveLength(10);
  });
});
