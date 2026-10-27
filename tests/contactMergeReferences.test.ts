// Garde-fou de la fusion de contacts : toute colonne qui référence un contact doit figurer
// dans la liste `v_refs` de merge_contacts (supabase/migrate_merge_contacts.sql), sinon
// ses lignes resteraient accrochées à une fiche supprimée. Le test lit les migrations et
// le schéma : ajouter une colonne `... REFERENCES contacts(id)` (ou une colonne nommée
// contact_id / client_id / billing_contact_id) sans l'inscrire dans la fonction le fait échouer.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL_DIR = join(__dirname, '../supabase');
const files = readdirSync(SQL_DIR).filter(f => f.endsWith('.sql'));
const read = (f: string) => readFileSync(join(SQL_DIR, f), 'utf8');

/** Colonnes dont le nom parle de contact mais qui ne désignent PAS une fiche contact. */
const NOT_A_CONTACT_REFERENCE = new Set([
  'mcp_connections.client_id', 'mcp_oauth_clients.client_id', 'mcp_oauth_grants.client_id', // clients OAuth
]);

function declaredInFunction(): Set<string> {
  const sql = read('migrate_merge_contacts.sql');
  const block = (name: string) => {
    const start = sql.indexOf(`${name} TEXT[][] := ARRAY[`);
    const end = sql.indexOf('];', start);
    return sql.slice(start, end);
  };
  const out = new Set<string>();
  for (const m of block('v_refs').matchAll(/\['(\w+)','(\w+)'\]/g)) out.add(`${m[1]}.${m[2]}`);
  return out;
}

function referencingColumns(): Map<string, string> {
  const found = new Map<string, string>(); // table.colonne -> fichier
  for (const file of files) {
    if (file === 'migrate_merge_contacts.sql') continue;
    const sql = read(file).replace(/--.*$/gm, '');
    const tableBefore = (index: number): string | null => {
      let table: string | null = null;
      for (const m of sql.matchAll(/(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE(?: IF EXISTS)?(?: ONLY)?)\s+"?(\w+)"?/gi)) {
        if (m.index! > index) break;
        table = m[1];
      }
      return table;
    };
    const patterns = [
      /\b(\w+)\s+(?:TEXT|UUID)\s+(?:NOT NULL\s+)?REFERENCES\s+contacts\s*\(\s*id\s*\)/gi,
      /(?:ADD COLUMN(?: IF NOT EXISTS)?)\s+(\w*(?:contact_id|client_id))\b/gi,
      /(?:^|,)\s*(\w*(?:contact_id|client_id))\s+(?:TEXT|UUID)\b/gim,
    ];
    for (const re of patterns) {
      for (const m of sql.matchAll(re)) {
        const table = tableBefore(m.index!);
        // `settings` porte les identifiants OAuth des connecteurs (zoho_client_id...), pas des contacts.
        if (table && table !== 'contacts' && table !== 'settings') found.set(`${table}.${m[1]}`, file);
      }
    }
  }
  return found;
}

describe('fusion de contacts : toutes les références sont rattachées', () => {
  it('chaque colonne qui référence un contact est listée dans merge_contacts', () => {
    const declared = declaredInFunction();
    expect(declared.size).toBeGreaterThan(15); // le parseur du test lit bien la liste
    const missing = [...referencingColumns()]
      .filter(([column]) => !declared.has(column) && !NOT_A_CONTACT_REFERENCE.has(column))
      .map(([column, file]) => `${column} (${file})`);
    expect(missing, `À ajouter à v_refs dans migrate_merge_contacts.sql :\n${missing.join('\n')}`).toEqual([]);
  });

  it('la liste de la fonction ne contient que des colonnes qui existent dans les migrations', () => {
    const known = new Set([...referencingColumns().keys(), 'marches_entreprises.act_entreprise_id', 'marches_entreprises.contact_id', 'contacts.company_contact_id']);
    const unknown = [...declaredInFunction()].filter(c => !known.has(c));
    expect(unknown).toEqual([]);
  });
});
