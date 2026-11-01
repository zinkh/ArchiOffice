// Couvre les quatre pièces ajoutées par le lot « autonomie des agents » :
// le périmètre d'outils selon les capacités, les règles d'alerte métier
// (dont « études sans contrat signé »), le calcul de la prochaine exécution
// planifiée, et la mise en page des documents produits.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAgentTools, executeAgentAction, prepareRecord, describeAuthorizedResources } from '../packages/archioffice-agents/src/server/tools';
import { capabilitiesFromAgent, AGENT_DEFAULT_ACTION_SCOPES, AGENT_RESOURCES } from '../packages/archioffice-agents/src/types';
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
    expect(toolNames({ docs_read_enabled: true })).toEqual(['read_cctp', 'read_dpgf', 'read_bpu', 'list_documents', 'read_document', 'search_knowledge']);
  });

  it('refuse un appel dont la capacité est éteinte, même si le modèle le tente', async () => {
    const caps = capabilitiesFromAgent(NO_CAPS);
    const mail = await executeAgentAction('http://127.0.0.1:1', { authorization: 'Bearer x' }, caps, { name: 'send_email', args: { to: 'a@b.fr' } });
    expect(String(mail.response.error)).toMatch(/messagerie/i);
    const geo = await executeAgentAction('http://127.0.0.1:1', { authorization: 'Bearer x' }, caps, { name: 'get_zone_plu', args: {} });
    expect(String(geo.response.error)).toMatch(/cartographique/i);
    const docs = await executeAgentAction('http://127.0.0.1:1', { authorization: 'Bearer x' }, caps, { name: 'read_cctp', args: {} });
    expect(String(docs.response.error)).toMatch(/CCTP/i);
  });

  it('donne un périmètre d\'écriture par défaut à la plupart des métiers du catalogue', () => {
    expect(AGENT_DEFAULT_ACTION_SCOPES['secretaire']).toContain('meetings');
    expect(AGENT_DEFAULT_ACTION_SCOPES['comptable']).toContain('invoices');
    // Quatre métiers d'ingénierie n'avaient que la ressource 'specifications'
    // (l'ancienne ressource CCTP, retirée du système — voir CLAUDE.md) comme
    // défaut : leur périmètre est désormais vide plutôt qu'un remplacement
    // improvisé, à régler au cas par cas depuis /agents/:id/edit.
    const emptyByDesign = ['ingenieur-thermique', 'ingenieur-structure', 'ingenieur-fluides', 'acousticien'];
    for (const [metier, scopes] of Object.entries(AGENT_DEFAULT_ACTION_SCOPES)) {
      if (emptyByDesign.includes(metier)) {
        expect(scopes.length).toBe(0);
      } else {
        expect(scopes.length).toBeGreaterThan(0);
      }
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
    qualifications: [], consultations: [], marches: [], documents: [],
    ...over,
  };
}

function detect(code: string, snap: TenantSnapshot) {
  const settings = effectiveSettings([]).filter(s => s.code === code);
  return evaluateSnapshot(snap, settings).detected;
}

describe('règles des accords-cadres', () => {
  const projet = { id: 'p1', name: 'Entretien bâtiments', status: 'In Progress' };
  const ac = (extra: Record<string, unknown> = {}) => ({
    id: 'ac1', project_id: 'p1', type_marche: 'accord_cadre', entreprise_nom: 'Dupont SARL', lot_numero: '02',
    statut_signature: 'signe', statut: 'en_cours', montant_maxi_ht: 1000, montant_mini_ht: null, date_fin_accord_cadre: null, ...extra,
  });
  const sub = (id: string, montant: number, extra: Record<string, unknown> = {}) => ({
    id, project_id: 'p1', type_marche: 'subsequent', parent_marche_id: 'ac1', montant_ht: montant, statut: 'en_cours', ...extra,
  });

  describe('plafond', () => {
    it('reste silencieux sous 80 % du maximum', () => {
      expect(detect('accord_cadre_plafond', snapshot({ projects: [projet], marches: [ac(), sub('s1', 790)] }))).toHaveLength(0);
    });

    it('signale à 80 % avec le reste disponible', () => {
      const found = detect('accord_cadre_plafond', snapshot({ projects: [projet], marches: [ac(), sub('s1', 800)] }));
      expect(found).toHaveLength(1);
      expect(found[0].dedupKey).toBe('accord_cadre_plafond:ac1:proche');
      expect(found[0].message).toContain('200,00 €');
      expect(found[0].targetId).toBe('p1');
    });

    it('cumule les subséquents de tous les titulaires contre le plafond de la tête, en une seule alerte', () => {
      const membre = ac({ id: 'ac2', accord_cadre_groupe_id: 'ac1', entreprise_nom: 'Martin SAS', montant_maxi_ht: null, statut_signature: 'signe' });
      const found = detect('accord_cadre_plafond', snapshot({
        projects: [projet],
        marches: [ac(), membre, sub('s1', 500), sub('s2', 350, { parent_marche_id: 'ac2' })],
      }));
      expect(found).toHaveLength(1);
      expect(found[0].dedupKey).toBe('accord_cadre_plafond:ac1:proche');
      expect(found[0].message).toContain('Dupont SARL / Martin SAS');
      expect(found[0].message).toContain('150,00 €');
    });

    it('change de clé quand le statut change, pour refermer l’ancienne alerte', () => {
      const atteint = detect('accord_cadre_plafond', snapshot({ projects: [projet], marches: [ac(), sub('s1', 1000)] }));
      expect(atteint[0].dedupKey).toBe('accord_cadre_plafond:ac1:atteint');
      expect(atteint[0].message).toContain('avenant');
      const depasse = detect('accord_cadre_plafond', snapshot({ projects: [projet], marches: [ac(), sub('s1', 1200)] }));
      expect(depasse[0].dedupKey).toBe('accord_cadre_plafond:ac1:depasse');
    });

    it('ignore un résilié, un accord-cadre non signé, sans maximum ou d’une affaire terminée', () => {
      const pleins = [sub('s1', 950)];
      expect(detect('accord_cadre_plafond', snapshot({ projects: [projet], marches: [ac(), sub('s1', 950, { statut: 'resilie' })] }))).toHaveLength(0);
      expect(detect('accord_cadre_plafond', snapshot({ projects: [projet], marches: [ac({ statut_signature: 'a_signer' }), ...pleins] }))).toHaveLength(0);
      expect(detect('accord_cadre_plafond', snapshot({ projects: [projet], marches: [ac({ montant_maxi_ht: null }), ...pleins] }))).toHaveLength(0);
      expect(detect('accord_cadre_plafond', snapshot({ projects: [{ ...projet, status: 'Completed' }], marches: [ac(), ...pleins] }))).toHaveLength(0);
      expect(detect('accord_cadre_plafond', snapshot({ projects: [projet], marches: [ac({ statut: 'resilie' }), ...pleins] }))).toHaveLength(0);
    });

    it('ne mélange pas les subséquents de deux accords-cadres', () => {
      const autre = ac({ id: 'ac2', lot_numero: '03' });
      const found = detect('accord_cadre_plafond', snapshot({
        projects: [projet], marches: [ac(), autre, sub('s1', 900), { ...sub('s2', 100), parent_marche_id: 'ac2' }],
      }));
      expect(found.map(f => f.dedupKey)).toEqual(['accord_cadre_plafond:ac1:proche']);
    });
  });

  describe('échéance', () => {
    // NOW = 2026-06-01
    const fin = (date: string, extra: Record<string, unknown> = {}) => ac({ date_fin_accord_cadre: date, ...extra });

    it('signale une fin proche quand il reste du crédit à engager', () => {
      const found = detect('accord_cadre_echeance', snapshot({ projects: [projet], marches: [fin('2026-07-15'), sub('s1', 100)] }));
      expect(found).toHaveLength(1);
      expect(found[0].dedupKey).toBe('accord_cadre_echeance:ac1');
      expect(found[0].message).toContain('prend fin dans 44 jours');
      expect(found[0].message).toContain('900,00 €');
    });

    it('signale le minimum non atteint, même une fois la fin passée', () => {
      const proche = detect('accord_cadre_echeance', snapshot({ projects: [projet], marches: [fin('2026-07-15', { montant_mini_ht: 500 }), sub('s1', 100)] }));
      expect(proche[0].message).toContain('minimum de 500,00 €');
      expect(proche[0].message).toContain('400,00 €');
      const passe = detect('accord_cadre_echeance', snapshot({ projects: [projet], marches: [fin('2026-05-01', { montant_mini_ht: 500 }), sub('s1', 100)] }));
      expect(passe).toHaveLength(1);
      expect(passe[0].message).toContain('échu depuis 31 jours');
    });

    it('se tait quand il n’y a plus d’enjeu ou que la fin est lointaine', () => {
      // Plafond épuisé et minimum atteint : rien à engager.
      expect(detect('accord_cadre_echeance', snapshot({ projects: [projet], marches: [fin('2026-07-15', { montant_mini_ht: 500 }), sub('s1', 1000)] }))).toHaveLength(0);
      // Échu, minimum atteint.
      expect(detect('accord_cadre_echeance', snapshot({ projects: [projet], marches: [fin('2026-05-01', { montant_mini_ht: 100 }), sub('s1', 400)] }))).toHaveLength(0);
      // Fin à plus de 90 jours, ou échue depuis plus de 90 jours.
      expect(detect('accord_cadre_echeance', snapshot({ projects: [projet], marches: [fin('2027-01-01')] }))).toHaveLength(0);
      expect(detect('accord_cadre_echeance', snapshot({ projects: [projet], marches: [fin('2026-01-01', { montant_mini_ht: 500 })] }))).toHaveLength(0);
      // Sans date de fin ou non signé.
      expect(detect('accord_cadre_echeance', snapshot({ projects: [projet], marches: [ac()] }))).toHaveLength(0);
      expect(detect('accord_cadre_echeance', snapshot({ projects: [projet], marches: [fin('2026-07-15', { statut_signature: 'a_signer' })] }))).toHaveLength(0);
    });

    it('respecte le délai réglé par le cabinet', () => {
      const settings = effectiveSettings([{ code: 'accord_cadre_echeance', enabled: true, threshold_days: 30, severity: 'warning', notify_email: false }])
        .filter(s => s.code === 'accord_cadre_echeance');
      const marches = [fin('2026-07-15')];
      expect(evaluateSnapshot(snapshot({ projects: [projet], marches }), settings).detected).toHaveLength(0);
      expect(detect('accord_cadre_echeance', snapshot({ projects: [projet], marches }))).toHaveLength(1);
    });
  });
});

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

describe('règle « ouverture de chantier sans DOC »', () => {
  const projet = { id: 'p1', name: 'Villa Martin', status: 'In Progress' };
  const visa = (extra: Record<string, unknown> = {}) => ({ project_id: 'p1', phase: 'VISA', entered_at: '2026-05-01T00:00:00Z', exited_at: null, ...extra });
  const run = (over: Partial<TenantSnapshot>) => detect('doc_ouverture_chantier_manquante', snapshot({ projects: [projet], ...over }));

  it('signale une affaire en VISA depuis plus de 14 jours sans DOC', () => {
    const found = run({ phaseHistory: [visa()] });
    expect(found).toHaveLength(1);
    expect(found[0].dedupKey).toBe('doc_ouverture_chantier_manquante:p1');
    expect(found[0].message).toContain('CERFA 13407');
  });
  it('attend la fin du délai, ignore les autres phases et les affaires terminées', () => {
    expect(run({ phaseHistory: [visa({ entered_at: '2026-05-25T00:00:00Z' })] })).toEqual([]);
    expect(run({ phaseHistory: [visa({ phase: 'ACT' })] })).toEqual([]);
    expect(run({ phaseHistory: [visa({ phase: 'AOR' })] })).toEqual([]);
    expect(run({ projects: [{ ...projet, status: 'Completed' }], phaseHistory: [visa()] })).toEqual([]);
  });
  it('se tait quand un document désigne la DOC, mais pas pour un simple « doc.pdf » ni un document périmé', () => {
    const doc = (name: string, extra: Record<string, unknown> = {}) => ({ id: 'd1', project_id: 'p1', name, ...extra });
    expect(run({ phaseHistory: [visa()], documents: [doc('Déclaration d’ouverture de chantier.pdf')] })).toEqual([]);
    expect(run({ phaseHistory: [visa()], documents: [doc('CERFA 13407 signé.pdf')] })).toEqual([]);
    expect(run({ phaseHistory: [visa()], documents: [doc('doc.pdf')] })).toHaveLength(1);
    expect(run({ phaseHistory: [visa()], documents: [doc('Ouverture de chantier.pdf', { doc_statut: 'perime' })] })).toHaveLength(1);
    expect(run({ phaseHistory: [visa()], documents: [{ ...doc('Ouverture de chantier.pdf'), project_id: 'autre' }] })).toHaveLength(1);
  });
  it('se tait quand le contrôle de phase a été traité ou le passage forcé', () => {
    const audit = (controls: unknown[], forced?: unknown) => visa({ phase: 'VISA', control_audit: { controls, ...(forced ? { forced } : {}) } });
    const control = (answer: Record<string, unknown>) => ({ rule: { id: 'doc-ouverture-chantier' }, answer });
    expect(run({ phaseHistory: [visa({ phase: 'ACT', exited_at: '2026-05-01T00:00:00Z' }), audit([control({ status: 'done', justification: '' })])] })).toEqual([]);
    expect(run({ phaseHistory: [audit([control({ status: 'not_required', justification: 'Travaux sans autorisation' })])] })).toEqual([]);
    expect(run({ phaseHistory: [audit([control({ status: 'not_required', justification: '  ' })])] })).toHaveLength(1);
    expect(run({ phaseHistory: [audit([control({ status: 'unchecked', justification: '' })], { rule_ids: ['doc-ouverture-chantier'] })] })).toEqual([]);
    expect(run({ phaseHistory: [audit([control({ status: 'unchecked', justification: '' })], { rule_ids: ['autre'] })] })).toHaveLength(1);
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

  it('classeur : identité sur la première page, une ligne agence | document ensuite', async () => {
    const artifact = await generateArtifact(
      { type: 'excel', filename: 'suivi', title: 'Suivi des lots', sheets: [{ name: 'Lots', rows: [['Lot', 'Montant'], ['GO', 1000]] }] },
      AGENCY
    );
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(artifact.data, 'base64') as any);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe(AGENCY.name);
    expect(ws.getCell('A5').value).toBe('Lot');
    expect(ws.getCell('B6').value).toBe(1000);
    expect(ws.headerFooter.differentFirst).toBe(true);
    expect(ws.headerFooter.firstHeader ?? '').toBe('');
    expect(ws.headerFooter.oddHeader).toContain(AGENCY.name);
    expect(ws.headerFooter.oddHeader).toContain('Suivi des lots');
    expect(ws.headerFooter.firstFooter).toContain('P&P|&N');
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
  afterEach(() => { vi.unstubAllGlobals(); });

  // Le CCTP n'est plus un document séparé : summarizeCctp lit le même arbre
  // que le DPGF (lots > chapitres > lignes), et en tire le texte porté par
  // `cctpDescription` — voir CCTPEditor.tsx et CLAUDE.md.
  const cctp = {
    titre: 'CCTP', version: '1', statut: 'draft',
    lots: [{
      numero: '01', titre: 'Gros œuvre', cctpDescription: '',
      chapitres: [{
        numero: '1.1', titre: 'Fondations', cctpDescription: '',
        lignes: [{ numero: '1.1.1', designation: 'Semelles', unite: 'm3', cctpDescription: 'Béton NF', type: 'ouvrage' }],
      }],
    }],
  };

  it('renvoie un sommaire tant qu\'aucun lot n\'est demandé', () => {
    const summary = summarizeCctp(cctp) as any;
    expect(summary.lots[0]).toMatchObject({ numero: '01', nb_articles: 1 });
    expect(summary.lot).toBeUndefined();
  });

  it('détaille le lot demandé, par numéro comme par titre', () => {
    expect((summarizeCctp(cctp, '01') as any).lot.chapitres[0].articles[0].contenu).toBe('Béton NF');
    expect((summarizeCctp(cctp, 'gros œuvre') as any).lot.numero).toBe('01');
  });

  it('read_cctp lit la route /dpgf, pas un endpoint /cctp séparé qui n\'existe plus', async () => {
    // Régression : read_cctp appelait auparavant GET /api/projects/:id/cctp,
    // une route morte adossée à une table (`cctps`) qu'aucun éditeur en
    // production n'écrivait plus — l'outil rapportait donc systématiquement
    // qu'aucun CCTP n'existait, quel que soit le projet. Le CCTP vit
    // désormais sur le même document que le DPGF (voir CCTPEditor.tsx).
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => (String(url).includes('/dpgf') ? cctp : null),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const caps = capabilitiesFromAgent({ docs_read_enabled: true });

    const result = await executeAgentAction('http://127.0.0.1:1', { authorization: 'Bearer x' }, caps, {
      name: 'read_cctp', args: { project_id: 'proj-1' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/projects/proj-1/dpgf');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/cctp');
    expect((result.response as any).lots[0].numero).toBe('01');
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

// ── Écriture : ce que le modèle propose vs ce que l'API accepte ─────────────
// Rejoue le scénario réel qui avait mis un agent en boucle : un devis envoyé
// avec un schéma inventé de bout en bout (validity_period, phases, fees,
// payment_terms) et un statut « draft » en minuscules. L'API répondait
// « Validation error » sans nommer le champ, le message était réduit à cette
// seule phrase avant d'atteindre le modèle, et celui-ci repartait sur des
// variantes au hasard jusqu'à renvoyer l'utilisateur vers une saisie manuelle.
describe('préparation des écritures', () => {
  const proposals = AGENT_RESOURCES.find(r => r.key === 'proposals')!;
  const tasks = AGENT_RESOURCES.find(r => r.key === 'tasks')!;

  const INVENTED = {
    client_id: '9e0b4805-abb8-4fe3-a7c1-9d0aa5bfe816',
    title: 'Surélévation du showroom – Woippy',
    description: "Mission de maîtrise d'œuvre pour la surélévation du showroom.",
    status: 'draft',
    validity_period: 30,
    phases: [{ name: 'ESQ', duration: 0 }],
    fees: 5000,
    payment_terms: '30% à la signature',
    start_date: '2026-10-01',
    notes: 'Projet Algeco existant à Woippy.',
  };

  it('écarte les champs inventés et les nomme, au lieu de les envoyer à l\'API', () => {
    const prepared = prepareRecord(proposals, INVENTED);
    expect(prepared.ignoredFields.sort()).toEqual(['fees', 'payment_terms', 'phases', 'start_date', 'validity_period']);
    expect(Object.keys(prepared.data).sort()).toEqual(['amount', 'client_id', 'description', 'notes', 'status', 'title']);
  });

  it('garde le terrain, le programme et le maître d\'ouvrage d\'une proposition', () => {
    const prepared = prepareRecord(proposals, {
      title: 'Cabinet médical, Dieulouard',
      programme: '3 à 4 box de consultation, deux salles d\'attente',
      adresse: '30, allée Docteur Mansuy',
      cp_ville_terrain: '54380 Dieulouard',
      parcelle: 'AA 618',
      surface_terrain: '418',
      client_email: 'moa@example.fr',
    });
    expect(prepared.ignoredFields).toEqual([]);
    expect(prepared.data).toMatchObject({
      projet_detail: '3 à 4 box de consultation, deux salles d\'attente',
      adresse_terrain: '30, allée Docteur Mansuy',
      cp_ville_terrain: '54380 Dieulouard',
      ref_cadastrale: 'AA 618',
      surface_parcelle: '418',
      email_client: 'moa@example.fr',
    });
  });

  it('ramène un statut à sa casse canonique plutôt que de le faire rejeter', () => {
    const prepared = prepareRecord(proposals, INVENTED);
    expect(prepared.data.status).toBe('Draft');
    expect(prepared.normalizedValues.status).toBe('Draft');
  });

  it('pose les valeurs par défaut manquantes et les rapporte', () => {
    const prepared = prepareRecord(proposals, { title: 'Devis' });
    expect(prepared.data).toMatchObject({ title: 'Devis', status: 'Draft', amount: 0 });
    expect(prepared.appliedDefaults).toEqual({ status: 'Draft', amount: 0 });
    expect(prepared.missingRequired).toEqual([]);
  });

  it('date les tâches par défaut, faute de quoi l\'insertion échouerait en base', () => {
    const now = new Date('2026-06-01T09:00:00Z');
    const prepared = prepareRecord(tasks, { title: 'Contacter le BET structure' }, { applyDefaults: true, now });
    expect(prepared.data.start_date).toBe('2026-06-01');
    expect(prepared.data.end_date).toBe('2026-06-15');
    expect(prepared.data.status).toBe('todo');
    expect(prepared.appliedDefaults).toHaveProperty('end_date', '2026-06-15');
  });

  it('ne pose aucun défaut sur une mise à jour, qui ne touche que ce qui est fourni', () => {
    const prepared = prepareRecord(proposals, { description: 'Nouvelle description' }, { applyDefaults: false });
    expect(prepared.data).toEqual({ description: 'Nouvelle description' });
    expect(prepared.appliedDefaults).toEqual({});
    expect(prepared.missingRequired).toEqual([]);
  });

  it('nomme les champs obligatoires manquants au lieu de laisser échouer l\'API', () => {
    const prepared = prepareRecord(proposals, { description: 'Sans titre' });
    expect(prepared.missingRequired).toEqual(['title']);
  });

  it('laisse passer une valeur hors vocabulaire plutôt que de la corriger au hasard', () => {
    // « En cours » n'est pas un statut de devis : le corriger d'office
    // choisirait à la place de l'utilisateur. L'API le rejettera, et son
    // message nommera cette fois le champ.
    const prepared = prepareRecord(proposals, { title: 'X', status: 'En cours' });
    expect(prepared.data.status).toBe('En cours');
    expect(prepared.normalizedValues).toEqual({});
  });

  // Incident réel (16/09/2026) : un agent a deviné 'nom' puis 'title' pour le
  // nom d'un projet (le vrai champ est 'name'), a échoué deux fois de suite,
  // et a abandonné en s'excusant plutôt que de retenter avec le bon champ.
  // Un synonyme plausible du "nom" de la ressource ou du "client" ne doit
  // plus se perdre : il se redirige vers le champ réel au lieu d'être écarté.
  it('redirige un synonyme plausible du champ identité vers le vrai champ au lieu de le perdre', () => {
    const projects = AGENT_RESOURCES.find(r => r.key === 'projects')!;
    const prepared = prepareRecord(projects, { nom: 'Villa Martin', client: 'M. Martin' });
    expect(prepared.data.name).toBe('Villa Martin');
    expect(prepared.aliasedFields).toEqual({ nom: 'name' });
    expect(prepared.ignoredFields).toEqual([]);
    expect(prepared.missingRequired).toEqual([]);
  });

  it("redirige un synonyme du champ client, sans écraser un champ 'name' déjà correct", () => {
    const projects = AGENT_RESOURCES.find(r => r.key === 'projects')!;
    const prepared = prepareRecord(projects, { name: 'Villa Martin', maitre_ouvrage: 'M. Martin' });
    expect(prepared.data).toMatchObject({ name: 'Villa Martin', client: 'M. Martin' });
    expect(prepared.aliasedFields).toEqual({ maitre_ouvrage: 'client' });
  });

  it("ne redirige jamais vers un champ déjà fourni sous son vrai nom", () => {
    const projects = AGENT_RESOURCES.find(r => r.key === 'projects')!;
    // 'name' est déjà donné correctement : un 'titre' redondant ne doit pas
    // l'écraser, il est simplement écarté comme un champ inconnu ordinaire.
    const prepared = prepareRecord(projects, { name: 'Villa Martin', titre: 'Autre intitulé', client: 'M. Martin' });
    expect(prepared.data.name).toBe('Villa Martin');
    expect(prepared.ignoredFields).toEqual(['titre']);
    expect(prepared.aliasedFields).toEqual({});
  });

  it('déclare un vocabulaire cohérent avec les champs connus de chaque ressource', () => {
    for (const resource of AGENT_RESOURCES) {
      expect(resource.knownFields.length).toBeGreaterThan(0);
      for (const field of resource.required || []) {
        expect(resource.knownFields).toContain(field);
      }
      for (const field of Object.keys(resource.enums || {})) {
        expect(resource.knownFields).toContain(field);
      }
      for (const field of Object.keys(resource.defaults || {})) {
        expect(resource.knownFields).toContain(field);
      }
    }
  });
});

// ── Bibliothèque d'ouvrages (articles_type) ─────────────────────────────────
// Le 7 septembre 2026, un agent a créé 19 CCTP sans projet en réponse à des
// demandes qui visaient en réalité la Bibliothèque d'ouvrages : les agents
// n'avaient aucun outil d'écriture sur articles_type, seule la ressource
// 'specifications' (l'ancien CCTP) ressemblait de loin à une « bibliothèque ».
// Cette ressource a depuis été retirée du système entier (route, table et
// entrée AGENT_RESOURCES — voir CLAUDE.md) ; ces tests protègent ce qui
// reste : articles_type comme ressource à part entière, jamais confondue
// avec le CCTP réel (qui vit désormais dans l'arbre du DPGF).
describe("Bibliothèque d'ouvrages (articles_type)", () => {
  const articlesType = AGENT_RESOURCES.find(r => r.key === 'articles_type')!;

  it("pose 'saisie' comme provenance par défaut d'un article de bibliothèque", () => {
    const prepared = prepareRecord(articlesType, { designation: 'Chape fluide anhydrite' });
    expect(prepared.data.origine).toBe('saisie');
    expect(prepared.missingRequired).toEqual([]);
  });

  it('nomme la désignation manquante plutôt que de laisser échouer /api/price-library', () => {
    const prepared = prepareRecord(articlesType, { prix_unitaire: 12.5 });
    expect(prepared.missingRequired).toEqual(['designation']);
  });

  it("étiquette articles_type Bibliothèque d'ouvrages, jamais CCTP", () => {
    // La confusion venait justement de là : le seul outil disponible était
    // étiqueté "CCTP", ce qui a poussé un agent à l'utiliser pour une demande
    // de bibliothèque. Un futur renommage de l'étiquette CCTP ne doit pas
    // recréer la même ambiguïté avec la bibliothèque.
    expect(articlesType.label).toBe("Bibliothèque d'ouvrages");
    expect(articlesType.label).not.toContain('CCTP');
  });

  it("n'expose plus aucune ressource 'specifications' — retirée du système", () => {
    expect(AGENT_RESOURCES.find(r => r.key === 'specifications')).toBeUndefined();
  });

  it("expose create/update/delete/search sur articles_type à un agent qui y est autorisé", () => {
    const caps = capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['articles_type'] });
    const names = buildAgentTools(caps).map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['create_record', 'update_record', 'delete_record', 'search_records']));

    const schema = describeAuthorizedResources(['articles_type']);
    expect(schema).toContain("Bibliothèque d'ouvrages");
    expect(schema).toContain('resource: "articles_type"');
  });

  it("accorde la Bibliothèque d'ouvrages à l'économiste par défaut", () => {
    expect(AGENT_DEFAULT_ACTION_SCOPES.economiste).toContain('articles_type');
  });
});

describe('remontée des erreurs d\'écriture au modèle', () => {
  const caps = capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['proposals'] });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("transmet le détail de la validation, pas seulement « Validation error »", async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      // Vérification anti-doublon (GET de la liste) puis POST refusé.
      void url;
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Validation error',
          details: [{ path: 'status', message: "Invalid enum value. Expected 'Draft' | 'Sent' | 'Accepted' | 'Rejected'" }],
        }),
      } as any;
    }));

    const result = await executeAgentAction('http://127.0.0.1:1', { authorization: 'Bearer x' }, caps, {
      name: 'create_record',
      args: { resource: 'proposals', data: { title: 'Surélévation', status: 'En cours' }, confirm: true },
    });

    expect(result.response.error).toBe('Validation error');
    expect(result.response.details).toEqual([
      "status : Invalid enum value. Expected 'Draft' | 'Sent' | 'Accepted' | 'Rejected'",
    ]);
    expect(result.response.champs_acceptes).toContain('title');
    expect(result.response.valeurs_attendues).toMatchObject({ status: ['Draft', 'Sent', 'Accepted', 'Rejected'] });
  });

  it('rapporte les champs écartés et les défauts posés après une écriture réussie', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => ({
      ok: true,
      status: init?.method === 'POST' ? 201 : 200,
      // Le GET de liste (anti-doublon et relecture) renvoie un tableau,
      // le POST renvoie l'enregistrement créé.
      json: async () => (init?.method === 'POST' ? { id: 'prop-1' } : []),
    } as any)));

    const result = await executeAgentAction('http://127.0.0.1:1', { authorization: 'Bearer x' }, caps, {
      name: 'create_record',
      args: {
        resource: 'proposals',
        data: { title: 'Surélévation du showroom', fees: 5000, payment_terms: '30% à la signature' },
      },
    });

    expect(result.response.success).toBe(true);
    expect(result.response.champs_ignores).toEqual(['fees', 'payment_terms']);
    expect(result.response.valeurs_par_defaut).toMatchObject({ status: 'Draft' });
  });
});

