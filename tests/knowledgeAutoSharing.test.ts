// Partage automatique : server/knowledge/autoContribution.ts.
// Base simulée, Mistral simulé (tests/fakeMistral.ts) et relecture IA injectée : aucun appel réseau.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { FAKE_MISTRAL_LIBRARY, installFakeMistral } from './fakeMistral';
import {
  analyseSource, AUTO_SHARE_DAILY_CAP, enqueueAutoContribution, MAX_ANALYSIS_ATTEMPTS, MIN_SHARED_CHARS,
  processQueuedContributions, publishApprovedContributions, runAutoSharingCycle, splitParagraphs,
  STALE_ANALYZING_MS,
} from '../server/knowledge/autoContribution';
import { buildKnownMatchers } from '../server/knowledge/anonymize';
import type { AiReviewer } from '../server/knowledge/aiReview';

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';
const MINUTE = 60_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const OWN_URL = 'https://x.supabase.co/storage/v1/object/public/documents/tenant-a/p1/cctp.pdf';

const TECH_PARAGRAPH = (n: number) =>
  `Article ${n}. Bardage vertical en mélèze naturel, section 21x120 mm, entraxe 600 mm, fixation par vis inox A2 ` +
  `à raison de deux vis par point d'appui. Pare-pluie HPV de classe Sd inférieure à 0,1 m, recouvrement 100 mm ` +
  `conformément au NF DTU 41.2 et aux prescriptions du fabricant.`;

const cleanReviewer: AiReviewer = async () => ({ findings: [], risk: 'aucun' });

let db: FakeSupabaseAdmin;

function seedPrefs(overrides: Record<string, unknown> = {}, tenant = TENANT) {
  db.seed('knowledge_sharing_preferences', [{
    tenant_id: tenant, opted_in: true, auto_share_enabled: true, auto_share_categories: ['CCTP'], ...overrides,
  }]);
}
function seedDocument(overrides: Record<string, unknown> = {}) {
  const doc = { id: crypto.randomUUID(), tenant_id: TENANT, name: 'cctp.pdf', file_url: OWN_URL, size_bytes: 1000, doc_type: 'CCTP', ...overrides };
  db.seed('documents', [doc]);
  return doc as any;
}
function seedQueued(documentId: string, overrides: Record<string, unknown> = {}) {
  const row = {
    id: crypto.randomUUID(), tenant_id: TENANT, document_id: documentId, status: 'queued', origin: 'auto',
    sanitized_text: '', warnings: [], withheld: [], analysis: null, created_at: iso(5 * MINUTE), updated_at: iso(5 * MINUTE),
    ...overrides,
  };
  db.seed('knowledge_contributions', [row]);
  return row as any;
}
const contribution = (id: string) => db.getTable('knowledge_contributions').find(r => r.id === id)!;
const extractWith = (text: string | null) => async () => ({ text });

beforeEach(() => {
  db = new FakeSupabaseAdmin();
  process.env.MISTRAL_API_KEY = 'test-key';
  process.env.MISTRAL_KNOWLEDGE_LIBRARY_ID = FAKE_MISTRAL_LIBRARY;
  process.env.MISTRAL_KNOWLEDGE_PUBLISH_ENABLED = 'true';
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ['MISTRAL_API_KEY', 'MISTRAL_KNOWLEDGE_LIBRARY_ID', 'MISTRAL_KNOWLEDGE_PUBLISH_ENABLED']) delete process.env[key];
});

describe('splitParagraphs', () => {
  it('découpe par lignes vides et scinde les blocs trop longs', () => {
    expect(splitParagraphs('A\n\nB\r\n\r\n\nC')).toEqual(['A', 'B', 'C']);
    const long = Array.from({ length: 60 }, (_, i) => `ligne ${i} ` + 'x'.repeat(40)).join('\n');
    const parts = splitParagraphs(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(p => p.length <= 1200)).toBe(true);
  });
});

