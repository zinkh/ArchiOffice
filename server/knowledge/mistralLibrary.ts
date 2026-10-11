/**
 * Mistral Libraries transport. No originals or client metadata leave ArchiOffice.
 * API reference: https://docs.mistral.ai/api/endpoint/beta/libraries/documents
 */
export const DEFAULT_KNOWLEDGE_LIBRARY_ID = '01a12a77-dd1c-77eb-84b0-25cac8adccf4';

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
  if (!apiKey || !/^[0-9a-f-]{36}$/i.test(libraryId)) throw new Error('Mistral Libraries non configuré.');
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
      // Never assume a missing entry on the first page means an upload failed.
      let token: string | undefined;
      let matched: MistralRemoteDocument | null = null;
      const seen = new Set<string>();
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ page_size: '100' });
        if (token) query.set('page_token', token);
        const response = await call('/documents?' + query.toString());
        const pageData = await response.json() as {
          data?: MistralRemoteDocument[];
          next_page_token?: string | null;
        };
        if (!Array.isArray(pageData.data)) throw new Error('Liste Mistral incohérente.');
        const matches = pageData.data.filter(d => d.name === remoteName && d.library_id === libraryId);
        if (matches.length > 1 || (matched && matches.length > 0)) {
          throw new Error('Plusieurs copies distantes correspondent au même extrait : examen requis.');
        }
        if (matches[0]) matched = matches[0];
        token = pageData.next_page_token || undefined;
        if (!token) return matched;
        if (seen.has(token)) throw new Error('Pagination Mistral incohérente.');
        seen.add(token);
      }
      throw new Error('Bibliothèque trop volumineuse : rapprochement incomplet.');
    },
    async remove(remoteDocumentId: string): Promise<void> {
      if (!/^[0-9a-f-]{36}$/i.test(remoteDocumentId)) throw new Error('Identifiant distant invalide.');
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