describe('comptes-rendus de chantier DET', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('propose une action dédiée uniquement aux agents autorisés à accéder aux opérations', () => {
    const projectCaps = capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['projects'] });
    const meetingCaps = capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['meetings'] });
    expect(buildAgentTools(projectCaps).map(t => t.name)).toContain('create_site_report');
    expect(buildAgentTools(meetingCaps).map(t => t.name)).not.toContain('create_site_report');
    expect(AGENT_RESOURCES.find(r => r.key === 'meetings')?.fields).not.toContain('est LA réunion de chantier');
  });

  it('crée le brouillon par la route DET du projet et renvoie son lien', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: any) => ({
      ok: true,
      status: init?.method === 'POST' ? 201 : 200,
      json: async () => init?.method === 'POST' ? { id: 'cr-1', report_number: 2 } : [],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const caps = capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['projects'] });
    const result = await executeAgentAction('http://localhost', { authorization: 'Bearer x' }, caps, {
      name: 'create_site_report', args: { project_id: 'proj-1', date: '2026-09-23' },
    });
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost/api/projects/proj-1/reports');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ date: '2026-09-23' });
    expect(result.response).toMatchObject({ success: true, id: 'cr-1', report_number: 2, statut: 'brouillon' });
    expect(result.response.record_url).toContain('/projects/proj-1?tab=DET');
  });

  it('ne crée pas de deuxième CR à la même date', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ id: 'cr-1', date: '2026-09-23', report_number: 1 }] }));
    vi.stubGlobal('fetch', fetchMock);
    const caps = capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['projects'] });
    const result = await executeAgentAction('http://localhost', { authorization: 'Bearer x' }, caps, {
      name: 'create_site_report', args: { project_id: 'proj-1', date: '2026-09-23' },
    });
    expect(result.response.needs_confirmation).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ajoute un point au brouillon DET sans créer de tâche', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => ({
      ok: true,
      status: init?.method === 'POST' ? 200 : 200,
      json: async () => init?.method === 'POST' ? { id: 'obs-1', number: 3 }
        : url.endsWith('/reports') ? [{ id: 'cr-1', report_number: 1, statut: 'brouillon' }] : [],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const caps = capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['projects'] });
    expect(buildAgentTools(caps).map(t => t.name)).toContain('add_site_report_observation');
    const result = await executeAgentAction('http://localhost', { authorization: 'Bearer x' }, caps, {
      name: 'add_site_report_observation', args: { project_id: 'vip-tc', texte: 'HCT : brancher la base vie' },
    });
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      'http://localhost/api/projects/vip-tc/reports',
      'http://localhost/api/reports/cr-1/observations',
      'http://localhost/api/projects/vip-tc/observations',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ texte: 'HCT : brancher la base vie', created_report_id: 'cr-1' });
    expect(result.response).toMatchObject({ success: true, id: 'obs-1', report_id: 'cr-1' });
  });

  it('demande quel brouillon modifier quand plusieurs existent', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [
      { id: 'cr-1', statut: 'brouillon' }, { id: 'cr-2', statut: 'brouillon' },
    ] }));
    vi.stubGlobal('fetch', fetchMock);
    const caps = capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['projects'] });
    const result = await executeAgentAction('http://localhost', { authorization: 'Bearer x' }, caps, {
      name: 'add_site_report_observation', args: { project_id: 'vip-tc', texte: 'HCT : brancher la base vie' },
    });
    expect(result.response.error).toContain('Plusieurs brouillons');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('import de notes dans un CR de chantier', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const caps = () => capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['projects'] });
  const auth = { authorization: 'Bearer x' };
  const report = { id: 'cr-1', report_number: 4, date: '2026-10-08', statut: 'brouillon', meetingNotes: 'Déjà saisi', decisions: [{ auteur: '', texte: 'Ancienne', tag: 'planning' }], stakeholders: [{ name: 'A', role: 'MOA' }], companies: [] };

  const stub = (extra: Record<string, any> = {}) => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      const method = init?.method || 'GET';
      let json: any = [];
      if (url.endsWith('/projects/p1/reports')) json = extra.reports ?? [report];
      else if (url.endsWith('/lots')) json = [{ id: 'lot-2', lot_number: '02', lot_title: 'PLATRERIE', contact_name: 'Dupont' }];
      else if (method === 'POST') json = { id: 'new' };
      else if (method === 'PUT') json = { ok: true };
      return { ok: true, status: 200, json: async () => json };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const run = (args: any) => executeAgentAction('http://localhost', auth, caps(), { name: 'import_site_report_notes', args }) as Promise<{ response: any }>;

  it("n'est proposé qu'aux agents ayant accès aux opérations, et exposé au MCP", async () => {
    expect(buildAgentTools(caps()).map(t => t.name)).toContain('import_site_report_notes');
    expect(buildAgentTools(capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['meetings'] })).map(t => t.name)).not.toContain('import_site_report_notes');
    const { MCP_TOOL_NAMES } = await import('../packages/archioffice-agents/src/server/mcp/tools');
    expect(MCP_TOOL_NAMES).toContain('import_site_report_notes');
  });

  it('range rubriques, observations, décisions et notes dans le brouillon', async () => {
    const fetchMock = stub();
    const result = await run({
      project_id: 'p1',
      rubriques: [{ category: 'Planning', text: 'Retard de 2 jours', due_date: '2026-10-15' }],
      observations: [{ texte: 'Reprendre les cloisons', lot: '02', type: 'reserve', urgence: 'urgent' }],
      decisions: [{ texte: 'Décalage de la livraison', tag: 'planning' }],
      meeting_notes: 'RAS côté sécurité',
    });
    expect(result.response).toMatchObject({ success: true, ajoutes: { rubriques: 1, observations: 1, decisions: 1, meeting_notes: true } });
    const calls = fetchMock.mock.calls.map(c => [c[1]?.method || 'GET', c[0]]);
    expect(calls).toContainEqual(['POST', 'http://localhost/api/reports/cr-1/notes']);
    expect(calls).toContainEqual(['POST', 'http://localhost/api/projects/p1/observations']);
    const obs = JSON.parse(fetchMock.mock.calls.find(c => c[0].endsWith('/p1/observations') && c[1]?.method === 'POST')![1].body);
    expect(obs).toMatchObject({ lot_id: 'lot-2', type: 'reserve', urgence: 'urgent', created_report_id: 'cr-1' });
    const put = JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')![1].body);
    expect(put.meetingNotes).toBe('Déjà saisi\n\nRAS côté sécurité');
    expect(put.decisions.map((d: any) => d.texte)).toEqual(['Ancienne', 'Décalage de la livraison']);
    expect(put.stakeholders).toEqual(report.stakeholders);
  });

  it('ignore les doublons et ne réécrit pas le CR quand rien ne change', async () => {
    const fetchMock = stub();
    const result = await run({ project_id: 'p1', decisions: [{ texte: 'ancienne' }], meeting_notes: 'déjà saisi' });
    expect(result.response.ajoutes).toMatchObject({ decisions: 0, meeting_notes: false });
    expect(result.response.doublons_ignores).toHaveLength(2);
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PUT')).toBe(false);
  });

  it('signale un lot introuvable sans bloquer le reste', async () => {
    stub();
    const result = await run({ project_id: 'p1', observations: [{ texte: 'Point A', lot: '99' }, { texte: 'Point B' }] });
    expect(result.response.ajoutes.observations).toBe(1);
    expect(result.response.non_importes[0].raison).toContain('introuvable');
    expect(result.response.lots_possibles).toHaveLength(1);
  });

  it('refuse un CR diffusé ou plusieurs brouillons sans écrire', async () => {
    const fetchMock = stub({ reports: [{ ...report, statut: 'diffuse' }] });
    expect((await run({ project_id: 'p1', report_id: 'cr-1', meeting_notes: 'x' })).response.error).toContain('diffusé');
    stub({ reports: [report, { ...report, id: 'cr-2' }] });
    expect((await run({ project_id: 'p1', meeting_notes: 'x' })).response.error).toContain('Plusieurs brouillons');
    expect(fetchMock.mock.calls.every(c => (c[1]?.method || 'GET') === 'GET')).toBe(true);
  });

  it("refuse un appel sans aucune note", async () => {
    stub();
    expect((await run({ project_id: 'p1' })).response.error).toContain('Aucune note');
  });
});