describe('analyseSource', () => {
  it('garde les paragraphes propres et retient ceux qui portent un nom propre', async () => {
    const source = [TECH_PARAGRAPH(1), 'Le client Sophie Lambert valide les teintes au chantier de Nancy.', TECH_PARAGRAPH(2)].join('\n\n');

    const result = await analyseSource(source, [], cleanReviewer);

    expect(result.text).toContain('entraxe 600 mm');
    expect(result.text).not.toContain('Lambert');
    expect(result.withheld).toHaveLength(1);
    expect(result.withheld[0].reasons.join(' ')).toMatch(/Sophie Lambert|Nancy/);
    expect(result.report).toMatchObject({ paragraphs: 3, kept: 2, withheld: 1 });
  });

  it('masque les valeurs connues du cabinet avant la relecture IA, qui ne les voit donc jamais', async () => {
    const seen: string[] = [];
    const reviewer: AiReviewer = async chunk => { seen.push(chunk); return { findings: [], risk: 'aucun' }; };
    const known = buildKnownMatchers([{ value: 'Durand Bâtiment', category: 'ENTREPRISE' }]);

    await analyseSource(TECH_PARAGRAPH(1) + '\n\nPose par Durand Bâtiment selon ' + TECH_PARAGRAPH(2).slice(10), known, reviewer);

    expect(seen.join(' ')).not.toContain('Durand Bâtiment');
    expect(seen.join(' ')).toContain('[ENTREPRISE]');
  });

  it('applique les passages signalés par l’IA, et compte ce qui a été masqué', async () => {
    const reviewer: AiReviewer = async () => ({ findings: [{ text: 'Kéolis Lorraine', category: 'ENTREPRISE' }], risk: 'faible' });
    const result = await analyseSource(TECH_PARAGRAPH(1).replace('Article 1.', 'Article 1 pour Kéolis Lorraine.'), [], reviewer);

    expect(result.text).not.toContain('Kéolis');
    expect(result.text).toContain('[ENTREPRISE]');
    expect(result.report.ai_findings).toBe(1);
    expect(result.report.masked.ENTREPRISE).toBeGreaterThanOrEqual(1);
  });

  it('retient tout un lot quand l’IA soupçonne d’autres identifiants sans pouvoir les désigner', async () => {
    const reviewer: AiReviewer = async () => ({ findings: [], risk: 'eleve' });
    const result = await analyseSource([TECH_PARAGRAPH(1), TECH_PARAGRAPH(2)].join('\n\n'), [], reviewer);

    expect(result.text).toBe('');
    expect(result.withheld).toHaveLength(2);
    expect(result.withheld[0].reasons[0]).toMatch(/relecture IA/);
  });

  it('échoue si la relecture IA échoue : jamais de texte retenu comme propre sans relecture', async () => {
    const reviewer: AiReviewer = async () => { throw new Error('Mistral injoignable'); };
    await expect(analyseSource(TECH_PARAGRAPH(1), [], reviewer)).rejects.toThrow(/injoignable/);
  });

  it('écarte un paragraphe presque entièrement masqué', async () => {
    const result = await analyseSource('Contact : Sophie Lambert\n\n' + TECH_PARAGRAPH(1), [], cleanReviewer);
    expect(result.report.dropped_low_content).toBeGreaterThanOrEqual(1);
    expect(result.text).not.toContain('MENTION');
  });
});

describe('enqueueAutoContribution', () => {
  it('met en file un document du type choisi', async () => {
    seedPrefs();
    const doc = seedDocument();
    expect(await enqueueAutoContribution(db as any, TENANT, doc)).toBe(true);
    expect(db.getTable('knowledge_contributions')[0]).toMatchObject({ document_id: doc.id, status: 'queued', origin: 'auto' });
  });

  it.each([
    ['partage automatique désactivé', { auto_share_enabled: false }, {}],
    ['autorisation de contribution absente', { opted_in: false }, {}],
    ['type de document non choisi', {}, { doc_type: 'DPGF' }],
    ['document sans type', {}, { doc_type: null }],
    ['contrat (jamais partageable)', { auto_share_categories: ['Contrat'] }, { doc_type: 'Contrat' }],
    ['fichier hors du stockage du cabinet', {}, { file_url: 'https://exemple.test/x.pdf' }],
    ['fichier trop volumineux', {}, { size_bytes: 20 * 1024 * 1024 }],
  ])('ne met rien en file : %s', async (_label, prefs, docOverrides) => {
    seedPrefs(prefs);
    expect(await enqueueAutoContribution(db as any, TENANT, seedDocument(docOverrides))).toBe(false);
    expect(db.getTable('knowledge_contributions')).toHaveLength(0);
  });

  it('ne touche pas une contribution déjà existante pour ce document', async () => {
    seedPrefs();
    const doc = seedDocument();
    db.seed('knowledge_contributions', [{ id: 'c-existing', tenant_id: TENANT, document_id: doc.id, status: 'reviewed', origin: 'auto', sanitized_text: 'x' }]);
    await enqueueAutoContribution(db as any, TENANT, doc);
    expect(db.getTable('knowledge_contributions')).toHaveLength(1);
    expect(db.getTable('knowledge_contributions')[0].status).toBe('reviewed');
  });
});

