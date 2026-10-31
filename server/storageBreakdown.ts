// Répartition du stockage d'un cabinet pour le cartouche de la barre latérale.
//
// Seuls les documents ont un auteur (`document_versions.uploaded_by`, qui porte le
// NOM de la personne, pas son identifiant) : les photos, plans et pièces jointes
// n'en ont pas. Ils sont donc rapportés sous « non attribué », par différence
// avec le total mesuré, plutôt que répartis au hasard.
//
// Confidentialité : le détail par personne est réservé aux administrateurs et
// managers. Les autres ne voient que leur propre ligne, jamais celle des autres
// ni le non attribué.

export interface UploaderRow {
  uploaded_by: string | null;
  bytes: number | string | null;
  files: number | string | null;
}

export interface StorageUserLine {
  /** Chaîne vide quand le document n'a aucun auteur enregistré. */
  name: string;
  bytes: number;
  files: number;
  is_me: boolean;
}

export interface StorageBreakdown {
  scope: 'all' | 'self';
  users: StorageUserLine[];
  /** Octets hébergés sans auteur connu (photos, plans...). Null quand le détail est restreint. */
  unattributed_bytes: number | null;
}

const key = (name: string) => name.trim().toLocaleLowerCase('fr');
const toCount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function buildStorageBreakdown(params: {
  usedBytes: number;
  rows: UploaderRow[];
  canSeeAll: boolean;
  myName: string;
}): StorageBreakdown {
  const me = key(params.myName);

  // Un même auteur peut être saisi avec une casse ou des espaces différents.
  const merged = new Map<string, StorageUserLine>();
  for (const row of params.rows) {
    const name = (row.uploaded_by ?? '').trim();
    const k = key(name);
    const line = merged.get(k) ?? { name, bytes: 0, files: 0, is_me: me !== '' && k === me };
    line.bytes += toCount(row.bytes);
    line.files += toCount(row.files);
    merged.set(k, line);
  }
  const lines = [...merged.values()].sort((a, b) => b.bytes - a.bytes);

  if (!params.canSeeAll) {
    return { scope: 'self', users: lines.filter(l => l.is_me), unattributed_bytes: null };
  }
  const attributed = lines.reduce((sum, l) => sum + l.bytes, 0);
  return {
    scope: 'all',
    users: lines,
    unattributed_bytes: Math.max(0, params.usedBytes - attributed),
  };
}
