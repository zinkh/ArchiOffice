// Dossiers libres sous les phases d'une affaire (GED). Logique pure, partagée par le serveur
// (server/routes/documentFolders.ts) et l'écran (src/pages/Ged.tsx). Table document_folders,
// supabase/migrate_document_folders.sql.

export const DOCUMENT_PHASES = ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR', 'Général'] as const;

export const FOLDER_NAME_MAX = 80;
/** Profondeur maximale : un dossier de phase (1), son sous-dossier (2), puis (3). */
export const FOLDER_MAX_DEPTH = 3;

export interface DocFolder {
  id: string;
  project_id: string;
  phase: string;
  parent_id?: string | null;
  name: string;
}

export interface FolderNode extends DocFolder { children: FolderNode[]; depth: number }

// Caractères refusés : ils sont interdits dans un nom de fichier Windows ou macOS, et un dossier
// finira tôt ou tard par exister aussi chez un fournisseur de stockage.
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/;

/** Nom nettoyé (espaces resserrés) ou message d'erreur. */
export function normalizeFolderName(raw: unknown): { name?: string; error?: string } {
  if (typeof raw !== 'string') return { error: 'Le nom du dossier est obligatoire.' };
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'Le nom du dossier est obligatoire.' };
  if (name.length > FOLDER_NAME_MAX) return { error: `Le nom du dossier ne peut pas dépasser ${FOLDER_NAME_MAX} caractères.` };
  if (FORBIDDEN.test(name)) return { error: 'Le nom du dossier ne peut pas contenir \\ / : * ? " < > |.' };
  if (/^\.+$/.test(name) || /[. ]$/.test(name)) return { error: 'Le nom du dossier ne peut pas se terminer par un point ni être composé de points.' };
  return { name };
}

/** Clé de comparaison d'un nom : casse, accents et espaces ignorés. */
export function folderNameKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Forêt de dossiers d'une même affaire et phase, triée par nom (ordre naturel). Un parent absent fait remonter l'enfant à la racine. */
export function buildFolderTree(folders: readonly DocFolder[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>(folders.map(f => [f.id, { ...f, children: [], depth: 1 }]));
  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent && parent.phase === node.phase && parent.project_id === node.project_id) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: FolderNode[], depth: number) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    for (const n of list) { n.depth = depth; sort(n.children, depth + 1); }
  };
  sort(roots, 1);
  return roots;
}

/** Profondeur d'un dossier (1 = directement sous la phase), ou null si la chaîne des parents est cassée ou cyclique. */
export function folderDepth(id: string, folders: readonly DocFolder[]): number | null {
  const byId = new Map(folders.map(f => [f.id, f]));
  let depth = 0;
  let cur: DocFolder | undefined = byId.get(id);
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    depth++;
    if (!cur.parent_id) return depth;
    cur = byId.get(cur.parent_id);
  }
  return null;
}

/** Le dossier et tous ses descendants. */
export function folderAndDescendantIds(id: string, folders: readonly DocFolder[]): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true; }
    }
  }
  return out;
}

/** Chemin lisible « Plans / Structure » depuis la phase. Vide si le dossier est inconnu. */
export function folderPath(id: string | null | undefined, folders: readonly DocFolder[]): string[] {
  if (!id) return [];
  const byId = new Map(folders.map(f => [f.id, f]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) {
    seen.add(cur.id);
    out.unshift(cur.name);
  }
  return out;
}

/** Les dossiers proposés pour ranger un document : ceux de son affaire et de sa phase, à plat, avec leur chemin. */
export function folderChoices(projectId: string | null | undefined, phase: string, folders: readonly DocFolder[]): { id: string; label: string }[] {
  if (!projectId) return [];
  const scope = folders.filter(f => f.project_id === projectId && f.phase === phase);
  return scope
    .map(f => ({ id: f.id, label: folderPath(f.id, scope).join(' / ') }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true }));
}