describe('processQueuedContributions', () => {
  const source = [TECH_PARAGRAPH(1), TECH_PARAGRAPH(2), 'Pose par Durand Bâtiment, client Sophie Lambert, à Nancy.'].join('\n\n');

  it('analyse, masque avec les valeurs du cabinet et marque l’extrait relu automatiquement', async () => {
    seedPrefs();
    const doc = seedDocument();
    const row = seedQueued(doc.id);
    db.seed('contacts', [{ id: 'c1', tenant_id: TENANT, name: 'Sophie Lambert', company: 'Durand Bâtiment' }]);

    const summary = await processQueuedContributions(db as any, { review: cleanReviewer, extract: extractWith(source) as any });

    expect(summary).toMatchObject({ claimed: 1, reviewed: 1 });
    const saved = contribution(row.id);
    expect(saved).toMatchObject({ status: 'reviewed', review_mode: 'auto' });
    expect(saved.sanitized_text).toContain('entraxe 600 mm');
    expect(saved.sanitized_text).not.toMatch(/Durand|Lambert|Nancy/);
    expect(saved.analysis).toMatchObject({ kept: 2, attempts: 1 });
    expect(saved.analysis.masked).toBeTruthy();
  });

  it('retient le document quand rien n’est partageable sans risque', async () => {
    seedPrefs();
    const row = seedQueued(seedDocument().id);
    await processQueuedContributions(db as any, {
      review: cleanReviewer, extract: extractWith('Le client Sophie Lambert à Nancy valide.') as any,
    });
    expect(contribution(row.id)).toMatchObject({ status: 'held', sanitized_text: '' });
    expect(contribution(row.id).analysis.reason).toMatch(/Rien de partageable/);
    expect(MIN_SHARED_CHARS).toBeGreaterThan(0);
  });

  it('retient un document sans texte exploitable', async () => {
    seedPrefs();
    const row = seedQueued(seedDocument().id);
    await processQueuedContributions(db as any, { review: cleanReviewer, extract: extractWith('   ') as any });
    expect(contribution(row.id)).toMatchObject({ status: 'held' });
    expect(contribution(row.id).analysis.reason).toMatch(/Aucun texte exploitable/);
  });

  it('retient si le partage automatique a été désactivé entre-temps, sans lire ni analyser', async () => {
    seedPrefs({ auto_share_enabled: false });
    const row = seedQueued(seedDocument().id);
    const review = vi.fn(cleanReviewer);
    await processQueuedContributions(db as any, { review, extract: extractWith(source) as any });
    expect(contribution(row.id).status).toBe('held');
    expect(review).not.toHaveBeenCalled();
  });

  it('retient si le type du document a été retiré du réglage', async () => {
    seedPrefs({ auto_share_categories: ['DPGF'] });
    const row = seedQueued(seedDocument().id);
    await processQueuedContributions(db as any, { review: cleanReviewer, extract: extractWith(source) as any });
    expect(contribution(row.id).status).toBe('held');
  });

  it('supprime la ligne si le document n’existe plus', async () => {
    seedPrefs();
    const row = seedQueued('document-supprime');
    await processQueuedContributions(db as any, { review: cleanReviewer, extract: extractWith(source) as any });
    expect(db.getTable('knowledge_contributions').some(c => c.id === row.id)).toBe(false);
  });

  it('remet en file après un échec de la relecture, puis retient après plusieurs échecs, sans rien envoyer', async () => {
    seedPrefs();
    const row = seedQueued(seedDocument().id);
    const failing: AiReviewer = async () => { throw new Error('Mistral 503'); };

    for (let attempt = 1; attempt < MAX_ANALYSIS_ATTEMPTS; attempt++) {
      await processQueuedContributions(db as any, { review: failing, extract: extractWith(source) as any });
      expect(contribution(row.id)).toMatchObject({ status: 'queued' });
      expect(contribution(row.id).analysis.attempts).toBe(attempt);
      contribution(row.id).updated_at = iso(5 * MINUTE);
    }
    await processQueuedContributions(db as any, { review: failing, extract: extractWith(source) as any });

    expect(contribution(row.id).status).toBe('held');
    expect(contribution(row.id).analysis.reason).toMatch(/Analyse impossible/);
    expect(contribution(row.id).sanitized_text).toBe('');
  });

  it('ne reprend pas une ligne mise en file à l’instant ni une ligne déjà prise en charge', async () => {
    seedPrefs();
    const fresh = seedQueued(seedDocument().id, { updated_at: iso(1000) });
    const taken = seedQueued(seedDocument().id, { status: 'analyzing', updated_at: iso(MINUTE) });
    const summary = await processQueuedContributions(db as any, { review: cleanReviewer, extract: extractWith(source) as any });
    expect(summary.claimed).toBe(0);
    expect(contribution(fresh.id).status).toBe('queued');
    expect(contribution(taken.id).status).toBe('analyzing');
  });

  it('libère une analyse restée bloquée, puis la reprend au tour suivant', async () => {
    seedPrefs();
    const stuck = seedQueued(seedDocument().id, { status: 'analyzing', updated_at: iso(STALE_ANALYZING_MS + MINUTE) });
    await processQueuedContributions(db as any, { review: cleanReviewer, extract: extractWith(source) as any });
    expect(contribution(stuck.id).status).toBe('queued');
  });

  it('ne traite que les contributions automatiques', async () => {
    seedPrefs();
    const manual = seedQueued(seedDocument().id, { origin: 'manual' });
    await processQueuedContributions(db as any, { review: cleanReviewer, extract: extractWith(source) as any });
    expect(contribution(manual.id).status).toBe('queued');
  });
});

