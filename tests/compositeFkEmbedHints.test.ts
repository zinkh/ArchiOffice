// Garde statique (issue #245) : PostgREST n'accepte un indice de colonne dans une jointure
// (`site_reports!created_report_id(...)`) que pour une clé étrangère à UNE seule colonne. Une fois
// qu'un parent est visé par des clés composites (colonne, tenant_id)
// (supabase/migrate_zz_tenant_composite_fks*.sql), une jointure vers lui AVEC un indice de colonne
// échoue (PGRST200). Une jointure SANS indice (`projects(name)`) reste valable.
//
// Les parents convertis sont lus dans les migrations elles-mêmes (`v_parents`) : ajouter un parent
// à une migration étend automatiquement ce garde, sans liste à tenir à jour ici.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const JOIN_TYPES = new Set(['inner', 'left', 'right', 'full']); // `table!inner(...)` : type de jointure, pas un indice

function convertedParents(): string[] {
  const dir = join(ROOT, 'supabase');
  const parents = new Set<string>();
  for (const f of readdirSync(dir).filter(n => /^migrate_zz_tenant_composite_fks.*\.sql$/.test(n))) {
    const m = readFileSync(join(dir, f), 'utf8').match(/v_parents\s+text\[\]\s*:=\s*ARRAY\[([^\]]+)\]/);
    for (const p of (m?.[1] ?? '').matchAll(/'([a-z_][a-z0-9_]*)'/g)) parents.add(p[1]);
  }
  return [...parents].sort();
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-api' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

describe('jointures PostgREST et clés composites', () => {
  const parents = convertedParents();
  const files = [join(ROOT, 'server'), join(ROOT, 'src'), ...readdirSync(join(ROOT, 'packages')).map(p => join(ROOT, 'packages', p, 'src'))]
    .filter(d => { try { return statSync(d).isDirectory(); } catch { return false; } })
    .flatMap(d => sourceFiles(d));

  // `[alias:]table!indice(` : on garde la table avant le « ! ».
  const hints = files.flatMap(file => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(/\b([a-z_][a-z0-9_]*)!([a-z_][a-z0-9_]*)\(/g)]
      .filter(m => !JOIN_TYPES.has(m[2]))
      .map(m => ({ file: relative(ROOT, file), table: m[1], hint: m[2] }));
  });

  it('lit bien les parents convertis dans les migrations', () => {
    expect(parents).toEqual(expect.arrayContaining(['projects', 'contacts', 'contrats_moe']));
  });

  it('le balayage n\'est pas vide : il retrouve les indices de colonne existants', () => {
    // observations.ts joint site_reports par `created_report_id` et `resolved_report_id`.
    expect(hints.some(h => h.table === 'site_reports' && h.file.endsWith('observations.ts'))).toBe(true);
  });

  it('aucun indice de colonne ne vise un parent converti en clé composite', () => {
    const offenders = hints.filter(h => parents.includes(h.table));
    expect(offenders, `Indice de colonne vers un parent à clé composite (PGRST200) : ${JSON.stringify(offenders)}. `
      + 'Joindre sans indice, ou ne pas convertir ce parent.').toEqual([]);
  });

  it('site_reports reste hors des migrations tant que observations.ts utilise des indices de colonne', () => {
    const usedWithHint = hints.some(h => h.table === 'site_reports');
    if (usedWithHint) expect(parents).not.toContain('site_reports');
  });
});
