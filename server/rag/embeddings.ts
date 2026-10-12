// External semantic embeddings are strictly opt-in at the cabinet level.
// No provider calls for tenants that have not approved remote processing.
const DIMENSIONS = 1024;
const MAX_BATCH = 12;

export async function tenantAllowsRemoteEmbeddings(db: any, tenantId: string): Promise<boolean> {
  const { data, error } = await db.from('tenants')
    .select('rag_external_embeddings_enabled').eq('id', tenantId).maybeSingle();
  if (error) throw error;
  return data?.rag_external_embeddings_enabled === true;
}

export async function embedTexts(texts: string[], request: typeof fetch = fetch): Promise<number[][]> {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('Fournisseur d’embeddings non configuré.');
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const res = await request('https://api.mistral.ai/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistral-embed', input: batch }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error('Calcul des embeddings indisponible (HTTP ' + res.status + ').');
    const body = await res.json() as { data?: Array<{ index: number; embedding: number[] }> };
    const sorted = (body.data || []).slice().sort((a,b) => a.index - b.index);
    if (sorted.length !== batch.length ||
        sorted.some(v => !Array.isArray(v.embedding) || v.embedding.length !== DIMENSIONS ||
          v.embedding.some(x => !Number.isFinite(x)))) {
      throw new Error('Dimensions des embeddings incorrectes.');
    }
    vectors.push(...sorted.map(v => v.embedding));
  }
  return vectors;
}

export function vectorLiteral(vector: number[]): string {
  if (vector.length !== DIMENSIONS || vector.some(n => !Number.isFinite(n))) {
    throw new Error('Vecteur invalide.');
  }
  return '[' + vector.join(',') + ']';
}