describe('publishApprovedContributions', () => {
  function seedReviewed(tenant = TENANT, overrides: Record<string, unknown> = {}) {
    const row = {
      id: crypto.randomUUID(), tenant_id: tenant, document_id: crypto.randomUUID(), status: 'reviewed', origin: 'auto',
      review_mode: 'auto', sanitized_text: TECH_PARAGRAPH(1), warnings: [], withheld: [], created_at: iso(MINUTE), updated_at: iso(MINUTE),
      ...overrides,
    };
    db.seed('knowledge_contributions', [row]);
    return row as any;
  }

  it('publie un extrait relu automatiquement, sous un nom opaque', async () => {
    seedPrefs();
    const row = seedReviewed();
    const mistral = installFakeMistral();

    const summary = await publishApprovedContributions(db as any);

    expect(summary.published).toBe(1);
    expect(mistral.docs.map(d => d.name)).toEqual([`archioffice-${row.id}.txt`]);
    expect(db.getTable('knowledge_remote_documents')[0]).toMatchObject({ contribution_id: row.id, state: 'published' });
  });

  it('ne publie pas pour un cabinet dont le partage automatique est désactivé', async () => {
    seedPrefs({ auto_share_enabled: false });
    seedReviewed();
    const mistral = installFakeMistral();
    const summary = await publishApprovedContributions(db as any);
    expect(summary).toMatchObject({ published: 0, skipped: 1 });
    expect(mistral.calls).toHaveLength(0);
  });

  it('ne publie jamais deux fois le même extrait', async () => {
    seedPrefs();
    const row = seedReviewed();
    db.seed('knowledge_remote_documents', [{ id: 'r1', tenant_id: TENANT, contribution_id: row.id, state: 'published' }]);
    const mistral = installFakeMistral();
    await publishApprovedContributions(db as any);
    expect(mistral.calls.some(c => c.startsWith('POST'))).toBe(false);
  });

  it('respecte le plafond quotidien du cabinet', async () => {
    seedPrefs();
    for (let i = 0; i < AUTO_SHARE_DAILY_CAP; i++) {
      db.seed('knowledge_remote_documents', [{ id: `old-${i}`, tenant_id: TENANT, contribution_id: `x-${i}`, state: 'published', created_at: iso(MINUTE) }]);
    }
    seedReviewed();
    const mistral = installFakeMistral();
    const summary = await publishApprovedContributions(db as any);
    expect(summary).toMatchObject({ published: 0, skipped: 1 });
    expect(mistral.calls.some(c => c.startsWith('POST'))).toBe(false);
  });

  it('le plafond d’un cabinet ne bloque pas un autre', async () => {
    seedPrefs();
    seedPrefs({}, OTHER);
    for (let i = 0; i < AUTO_SHARE_DAILY_CAP; i++) {
      db.seed('knowledge_remote_documents', [{ id: `old-${i}`, tenant_id: OTHER, contribution_id: `x-${i}`, state: 'published', created_at: iso(MINUTE) }]);
    }
    seedReviewed(OTHER);
    seedReviewed(TENANT);
    installFakeMistral();
    const summary = await publishApprovedContributions(db as any);
    expect(summary.published).toBe(1);
  });

  it('retient un extrait que le contrôle final refuse, au lieu de le publier', async () => {
    seedPrefs();
    // Un numéro de téléphone resté dans le texte : le contrôle final le masquerait, donc le texte n'est pas stable.
    const row = seedReviewed(TENANT, { sanitized_text: 'Contact chantier 06 12 34 56 78 pour la pose.' });
    const mistral = installFakeMistral();
    const summary = await publishApprovedContributions(db as any);
    expect(summary.failed).toBe(1);
    expect(contribution(row.id).status).toBe('held');
    expect(mistral.calls.some(c => c.startsWith('POST'))).toBe(false);
  });
});

