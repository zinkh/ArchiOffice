// Mistral Libraries simulé en mémoire (fetch global) : aucun appel réseau réel.
// Couvre ce que server/knowledge/mistralLibrary.ts utilise : lecture de la
// bibliothèque, liste des documents, envoi multipart et suppression.
import { vi } from 'vitest';

export const FAKE_MISTRAL_LIBRARY = '01a12a77-dd1c-77eb-84b0-25cac8adccf4';

export interface FakeMistral {
  docs: { id: string; library_id: string; name: string }[];
  calls: string[];
  failDelete: boolean;
  failUpload: boolean;
  /** Simule un `search` qui ne filtre rien (comportement non garanti par l'API). */
  ignoreSearch?: boolean;
  /** Ajoute un doublon du même nom pour simuler une ambiguïté. */
  duplicateName?: string;
}

export function installFakeMistral(initial: { name: string }[] = []): FakeMistral {
  const lib = FAKE_MISTRAL_LIBRARY;
  const mistral: FakeMistral = {
    docs: initial.map(d => ({ id: crypto.randomUUID(), library_id: lib, name: d.name })),
    calls: [], failDelete: false, failUpload: false,
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (!String(url).startsWith('https://api.mistral.ai/')) throw new Error('Appel réseau inattendu : ' + url);
    const method = init.method || 'GET';
    mistral.calls.push(method + ' ' + String(url).replace('https://api.mistral.ai/v1/libraries/', ''));
    if (String(url).includes('/documents/') && method === 'DELETE') {
      if (mistral.failDelete) return new Response(null, { status: 503 });
      const id = String(url).split('/documents/')[1];
      mistral.docs = mistral.docs.filter(d => d.id !== id);
      return new Response(null, { status: 204 });
    }
    if (String(url).includes('/documents') && method === 'POST') {
      if (mistral.failUpload) throw new Error('timeout simulé');
      const file = (init.body as FormData).get('file') as File;
      const doc = { id: crypto.randomUUID(), library_id: lib, name: file.name };
      mistral.docs.push(doc);
      return new Response(JSON.stringify(doc), { status: 200 });
    }
    if (String(url).includes('/documents')) {
      const query = new URL(String(url)).searchParams;
      const pageSize = Number(query.get('page_size') ?? 100);
      const page = Number(query.get('page') ?? 0);
      const search = query.get('search');
      let all = mistral.duplicateName
        ? [...mistral.docs, { id: crypto.randomUUID(), library_id: lib, name: mistral.duplicateName }]
        : [...mistral.docs];
      if (search && !mistral.ignoreSearch) all = all.filter(d => d.name.includes(search));
      const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
      return new Response(JSON.stringify({
        data: all.slice(page * pageSize, (page + 1) * pageSize),
        pagination: {
          total_items: all.length, total_pages: totalPages, current_page: page,
          page_size: pageSize, has_more: page + 1 < totalPages,
        },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: lib, name: 'Bac à sable' }), { status: 200 });
  }));
  return mistral;
}
