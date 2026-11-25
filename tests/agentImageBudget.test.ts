// Budget d'images d'une requête (Mistral : 8 au plus, sinon 400 code 3051).
// Incident de novembre 2026 : une conversation dont les pièces jointes des tours
// précédents restaient attachées (attached_document_ids) renvoyait chaque page
// de PDF scanné en image à CHAQUE message, jusqu'à dépasser la limite, y compris
// pour un message sans aucune pièce jointe.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { buildAgentContext } from '../packages/archioffice-agents/src/server/context';
import { createMistralProvider, MISTRAL_MAX_IMAGES } from '../packages/archioffice-agents/src/server/llm/mistral';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function seedImages(db: FakeSupabaseAdmin, ids: string[]) {
  db.seed('tenants', [{ id: 'tenant-1', name: 'AAZS' }]);
  db.seed('profiles', [{ id: 'user-1', name: 'Khaldoun' }]);
  db.seed('documents', ids.map(id => ({
    id, tenant_id: 'tenant-1', name: `${id}.png`,
    file_url: `https://fake.supabase.test/storage/v1/object/public/documents/${id}.png`,
  })));
  for (const id of ids) db.putObject('documents', `${id}.png`, PNG);
}

describe("buildAgentContext : budget d'images", () => {
  const previousOcr = process.env.AGENT_OCR_ENABLED;
  // Sans OCR, une image hors budget retombe sur un message « non lu » au lieu
  // de lancer Tesseract (qui irait chercher ses données de langue en ligne).
  beforeAll(() => { process.env.AGENT_OCR_ENABLED = 'false'; });
  afterAll(() => {
    if (previousOcr === undefined) delete process.env.AGENT_OCR_ENABLED;
    else process.env.AGENT_OCR_ENABLED = previousOcr;
  });

  it('garde toutes les images quand le fournisseur ne déclare aucune limite', async () => {
    const db = new FakeSupabaseAdmin();
    seedImages(db, ['a', 'b', 'c']);
    const ctx = await buildAgentContext(db, 'tenant-1', 'user-1', 'agent-1', [], ['a', 'b', 'c'], true);
    expect(ctx.documentImages).toHaveLength(3);
  });

  it('ne dépasse jamais maxImages et ne perd pas les documents en trop en silence', async () => {
    const db = new FakeSupabaseAdmin();
    seedImages(db, ['a', 'b', 'c']);
    const ctx = await buildAgentContext(db, 'tenant-1', 'user-1', 'agent-1', [], ['a', 'b', 'c'], true, false, false, 2);
    expect(ctx.documentImages).toHaveLength(2);
    // Le troisième document est signalé au modèle, jamais passé sous silence.
    const inVision = new Set(ctx.documentImages.map(i => i.id));
    const left = ['a', 'b', 'c'].filter(id => !inVision.has(id));
    expect(left).toHaveLength(1);
    expect(ctx.documentContents.some(d => d.id === left[0])).toBe(true);
  });

  it('ne renvoie en images que les documents autorisés (message courant)', async () => {
    const db = new FakeSupabaseAdmin();
    seedImages(db, ['ancien-1', 'ancien-2', 'courant']);
    const ctx = await buildAgentContext(
      db, 'tenant-1', 'user-1', 'agent-1', [], ['ancien-1', 'ancien-2', 'courant'],
      true, false, false, MISTRAL_MAX_IMAGES, ['courant'],
    );
    expect(ctx.documentImages.map(i => i.id)).toEqual(['courant']);
    // Les anciens ne sont pas ignorés : ils passent par le chemin texte.
    expect(ctx.documentContents.map(d => d.id).sort()).toEqual(['ancien-1', 'ancien-2']);
  });

  it("n'envoie aucune image quand la liste autorisée est vide (message sans pièce jointe)", async () => {
    const db = new FakeSupabaseAdmin();
    seedImages(db, ['ancien-1', 'ancien-2']);
    const ctx = await buildAgentContext(
      db, 'tenant-1', 'user-1', 'agent-1', [], ['ancien-1', 'ancien-2'],
      true, false, false, MISTRAL_MAX_IMAGES, [],
    );
    expect(ctx.documentImages).toHaveLength(0);
  });
});

describe("adaptateur Mistral : limite d'images", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const okResponse = () => new Response(
    JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

  it(`ne transmet jamais plus de ${MISTRAL_MAX_IMAGES} images et prévient le modèle`, async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const provider = createMistralProvider({ apiKey: 'test-key' });
    expect(provider.maxImages).toBe(MISTRAL_MAX_IMAGES);

    const images = Array.from({ length: 12 }, () => ({ data: PNG, mimeType: 'image/png' }));
    await provider.chat({ system: 's', messages: [{ role: 'user', content: 'puissance cumulée', images }] } as any);

    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    const content = body.messages.find((m: any) => m.role === 'user').content;
    expect(content.filter((c: any) => c.type === 'image_url')).toHaveLength(MISTRAL_MAX_IMAGES);
    const note = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    expect(note).toContain('4 image(s)');
  });

  it("n'ajoute aucune mention quand tout tient dans la limite", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const provider = createMistralProvider({ apiKey: 'test-key' });
    await provider.chat({ system: 's', messages: [{ role: 'user', content: 'x', images: [{ data: PNG, mimeType: 'image/png' }] }] } as any);

    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    const content = body.messages.find((m: any) => m.role === 'user').content;
    expect(content).toHaveLength(2); // texte + 1 image, pas de note
  });

  it('traduit le 400 « Total number of images » en message lisible, sans JSON brut', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '{"object":"error","message":"Total number of images exceeds the maximum allowed of 8.","type":"invalid_request_invalid_args","param":null,"code":"3051"}',
      { status: 400 },
    )));
    const provider = createMistralProvider({ apiKey: 'test-key' });
    await expect(provider.chat({ system: 's', messages: [{ role: 'user', content: 'x' }] } as any))
      .rejects.toThrow(/Nouvelle discussion/);
  });
});
