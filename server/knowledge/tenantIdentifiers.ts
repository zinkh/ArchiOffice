/**
 * Valeurs que le cabinet connaît avec certitude et qui ne doivent jamais partir
 * dans un extrait : noms de contacts, de clients, d'affaires, d'équipe, adresses,
 * identifiants de l'agence. Lues dans SA base, jamais envoyées à un tiers : elles
 * servent seulement à masquer du texte localement (voir anonymize.ts).
 */
import { tenantScopedFrom } from '../tenantScopedFrom';
import { listTenantProfiles } from '../tenantMemberships';
import type { KnownValue } from './anonymize';

const PERSON_KEY = /(^|_)(name|nom|prenom|firstname|first_name|lastname|last_name|manager|architect_name)(_|$)/i;
const COMPANY_KEY = /(company|societe|organisation|organization|etablissement|agency_name|entreprise)/i;
const CLIENT_KEY = /(^|_)client(_name|_nom)?$/i;
const ADDRESS_KEY = /(address|adresse|street|lieu|ville_execution|city)/i;
const CODE_KEY = /(^|_)(project_code|reference|siret|siren|tva|vat|market_number|code_affaire)(_|$)/i;
const CONTACT_KEY = /(email|mail|phone|telephone|mobile|fax)/i;
// Colonnes dont la valeur n'identifie personne (même si leur nom contient « name »).
const IGNORED_KEY = /(file|document|doc|plan|template|logo|avatar|icon|category|categorie|phase|status|type|role|plan_name|tag)/i;

function categoryOf(table: string, key: string): string | null {
  if (IGNORED_KEY.test(key) && !COMPANY_KEY.test(key)) return null;
  if (CONTACT_KEY.test(key)) return 'COORDONNEES';
  if (ADDRESS_KEY.test(key)) return 'ADRESSE';
  if (CODE_KEY.test(key)) return 'REFERENCE';
  if (COMPANY_KEY.test(key)) return table === 'settings' || table === 'tenants' ? 'CABINET' : 'ENTREPRISE';
  if (CLIENT_KEY.test(key)) return 'CLIENT';
  if (PERSON_KEY.test(key)) {
    if (table === 'projects' || table === 'tenders') return 'AFFAIRE';
    if (table === 'tenants') return 'CABINET';
    return 'PERSONNE';
  }
  return null;
}

/** Valeurs d'une ligne, rangées par catégorie. Pur, donc testable sans base. */
export function valuesFromRow(table: string, row: Record<string, unknown>): KnownValue[] {
  const out: KnownValue[] = [];
  for (const [key, raw] of Object.entries(row)) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value.length < 4 || value.length > 200 || /^\d+$/.test(value)) continue;
    const category = categoryOf(table, key);
    if (!category) continue;
    out.push({ value, category });
    // Le nom de famille seul (« Lambert » pour « Sophie Lambert ») est ce qu'un CCTP cite le plus souvent.
    if (category === 'PERSONNE') {
      const parts = value.split(/\s+/);
      if (parts.length >= 2) {
        const last = parts[parts.length - 1];
        if (last.length >= 6) out.push({ value: last, category });
      }
    }
  }
  return out;
}

const SOURCES: { table: string; columns: string; limit: number; optional?: boolean }[] = [
  { table: 'contacts', columns: '*', limit: 5000 },
  { table: 'projects', columns: '*', limit: 3000 },
  { table: 'settings', columns: '*', limit: 5 },
  { table: 'tenants', columns: 'name', limit: 1 },
  { table: 'project_stakeholders', columns: '*', limit: 5000, optional: true },
  { table: 'tenders', columns: '*', limit: 2000, optional: true },
];

/**
 * Charge les valeurs connues du cabinet. Une lecture des tables principales qui
 * échoue lève une erreur : mieux vaut réessayer plus tard que traiter un document
 * avec une liste incomplète, donc moins protectrice, sans que personne ne le sache.
 */
export async function loadTenantKnownValues(db: any, tenantId: string): Promise<KnownValue[]> {
  const values: KnownValue[] = [];
  for (const source of SOURCES) {
    if (source.table === 'tenants') {
      const { data, error } = await db.from('tenants').select('name').eq('id', tenantId).limit(1);
      if (error) throw error;
      for (const row of data || []) values.push(...valuesFromRow('tenants', row));
      continue;
    }
    const { data, error } = await tenantScopedFrom(db, tenantId, source.table).select(source.columns).limit(source.limit);
    if (error) {
      if (source.optional) continue;
      throw error;
    }
    for (const row of data || []) values.push(...valuesFromRow(source.table, row));
  }
  for (const profile of await listTenantProfiles(db, tenantId, '*')) values.push(...valuesFromRow('profiles', profile));
  return values;
}