describe('runAutoSharingCycle', () => {
  it('ne fait rien, et n’envoie rien à Mistral, tant que la publication n’est pas autorisée', async () => {
    seedPrefs();
    const row = seedQueued(seedDocument().id);
    process.env.MISTRAL_KNOWLEDGE_PUBLISH_ENABLED = 'false';
    const review = vi.fn(cleanReviewer);
    const mistral = installFakeMistral();

    const result = await runAutoSharingCycle(db as any, { review, extract: extractWith(TECH_PARAGRAPH(1) + '\n\n' + TECH_PARAGRAPH(2)) as any });

    expect(result).toEqual({ skipped: true });
    expect(review).not.toHaveBeenCalled();
    expect(mistral.calls).toHaveLength(0);
    expect(contribution(row.id).status).toBe('queued');
  });

  it('ne fait rien sans bibliothèque configurée', async () => {
    seedPrefs();
    delete process.env.MISTRAL_KNOWLEDGE_LIBRARY_ID;
    const review = vi.fn(cleanReviewer);
    expect(await runAutoSharingCycle(db as any, { review })).toEqual({ skipped: true });
    expect(review).not.toHaveBeenCalled();
  });

  it('de la mise en file à l’envoi : seul le texte masqué part, jamais le document ni son nom', async () => {
    seedPrefs();
    const doc = seedDocument({ name: 'CCTP Villa Martin.pdf' });
    db.seed('contacts', [{ id: 'c1', tenant_id: TENANT, name: 'Sophie Lambert' }]);
    db.seed('projects', [{ id: 'p1', tenant_id: TENANT, name: 'Villa Martin' }]);
    await enqueueAutoContribution(db as any, TENANT, doc);
    db.getTable('knowledge_contributions')[0].updated_at = iso(5 * MINUTE);
    const mistral = installFakeMistral();
    const text = [TECH_PARAGRAPH(1), 'Villa Martin : client Sophie Lambert, rue des Lilas.', TECH_PARAGRAPH(2)].join('\n\n');

    const result = await runAutoSharingCycle(db as any, { review: cleanReviewer, extract: extractWith(text) as any });

    expect(result).toMatchObject({ skipped: false, analysed: { reviewed: 1 }, published: { published: 1 } });
    const sent = mistral.calls.filter(c => c.startsWith('POST'));
    expect(sent).toHaveLength(1);
    expect(mistral.docs).toHaveLength(1);
    expect(mistral.docs[0].name).toMatch(/^archioffice-[0-9a-f-]{36}\.txt$/);
    expect(mistral.docs[0].name).not.toContain('Martin');
    const stored = db.getTable('knowledge_contributions')[0].sanitized_text as string;
    expect(stored).toContain('entraxe 600 mm');
    expect(stored).not.toMatch(/Villa Martin|Lambert|Lilas/);
  });
});