describe('alertes : qualification d\'une entreprise consultée', () => {
  const projet = { id: 'p1', name: 'Villa Martin', status: 'In Progress' };
  const consultation = (entreprises: any[]) => [{ project_id: 'p1', consultation: { entreprises } }];
  const qualif = (p: any = {}) => ({ id: 'q', contact_id: 'c1', organisme: 'qualibat', reference: '2111', date_fin: '2026-05-01', ...p });

  it('signale une entreprise dont la meilleure qualification est expirée', () => {
    const found = detect('qualification_expiree', snapshot({
      projects: [projet],
      consultations: consultation([{ contact_id: 'c1', nom: 'Dupont SARL' }]),
      qualifications: [qualif()],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].dedupKey).toBe('qualification_expiree:p1:c1');
    expect(found[0].title).toContain('expirée');
  });

  it('signale une qualification qui expire dans le délai réglé', () => {
    const found = detect('qualification_expiree', snapshot({
      projects: [projet],
      consultations: consultation([{ contact_id: 'c1', nom: 'Dupont SARL' }]),
      qualifications: [qualif({ date_fin: '2026-06-20' })], // 19 jours après NOW
    }));
    expect(found).toHaveLength(1);
    expect(found[0].title).toContain('bientôt');
  });

  it('ne dit rien si une autre qualification est en cours de validité', () => {
    const found = detect('qualification_expiree', snapshot({
      projects: [projet],
      consultations: consultation([{ contact_id: 'c1', nom: 'Dupont SARL' }]),
      qualifications: [qualif(), qualif({ id: 'q2', reference: '3112', date_fin: '2028-01-01' })],
    }));
    expect(found).toHaveLength(0);
  });

  it('ne dit rien pour une qualification valide, absente ou sans date', () => {
    const base = { projects: [projet], consultations: consultation([{ contact_id: 'c1', nom: 'D' }]) };
    expect(detect('qualification_expiree', snapshot({ ...base, qualifications: [qualif({ date_fin: '2030-01-01' })] }))).toHaveLength(0);
    expect(detect('qualification_expiree', snapshot({ ...base, qualifications: [] }))).toHaveLength(0);
    expect(detect('qualification_expiree', snapshot({ ...base, qualifications: [qualif({ date_fin: null })] }))).toHaveLength(0);
  });

  it('ignore une entreprise qui ne répond pas, sans fiche, ou une affaire terminée', () => {
    const q = [qualif()];
    expect(detect('qualification_expiree', snapshot({ projects: [projet], qualifications: q, consultations: consultation([{ contact_id: 'c1', ne_repond_pas: true }]) }))).toHaveLength(0);
    expect(detect('qualification_expiree', snapshot({ projects: [projet], qualifications: q, consultations: consultation([{ nom: 'Sans fiche' }]) }))).toHaveLength(0);
    expect(detect('qualification_expiree', snapshot({ projects: [{ ...projet, status: 'Completed' }], qualifications: q, consultations: consultation([{ contact_id: 'c1' }]) }))).toHaveLength(0);
  });
});

describe('intervenants d\'une opération (manage_project_stakeholders)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const caps = () => capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['projects'] });
  const auth = { authorization: 'Bearer x' };
  const contacts = [
    { id: 'c-bio', company_name: 'BIOTOPE', first_name: '', last_name: '' },
    { id: 'c-th', company_name: '', first_name: 'Thomas', last_name: 'ROUSSEL' },
    { id: 'c-d1', company_name: 'DUPONT', first_name: '', last_name: '' },
    { id: 'c-d2', company_name: 'DUPONT', first_name: '', last_name: '' },
  ];
  const stub = (existing: any[] = []) => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      const method = init?.method || 'GET';
      let json: any = [];
      if (url.endsWith('/projects/p1/full')) json = { id: 'p1', stakeholders_list: existing };
      else if (url.endsWith('/api/contacts')) json = contacts;
      else if (method === 'PUT') json = { stakeholders: JSON.parse(init.body).stakeholders };
      return { ok: true, status: 200, json: async () => json };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const run = (args: any) => executeAgentAction('http://localhost', auth, caps(), { name: 'manage_project_stakeholders', args }) as Promise<{ response: any }>;
  const put = (m: ReturnType<typeof stub>) => JSON.parse(m.mock.calls.find(c => c[1]?.method === 'PUT')![1].body).stakeholders;

  it("n'est proposé qu'aux agents ayant accès aux opérations, et exposé au MCP", async () => {
    expect(buildAgentTools(caps()).map(t => t.name)).toContain('manage_project_stakeholders');
    expect(buildAgentTools(capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['contacts'] })).map(t => t.name)).not.toContain('manage_project_stakeholders');
    const { MCP_TOOL_NAMES } = await import('../packages/archioffice-agents/src/server/mcp/tools');
    expect(MCP_TOOL_NAMES).toContain('manage_project_stakeholders');
  });

  it('ajoute des intervenants sans toucher aux existants et lie les contacts', async () => {
    const existing = [{ id: 's-1', name: 'MOA', role: 'Maître d\'ouvrage', contact_id: 'c-d1' }];
    const m = stub(existing);
    const result = await run({ project_id: 'p1', action: 'add', intervenants: [
      { contact_id: 'c-bio', role: 'Écologue' }, { nom: 'Thomas ROUSSEL', role: 'Écologue' },
    ] });
    expect(result.response).toMatchObject({ success: true });
    expect(result.response.ajoutes).toHaveLength(2);
    const sent = put(m);
    expect(sent[0]).toMatchObject({ id: 's-1', role: 'Maître d\'ouvrage', contact_id: 'c-d1' });
    expect(sent.slice(1)).toMatchObject([{ name: 'BIOTOPE', contact_id: 'c-bio', role: 'Écologue' }, { name: 'Thomas ROUSSEL', contact_id: 'c-th', role: 'Écologue' }]);
  });

  it('ignore un doublon (même contact et même rôle) sans écrire', async () => {
    const m = stub([{ id: 's-1', name: 'BIOTOPE', role: 'Écologue', contact_id: 'c-bio' }]);
    const result = await run({ project_id: 'p1', action: 'add', intervenants: [{ contact_id: 'c-bio', role: 'écologue' }] });
    expect(result.response.deja_presents).toHaveLength(1);
    expect(m.mock.calls.some(c => c[1]?.method === 'PUT')).toBe(false);
  });

  it('refuse un rôle absent, un contact inconnu et un nom ambigu', async () => {
    const m = stub();
    const result = await run({ project_id: 'p1', action: 'add', intervenants: [
      { contact_id: 'c-bio' }, { contact_id: 'inconnu', role: 'BET' }, { nom: 'DUPONT', role: 'BET' },
    ] });
    expect(result.response.error).toContain("Aucun intervenant");
    expect(result.response.non_traites.map((n: any) => n.raison)).toEqual([
      'rôle requis', expect.stringContaining('introuvable'), expect.stringContaining('plusieurs contacts'),
    ]);
    expect(m.mock.calls.some(c => c[1]?.method === 'PUT')).toBe(false);
  });

  it('retire en deux temps : confirmation puis écriture', async () => {
    const existing = [
      { id: 's-1', name: 'BIOTOPE', role: 'Écologue', contact_id: 'c-bio' },
      { id: 's-2', name: 'Thomas ROUSSEL', role: 'Écologue', contact_id: 'c-th' },
    ];
    const m = stub(existing);
    const first = await run({ project_id: 'p1', action: 'remove', intervenants: [{ contact_id: 'c-bio' }] });
    expect(first.response.needs_confirmation).toBe(true);
    expect(m.mock.calls.some(c => c[1]?.method === 'PUT')).toBe(false);
    const second = await run({ project_id: 'p1', action: 'remove', intervenants: [{ contact_id: 'c-bio' }], confirm: true });
    expect(second.response).toMatchObject({ success: true });
    expect(put(m).map((s: any) => s.id)).toEqual(['s-2']);
  });

  it('liste les intervenants actuels', async () => {
    stub([{ id: 's-1', name: 'BIOTOPE', role: 'Écologue', contact_id: 'c-bio' }]);
    const result = await run({ project_id: 'p1', action: 'list' });
    expect(result.response.intervenants).toEqual([{ id: 's-1', nom: 'BIOTOPE', role: 'Écologue', contact_id: 'c-bio' }]);
  });
});

