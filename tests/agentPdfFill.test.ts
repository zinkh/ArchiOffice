import { describe, it, expect, vi, afterEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { applyPdfValues, listPdfFields, executePdfFillTool } from '../packages/archioffice-agents/src/server/pdfFillTool';
import { buildAgentSystemPrompt } from '../packages/archioffice-agents/src/server/systemPrompts';
import { buildAgentTools } from '../packages/archioffice-agents/src/server/tools';
import { capabilitiesFromAgent } from '../packages/archioffice-agents/src/types';
import type { AgentContext, AgentRow } from '../packages/archioffice-agents/src/types';

// Formulaire fictif : un champ texte, une case, une liste, un choix unique, un champ en lecture seule.
async function buildForm(withFields = true): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 400]);
  if (withFields) {
    const form = pdf.getForm();
    form.createTextField('nom_client').addToPage(page, { x: 10, y: 350, width: 200, height: 20 });
    form.createCheckBox('accord').addToPage(page, { x: 10, y: 320, width: 15, height: 15 });
    const liste = form.createDropdown('nature');
    liste.addOptions(['Construction', 'Extension', 'Rénovation']);
    liste.addToPage(page, { x: 10, y: 290, width: 150, height: 20 });
    const radio = form.createRadioGroup('civilite');
    radio.addOptionToPage('Madame', page, { x: 10, y: 260, width: 15, height: 15 });
    radio.addOptionToPage('Monsieur', page, { x: 40, y: 260, width: 15, height: 15 });
    const lecture = form.createTextField('reference');
    lecture.setText('REF-1');
    lecture.enableReadOnly();
    lecture.addToPage(page, { x: 10, y: 230, width: 100, height: 20 });
  }
  return Buffer.from(await pdf.save());
}

describe('listPdfFields', () => {
  it('rend le nom, le type et les choix de chaque champ', async () => {
    const fields = await listPdfFields(await buildForm());
    const byName = Object.fromEntries(fields.map(f => [f.nom, f]));
    expect(byName.nom_client.type).toBe('texte');
    expect(byName.accord).toMatchObject({ type: 'case', valeur: false });
    expect(byName.nature).toMatchObject({ type: 'liste', options: ['Construction', 'Extension', 'Rénovation'] });
    expect(byName.civilite).toMatchObject({ type: 'choix_unique', options: ['Madame', 'Monsieur'] });
    expect(byName.reference.lecture_seule).toBe(true);
  });

  it('rend une liste vide pour un PDF à plat', async () => {
    expect(await listPdfFields(await buildForm(false))).toEqual([]);
  });
});

describe('applyPdfValues', () => {
  it('pose texte (accents compris), case, liste et choix unique, et se relit', async () => {
    const result = await applyPdfValues(await buildForm(), [
      { field: 'nom_client', value: 'SCI Les Tilleuls, rue Léon Blum' },
      { field: 'accord', value: 'oui' },
      { field: 'nature', value: 'rénovation' },
      { field: 'civilite', value: 'Madame' },
    ]);
    expect(result.applied).toBe(4);
    expect(result.notApplied).toEqual([]);
    const byName = Object.fromEntries((await listPdfFields(result.buffer)).map(f => [f.nom, f]));
    expect(byName.nom_client.valeur).toBe('SCI Les Tilleuls, rue Léon Blum');
    expect(byName.accord.valeur).toBe(true);
    expect(byName.nature.valeur).toBe('Rénovation');
    expect(byName.civilite.valeur).toBe('Madame');
  });

  it('rapporte un champ inexistant, en lecture seule ou un choix invalide au lieu de le taire', async () => {
    const result = await applyPdfValues(await buildForm(), [
      { field: 'nom_client', value: 'X' },
      { field: 'absent', value: 'x' },
      { field: 'reference', value: 'autre' },
      { field: 'nature', value: 'Démolition' },
    ]);
    expect(result.applied).toBe(1);
    expect(result.notApplied).toHaveLength(3);
    expect(result.notApplied.join(' ')).toMatch(/inexistant/);
    expect(result.notApplied.join(' ')).toMatch(/lecture seule/);
    expect(result.notApplied.join(' ')).toMatch(/pas un choix valide/);
  });
});

