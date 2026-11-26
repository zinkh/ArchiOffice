// Plan d'un import dans une base de données du cabinet : valide TOUT avant que la route n'écrive quoi que ce
// soit (tout ou rien) et calcule ce qu'il faudra créer : colonnes, étiquettes, lignes. Logique pure, sans accès
// à la base : la route (server/routes/knowledgeBase.ts) lit les colonnes existantes, appelle ce module, puis
// écrit le plan. Les valeurs de chaque cellule passent par sanitizeKbValue, la même règle que l'écran.
import {
  KB_MAX_OPTIONS, isKbPropertyType, kbNextTagColor, sanitizeKbOptions, sanitizeKbValue,
  type KbOption, type KbProperty, type KbPropertyType,
} from './kb';
import { KB_IMPORT_MAX_COLUMNS, KB_IMPORT_MAX_ROWS_PER_REQUEST } from './kbImport';
import { foldText } from './slashMenu';

export type KbImportColumnType = Exclude<KbPropertyType, 'title' | 'relation'>;

export interface KbImportError { row: number; column?: string; error: string }
export interface PlannedProperty { id: string; name: string; type: KbImportColumnType; options: KbOption[] }
export interface PlannedRow { title: string; properties: Record<string, unknown>; content: unknown | null }
export interface KbImportPlan {
  /** Refus de toute la demande (corps mal formé, plafond dépassé, colonne incohérente) : 400. */
  fatal?: string;
  /** Erreurs par ligne et par colonne : rien n'est écrit tant qu'il en reste. */
  errors: KbImportError[];
  newProperties: PlannedProperty[];
  /** Colonnes existantes à choix dont la liste d'étiquettes s'allonge. */
  optionUpdates: Array<{ propertyId: string; options: KbOption[] }>;
  optionsCreated: number;
  rows: PlannedRow[];
}

interface Resolved {
  name: string;
  type: KbImportColumnType;
  id: string;
  isNew: boolean;
  options: KbOption[];
}

