/**
 * Mistral Libraries transport. No originals or client metadata leave ArchiOffice.
 * API reference: https://docs.mistral.ai/api/endpoint/beta/libraries/documents
 */
const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Bibliothèque cible de la mutualisation. Volontairement SANS valeur par défaut :
 * un repli sur la bibliothèque de test ferait publier les extraits d'une
 * instance de production mal configurée dans le bac à sable.
 */
export function resolveKnowledgeLibraryId(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = env.MISTRAL_KNOWLEDGE_LIBRARY_ID?.trim();
  return id && UUID_RE.test(id) ? id : null;
}

export interface MistralRemoteDocument {
  id: string;
  library_id: string;
  name: string;
}

export class MistralLibraryError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'MistralLibraryError';
  }
}

export function makeMistralLibraryClient(
  apiKey: string,
  libraryId: string,
  request: typeof fetch = fetch,
) {
  if (!apiKey || !UUID_RE.test(libraryId)) throw new Error('Mistral Libraries non configuré.');
  const base = 'https://api.mistral.ai/v1/libraries/' + encodeURIComponent(libraryId);
  const call = async (path: string, options: RequestInit = {}) => {
    const response = await request(base + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + apiKey, ...options.headers },
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      // Never print upstream response bodies: they may include sensitive source text.
      throw new MistralLibraryError(response.status, 'Mistral Libraries a répondu ' + response.status);
    }
    return response;
  };
  // GET /documents est paginé par `page` (à partir de 0) et `page_size`, la
  // réponse porte `pagination.has_more` (et non un jeton de page).
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  const listByName = async (remoteName: string, search?: string): Promise<MistralRemoteDocument[]> => {
    const matches: MistralRemoteDocument[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({
        page_size: String(PAGE_SIZE), page: String(page), sort_by: 'created_at', sort_order: 'desc',
      });
      if (search) query.set('search', search);
      const response = await call('/documents?' + query.toString());
      const body = await response.json() as {
        data?: MistralRemoteDocument[];
        pagination?: { has_more?: boolean };
      };
      // Échec fermé : sans indicateur de pagination fiable, on ne peut pas affirmer
      // avoir tout lu, donc on ne conclut jamais à l'absence d'un document.
      if (!Array.isArray(body.data) || typeof body.pagination?.has_more !== 'boolean') {
        throw new Error('Liste Mistral incohérente.');
      }
      matches.push(...body.data.filter(d => d.name === remoteName && d.library_id === libraryId));
      if (!body.pagination.has_more) return matches;
    }
    throw new Error('Bibliothèque trop volumineuse : rapprochement incomplet.');
  };
  return {
    async upload(sanitizedText: string, contributionId: string): Promise<MistralRemoteDocument> {
      const name = 'archioffice-' + contributionId + '.txt';
      const form = new FormData();
      // Unique, opaque marker prevents upstream content-hash deduplication
      // from making two tenants accidentally share one remote document ID.
      const content = sanitizedText + '\n\n[Référence anonyme : ' + contributionId + ']\n';
      form.append('file', new Blob([content], { type: 'text/plain;charset=utf-8' }), name);
      const response = await call('/documents', { method: 'POST', body: form });
      const doc = await response.json() as MistralRemoteDocument;
      if (!doc?.id || doc.library_id !== libraryId || doc.name !== name) {
        throw new Error('Réponse de téléversement Mistral inattendue. Rapprochement requis.');
      }
      return doc;
    },
    async findByName(remoteName: string): Promise<MistralRemoteDocument | null> {
      // Un nom absent de la première page ne prouve rien : on parcourt toutes les
      // pages. `search` restreint d'abord la liste ; son comportement exact n'étant
      // pas garanti, une recherche sans résultat est confirmée par un parcours
      // complet avant de conclure à l'absence (jamais d'abandon sur un faux négatif).
      let matches = await listByName(remoteName, remoteName);
      if (matches.length === 0) matches = await listByName(remoteName);
      if (matches.length > 1) {
        throw new Error('Plusieurs copies distantes correspondent au même extrait : examen requis.');
      }
      return matches[0] ?? null;
    },
    async remove(remoteDocumentId: string): Promise<void> {
      if (!UUID_RE.test(remoteDocumentId)) throw new Error('Identifiant distant invalide.');
      try {
        await call('/documents/' + encodeURIComponent(remoteDocumentId), { method: 'DELETE' });
      } catch (error) {
        if (!(error instanceof MistralLibraryError) || error.status !== 404) throw error;
        // A 404 is only accepted when the library itself is still accessible.
        await call('');
      }
    },
  };
}
