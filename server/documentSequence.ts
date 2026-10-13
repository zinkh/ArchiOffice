// Séquence de numérotation atomique : un appel à la fonction SQL
// next_document_number (supabase/migrate_atomic_document_numbering.sql), dont
// l'incrément se fait sous verrou de ligne Postgres. Deux créations simultanées
// pour un même cabinet ne peuvent plus recevoir le même numéro, ce que l'ancien
// « nombre de lignes + 1 » permettait.
//
// Une instance dont la base n'a pas encore joué la migration (poste local
// Electron, hébergement en retard d'une migration) garde l'ancien calcul plutôt
// que d'échouer : c'est le même repli que les autres fonctions SQL ajoutées
// après coup. Toute autre erreur est remontée, jamais avalée : émettre un
// numéro « au hasard » sur une panne de base serait pire qu'un échec franc.

/** La fonction SQL n'existe pas encore sur cette base (migration non jouée). */
export function isMissingSequenceFunction(error: any): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '42883'
    || /could not find the function|function .* does not exist/i.test(String(error.message || ''));
}

/**
 * Prochaine valeur de la série `series` du cabinet. `legacyCount` ne sert que de
 * repli quand la migration n'est pas jouée : il rend le nombre de lignes
 * existantes, comme avant.
 */
export async function nextDocumentSequence(
  supabaseAdmin: any,
  tenantId: string,
  series: string,
  legacyCount: () => Promise<number>,
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('next_document_number', { p_tenant_id: tenantId, p_series: series });
  if (!error) {
    const value = Number(data);
    if (!Number.isFinite(value) || value < 1) throw new Error(`Séquence « ${series} » : valeur inattendue (${String(data)}).`);
    return value;
  }
  if (isMissingSequenceFunction(error)) return (await legacyCount()) + 1;
  throw new Error(`Numérotation « ${series} » impossible : ${error.message}`);
}
