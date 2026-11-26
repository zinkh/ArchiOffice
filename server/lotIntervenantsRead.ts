// Lecture des intervenants d'un lot (table lot_intervenants), nourris par la fiche contact.
// Une ligne liée à un contact (contact_id) rend le nom, le téléphone et l'e-mail ACTUELS de la
// fiche : corriger la fiche corrige l'intervenant et l'adresse de la diffusion des comptes-rendus.
// Une ligne sans contact (saisie libre d'avant la liaison) garde ses propres champs. Une fiche
// supprimée laisse l'instantané de la ligne.
import { tenantScopedFrom } from './tenantScopedFrom';
import { contactEmail } from '../src/lib/crDiffusion';

export const LOT_INTERVENANT_CONTACT_COLUMNS =
  'id, first_name, last_name, company_name, job_title, phone_mobile, phone_work, phone, email, email_work, email_home';

type Row = Record<string, any>;

const personName = (c: Row): string =>
  [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || String(c.company_name ?? '').trim();
const personPhone = (c: Row): string | null => c.phone_mobile || c.phone_work || c.phone || null;

/** Ajoute à chaque ligne `contact` (fiche) et rafraîchit `nom`, `telephone`, `email` depuis elle. */
export async function hydraterIntervenants(supabaseAdmin: any, tenantId: string, rows: Row[]): Promise<Row[]> {
  const ids = [...new Set(rows.map(r => r.contact_id).filter((v): v is string => typeof v === 'string' && v.length > 0))];
  if (ids.length === 0) return rows.map(r => ({ ...r, contact: null }));
  const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
    .select(LOT_INTERVENANT_CONTACT_COLUMNS).in('id', ids);
  if (error) return rows.map(r => ({ ...r, contact: null }));
  const byId = new Map<string, Row>(((data ?? []) as Row[]).map(c => [c.id, c]));
  return rows.map(r => {
    const contact = r.contact_id ? byId.get(r.contact_id) : undefined;
    if (!contact) return { ...r, contact: null };
    return {
      ...r,
      nom: personName(contact) || r.nom,
      telephone: personPhone(contact) ?? r.telephone ?? null,
      email: contactEmail(contact as Parameters<typeof contactEmail>[0]) || null,
      contact,
    };
  });
}