const isChoice = (type: KbImportColumnType) => type === 'select' || type === 'multi_select';
const cellKey = (name: string) => foldText(name.trim());
const labelsOf = (value: unknown): string[] =>
  (typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
    .map(label => label.trim().slice(0, 80)).filter(Boolean);

const empty = (fatal?: string): KbImportPlan => ({ fatal, errors: [], newProperties: [], optionUpdates: [], optionsCreated: 0, rows: [] });

export function planKbImport(
  body: { columns?: unknown; rows?: unknown },
  existing: KbProperty[],
  makeId: () => string,
  opts: { maxContentBytes?: number } = {},
): KbImportPlan {
  const maxContent = opts.maxContentBytes ?? 2_000_000;
  if (!Array.isArray(body.columns)) return empty('Colonnes manquantes.');
  if (!Array.isArray(body.rows) || body.rows.length === 0) return empty('Aucune ligne à importer.');
  if (body.columns.length > KB_IMPORT_MAX_COLUMNS) return empty(`Trop de colonnes (maximum ${KB_IMPORT_MAX_COLUMNS}).`);
  if (body.rows.length > KB_IMPORT_MAX_ROWS_PER_REQUEST) return empty(`Trop de lignes (maximum ${KB_IMPORT_MAX_ROWS_PER_REQUEST} par envoi).`);

  // ── Colonnes : rapprochées des colonnes existantes par nom (casse et accents ignorés) ────────────────
  const titleProperty = existing.find(p => p.type === 'title');
  const resolved = new Map<string, Resolved>();
  for (const raw of body.columns as any[]) {
    const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, 80) : '';
    if (!name) return empty('Nom de colonne vide.');
    if (!isKbPropertyType(raw?.type) || raw.type === 'title' || raw.type === 'relation') return empty(`Type de colonne inconnu pour « ${name} ».`);
    const key = cellKey(name);
    if (resolved.has(key)) return empty(`La colonne « ${name} » est envoyée deux fois.`);
    if (titleProperty && cellKey(titleProperty.name) === key) return empty(`« ${name} » est le nom de la colonne titre : elle n'est pas importée comme une colonne.`);
    const match = existing.find(p => p.type !== 'title' && cellKey(p.name) === key);
    if (match && match.type !== raw.type) return empty(`La colonne « ${match.name} » existe déjà avec un autre type.`);
    resolved.set(key, match
      ? { name: match.name, type: match.type as KbImportColumnType, id: match.id, isNew: false, options: [...match.options] }
      : { name, type: raw.type, id: makeId(), isNew: true, options: [] });
  }

  // ── Étiquettes : celles que les lignes citent et que la colonne ne connaît pas encore ────────────────
  const added = new Map<string, string[]>();
  for (const raw of body.rows as any[]) {
    const cells = raw && typeof raw === 'object' && raw.cells && typeof raw.cells === 'object' ? raw.cells as Record<string, unknown> : {};
    for (const [key, value] of Object.entries(cells)) {
      const column = resolved.get(cellKey(key));
      if (!column || !isChoice(column.type)) continue;
      const list = added.get(cellKey(key)) ?? [];
      for (const label of labelsOf(value)) {
        const folded = foldText(label);
        if (column.options.some(o => foldText(o.label) === folded) || list.some(l => foldText(l) === folded)) continue;
        list.push(label);
      }
      added.set(cellKey(key), list);
    }
  }
  const optionUpdates: KbImportPlan['optionUpdates'] = [];
  let optionsCreated = 0;
  for (const [key, labels] of added) {
    const column = resolved.get(key)!;
    if (labels.length === 0) continue;
    if (column.options.length + labels.length > KB_MAX_OPTIONS) return empty(`Trop d'étiquettes différentes pour « ${column.name} » (maximum ${KB_MAX_OPTIONS}).`);
    const before = column.options.length;
    column.options = sanitizeKbOptions(
      [...column.options, ...labels.map((label, i) => ({ label, color: kbNextTagColor(before + i) }))],
      makeId,
    );
    optionsCreated += labels.length;
    if (!column.isNew) optionUpdates.push({ propertyId: column.id, options: column.options });
  }

  // ── Lignes : chaque cellule validée comme à l'écran ──────────────────────────────────────────────────
  const errors: KbImportError[] = [];
  const rows: PlannedRow[] = [];
  (body.rows as any[]).forEach((raw, index) => {
    const row = index + 1;
    if (!raw || typeof raw !== 'object') { errors.push({ row, error: 'Ligne invalide.' }); return; }
    const properties: Record<string, unknown> = {};
    const cells = raw.cells && typeof raw.cells === 'object' && !Array.isArray(raw.cells) ? raw.cells as Record<string, unknown> : {};
    for (const [key, value] of Object.entries(cells)) {
      const column = resolved.get(cellKey(key));
      if (!column) { errors.push({ row, column: key, error: 'Colonne inconnue.' }); continue; }
      if (value === null || value === undefined) continue;
      let toValidate: unknown = value;
      if (isChoice(column.type)) {
        const ids = labelsOf(value).map(label => column.options.find(o => foldText(o.label) === foldText(label))?.id).filter((id): id is string => !!id);
        if (ids.length === 0) continue;
        toValidate = column.type === 'multi_select' ? ids : ids[0];
      }
      const checked = sanitizeKbValue({ type: column.type, options: column.options }, toValidate);
      if (checked.error) errors.push({ row, column: column.name, error: checked.error });
      else if (checked.value !== null) properties[column.id] = checked.value;
    }
    let content: unknown | null = null;
    if (raw.content !== undefined && raw.content !== null) {
      if (typeof raw.content !== 'object' || Array.isArray(raw.content)) errors.push({ row, error: 'Contenu invalide.' });
      else if (JSON.stringify(raw.content).length > maxContent) errors.push({ row, error: 'Contenu trop volumineux.' });
      else content = raw.content;
    }
    rows.push({ title: typeof raw.title === 'string' ? raw.title.trim().slice(0, 200) : '', properties, content });
  });

  return {
    errors,
    newProperties: [...resolved.values()].filter(c => c.isNew).map(c => ({ id: c.id, name: c.name, type: c.type, options: c.options })),
    optionUpdates,
    optionsCreated,
    rows,
  };
}