// ── Marqueur de rédaction vu par les agents ──────────────────────────────────
describe('marqueur de rédaction dans read_cctp et read_dpgf', () => {
  const doc = {
    titre: 'CCTP', version: '1', statut: 'draft',
    lots: [{
      numero: '01', titre: 'Gros œuvre', sousTotal: 0, marqueur: { statut: 'incomplet', par: 'Sophie', le: '2026-11-01T08:00:00Z', note: 'Lot à relire' },
      chapitres: [{
        numero: '1', titre: 'Fondations', marqueur: { statut: 'en_cours', par: 'Marc' },
        lignes: [
          { numero: '1.1', designation: 'Semelles', unite: 'm3', quantite: 1, prixUnitaire: 10, prixTotal: 10, cctpDescription: 'Béton NF', marqueur: { statut: 'en_cours', par: 'Sophie', le: '2026-11-01T09:00:00Z', note: 'Reprise du texte' } },
          { numero: '1.2', designation: 'Dallage', unite: 'm2', quantite: 1, prixUnitaire: 10, prixTotal: 10, cctpDescription: 'Dallage BA' },
          { numero: '1.3', designation: 'Groupe', unite: '', quantite: 0, prixUnitaire: 0, prixTotal: 0, marqueur: { statut: 'incomplet' },
            children: [{ numero: '1.3.1', designation: 'Treillis', unite: 'm2', quantite: 1, prixUnitaire: 1, prixTotal: 1, marqueur: { statut: 'inconnu' } }] },
        ],
      }],
    }],
  };

  it('le sommaire compte les éléments à finir et ceux en cours d’édition, par lot', () => {
    const lot = (summarizeCctp(doc) as any).lots[0];
    expect(lot).toMatchObject({ nb_incomplets: 2, nb_en_cours_d_edition: 2 });
    expect((summarizeCctp(doc) as any).note).toMatch(/n'y touche pas/);
  });

  it('un lot sans marqueur n’ajoute aucun compteur', () => {
    const propre = { ...doc, lots: [{ numero: '02', titre: 'Charpente', chapitres: [] }] };
    expect((summarizeCctp(propre) as any).lots[0].nb_incomplets).toBeUndefined();
  });

  it('le détail d’un lot rapporte le marqueur de chaque niveau, avec la consigne pour « en_cours »', () => {
    const lot = (summarizeCctp(doc, '01') as any).lot;
    expect(lot.marqueur).toMatchObject({ statut: 'incomplet', par: 'Sophie', depuis: '2026-11-01', note: 'Lot à relire' });
    expect(lot.marqueur.consigne).toBeUndefined();
    expect(lot.chapitres[0].marqueur.consigne).toMatch(/ne le modifie pas/);
    const articles = lot.chapitres[0].articles;
    expect(articles[0].marqueur).toMatchObject({ statut: 'en_cours', par: 'Sophie', note: 'Reprise du texte' });
    expect(articles[1].marqueur).toBeUndefined();
  });

  it('un article à sous-articles marqué est rapporté ; un marqueur illisible est ignoré', () => {
    const articles = (summarizeCctp(doc, '01') as any).lot.chapitres[0].articles;
    const groupe = articles.find((a: any) => a.designation === 'Groupe');
    expect(groupe.marqueur.statut).toBe('incomplet');
    const treillis = articles.find((a: any) => a.designation === 'Treillis');
    expect(treillis.marqueur).toBeUndefined();
  });

  it('read_dpgf rapporte aussi le marqueur des lignes', () => {
    const lignes = (summarizeDpgf(doc, '01') as any).lot.lignes;
    expect(lignes.find((l: any) => l.numero === '1.1').marqueur.statut).toBe('en_cours');
    expect(lignes.find((l: any) => l.numero === '1.2').marqueur).toBeUndefined();
  });
});
