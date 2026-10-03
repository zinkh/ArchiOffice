// Pendant côté écran de `server/invoiceAccess.ts` : un chef de projet (`pm`)
// ne crée, ne modifie ni ne supprime de facture. Le
// serveur reste la barrière ; ceci évite seulement d'afficher des boutons qui
// répondraient 403. Un rôle inconnu n'est pas restreint.

const RESTRICTED_ROLES = ['pm'];

export function canWriteInvoices(systemRole: string | null | undefined): boolean {
  return !systemRole || !RESTRICTED_ROLES.includes(systemRole);
}