describe('executePdfFillTool', () => {
  afterEach(() => vi.unstubAllGlobals());
  const auth = { token: 'jeton-fictif' } as any;

  function mockServer(pdf: Buffer, deposits: { name?: string; project?: string }[], name = 'CERFA 13406.pdf') {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      const u = String(url);
      if (u.includes('/api/documents?id=')) {
        return new Response(JSON.stringify([{ id: 'pdf-1', name, file_url: 'ref://x', mime_type: 'application/pdf', size_bytes: pdf.length, project_id: 'p-26002' }]), { status: 200 });
      }
      if (u.includes('/api/storage/signed-url')) return new Response(JSON.stringify({ url: 'https://fichiers.example/f.pdf' }), { status: 200 });
      if (u === 'https://fichiers.example/f.pdf') return new Response(new Uint8Array(pdf), { status: 200 });
      if (u.endsWith('/api/documents') && init?.method === 'POST') {
        const form = init.body as FormData;
        deposits.push({ name: String(form.get('name')), project: String(form.get('resource_id')) });
        return new Response(JSON.stringify({ id: 'nouveau-pdf', size_bytes: 10, uploaded_at: '2026-11-26T10:00:00Z' }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));
  }

  it('inspect puis fill : un nouveau PDF est rangé sur l’affaire', async () => {
    const deposits: { name?: string; project?: string }[] = [];
    mockServer(await buildForm(), deposits);
    const inspect = await executePdfFillTool('http://local', auth, ['projects'], { action: 'inspect', document_id: 'pdf-1' });
    expect((inspect.response as any).nb_champs).toBe(5);
    const fill = await executePdfFillTool('http://local', auth, ['projects'], {
      action: 'fill', document_id: 'pdf-1', project_id: 'p-26002', values: [{ field: 'nom_client', value: 'SCI Les Tilleuls' }],
    });
    expect((fill.response as any).valeurs_appliquees).toBe(1);
    expect(deposits).toEqual([{ name: 'CERFA 13406 - rempli.pdf', project: 'p-26002' }]);
  });

  it('dit qu’un PDF à plat ne peut pas être rempli', async () => {
    mockServer(await buildForm(false), []);
    const result = await executePdfFillTool('http://local', auth, ['projects'], { action: 'inspect', document_id: 'pdf-1' });
    expect((result.response as any).error).toMatch(/aucun champ de formulaire/);
  });

  it('ne dépose rien sans le droit sur les opérations', async () => {
    const deposits: { name?: string }[] = [];
    mockServer(await buildForm(), deposits);
    const result = await executePdfFillTool('http://local', auth, [], { action: 'fill', document_id: 'pdf-1', project_id: 'p', values: [{ field: 'nom_client', value: 'x' }] });
    expect((result.response as any).error).toMatch(/pas activé/);
    expect(deposits).toHaveLength(0);
  });

  it('refuse un fichier qui n’est pas un PDF', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'pdf-1', name: 'modele.docx', mime_type: 'application/msword' }]), { status: 200 })));
    const result = await executePdfFillTool('http://local', auth, ['projects'], { action: 'inspect', document_id: 'pdf-1' });
    expect((result.response as any).error).toMatch(/pas un PDF/);
  });
});

// Incident : un agent au prompt entièrement réécrit répondait « je ne peux pas générer de fichier » parce
// que ni la génération de fichiers ni le remplissage de modèles n'étaient repris sous system_prompt_override.
describe('agent au prompt personnalisé', () => {
  const agent = (over: Partial<AgentRow> = {}): AgentRow => ({
    id: 'agent-sophie', tenant_id: 'tenant-1', slug: 'sophie', name: 'Sophie', role_title: 'Secrétaire Administrative',
    avatar_initials: 'SA', avatar_color: '#000', context_scopes: [], action_scopes: ['projects'],
    web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false, mail_attachments_enabled: false,
    geo_enabled: false, docs_read_enabled: true, docs_write_enabled: false, delegate_enabled: false, notify_users_enabled: false,
    web_search_enabled: false, knowledge_enabled: false, learning_enabled: false, is_active: true, is_system_template: false,
    ...over,
  });
  const ctx = (): AgentContext => ({
    tenantName: 'AAZS', currentDate: '26 novembre 2026', currentUserName: 'Khaldoun',
    projects: [], contacts: [], upcomingMeetings: [], recentDocuments: [], tasks: [],
    documentContents: [{ id: 'doc-42', name: 'Modèle Mandat.docx', content: 'MANDAT' }], documentImages: [], colleagues: [], teamMembers: [],
    firmKnowledge: { phaseBenchmarks: [], priceCatalog: [], projectCostHistory: [], cctpExcerpts: [] },
    knowledgeDocuments: [], learningNotes: [],
  });

  it('garde la génération de fichiers et le remplissage de modèles sous system_prompt_override', () => {
    const prompt = buildAgentSystemPrompt(agent({ system_prompt_override: 'Tu es un agent sur mesure.' } as Partial<AgentRow>), ctx());
    expect(prompt).toContain('Tu es un agent sur mesure.');
    expect(prompt).toContain('GÉNÉRATION DE FICHIERS (ARTIFACTS)');
    expect(prompt).toContain('fill_docx_template');
    expect(prompt).toContain('fill_pdf_form');
    expect(prompt).toContain('[document_id: doc-42]');
  });

  it('expose les outils de remplissage seulement avec la lecture des documents et le scope projects', () => {
    const names = (a: AgentRow) => buildAgentTools(capabilitiesFromAgent(a)).map(t => t.name);
    expect(names(agent())).toEqual(expect.arrayContaining(['fill_docx_template', 'fill_pdf_form']));
    expect(names(agent({ action_scopes: [] }))).not.toContain('fill_pdf_form');
    expect(names(agent({ docs_read_enabled: false }))).not.toContain('fill_docx_template');
  });
});
