// Numéro d'affaire (`projects.project_code`) : PRÉFIXE[-]AA[-]NNN, chaque tiret
// et le nombre de chiffres de NNN étant réglables par cabinet (/settings,
// « Numérotation des documents » : num_prefix_affaire, num_affaire_sep_prefix,
// num_affaire_sep_seq, num_affaire_digits). Les deux colonnes de tirets restent
// NULL tant que le cabinet n'a rien choisi : il garde alors son ancien format,
// PRÉFIXE-AA-NNN avec un préfixe, AANNN sans.
//
// Le numéro suivant est le PLUS GRAND numéro déjà donné cette année + 1, pas le
// nombre d'affaires : supprimer ou archiver une affaire ne redonne jamais un
// numéro déjà attribué. Partagé par la création d'une affaire
// (server/routes/projects.ts) et la conversion d'une proposition acceptée
// (server/routes/proposals.ts).
import { selectAllPages } from './selectAllPages';

interface AffaireNumbering {
  prefix: string;
  sepPrefix: boolean;
  sepSeq: boolean;
  digits: number;
}

export function affaireNumbering(settings: any): AffaireNumbering {
  const prefix = (settings?.num_prefix_affaire ?? '').toString().trim();
  const digitsRaw = settings?.num_affaire_digits;
  return {
    prefix,
    sepPrefix: settings?.num_affaire_sep_prefix == null ? true : !!settings.num_affaire_sep_prefix,
    sepSeq: settings?.num_affaire_sep_seq == null ? !!prefix : !!settings.num_affaire_sep_seq,
    digits: Number.isInteger(digitsRaw) && digitsRaw >= 1 && digitsRaw <= 6 ? digitsRaw : 3,
  };
}

/** Début commun des numéros de l'année (« AFF-26- », « 26 »...), puis le numéro lui-même. */
export function affaireHead(numbering: AffaireNumbering, year2: string): string {
  const { prefix, sepPrefix, sepSeq } = numbering;
  return `${prefix}${prefix && sepPrefix ? '-' : ''}${year2}${sepSeq ? '-' : ''}`;
}

/** Plus grand numéro d'ordre porté par `codes` pour ce début ; 0 si aucun. */
export function highestSequence(codes: Array<string | null | undefined>, head: string): number {
  let highest = 0;
  for (const code of codes) {
    if (!code || !code.startsWith(head)) continue;
    const rest = code.slice(head.length);
    if (/^\d+$/.test(rest)) highest = Math.max(highest, parseInt(rest, 10));
  }
  return highest;
}

export async function nextProjectCode(supabaseAdmin: any, tenantId: string, now: Date = new Date()): Promise<string> {
  const { data: settings } = await supabaseAdmin.from('settings')
    .select('num_prefix_affaire, num_affaire_sep_prefix, num_affaire_sep_seq, num_affaire_digits')
    .eq('tenant_id', tenantId).maybeSingle();
  const numbering = affaireNumbering(settings);
  const head = affaireHead(numbering, String(now.getFullYear()).slice(-2));
  const { data: rows } = await selectAllPages<{ project_code: string | null }>(
    () => supabaseAdmin.from('projects').select('project_code').eq('tenant_id', tenantId).like('project_code', `${head}%`),
  );
  const next = highestSequence(rows.map(r => r.project_code), head) + 1;
  return `${head}${String(next).padStart(numbering.digits, '0')}`;
}
