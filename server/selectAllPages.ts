// PostgREST (Supabase) plafonne chaque réponse à 1 000 lignes par défaut
// (`max-rows`), sans erreur ni signal : un `.select('*')` sur une table qui
// en compte davantage rend silencieusement les 1 000 premières. C'est ce qui
// faisait disparaître de la liste des contacts tout contact créé au-delà.
// Ce helper lit par tranches, dans un ordre stable, jusqu'à la dernière.

export const SELECT_PAGE_SIZE = 1000;

type PageResult = { data: any[] | null; error: any };
interface RangeableQuery {
  order(column: string, options?: { ascending?: boolean }): RangeableQuery;
  range(from: number, to: number): PromiseLike<PageResult>;
}

/**
 * `buildQuery` doit rendre une requête NEUVE à chaque appel (un builder
 * PostgREST ne se rejoue pas), filtres compris, sans ordre ni plage.
 * L'ordre par `id` garantit qu'aucune ligne n'est sautée ni lue deux fois.
 */
export async function selectAllPages<T = any>(
  buildQuery: () => RangeableQuery,
  { orderBy = 'id', pageSize = SELECT_PAGE_SIZE }: { orderBy?: string; pageSize?: number } = {},
): Promise<{ data: T[]; error: any }> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().order(orderBy, { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) return { data: rows, error };
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) return { data: rows, error: null };
  }
}
