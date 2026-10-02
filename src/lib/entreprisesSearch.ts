// ── Recherche d'entreprises : types et mise en forme côté écran ─────────────
// Pendant client de server/routes/entreprisesSearch.ts.
import type { QualificationImportee } from './qualifications';

export interface ResultatRecherche {
  siren: string;
  siret: string;
  nom: string;
  adresse: string;
  code_postal: string;
  commune: string;
  departement: string;
  naf: string;
  naf_libelle: string | null;
  effectif: string | null;
  date_creation: string | null;
  rge_declaree: boolean;
  /** `null` : base RGE injoignable ou SIRET absent ; `[]` : aucune qualification RGE connue. */
  qualifications: QualificationImportee[] | null;
  /** Fiche contact existante du cabinet portant ce SIRET. */
  contact_id: string | null;
}

export interface ReponseRecherche {
  total: number;
  pages: number;
  rge_indisponible: boolean;
  resultats: ResultatRecherche[];
}

/** « 55208131700018 » -> « 552 081 317 00018 ». */
export function formaterSiret(siret: string): string {
  const s = (siret || '').replace(/\D/g, '');
  if (s.length !== 14) return siret || '';
  return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)} ${s.slice(9)}`;
}

// Tranches d'effectif salarié de la base SIRENE (nomenclature INSEE).
const TRANCHES_EFFECTIF: Record<string, string> = {
  NN: 'Sans salarié (non employeuse)',
  '00': '0 salarié',
  '01': '1 à 2 salariés',
  '02': '3 à 5 salariés',
  '03': '6 à 9 salariés',
  '11': '10 à 19 salariés',
  '12': '20 à 49 salariés',
  '21': '50 à 99 salariés',
  '22': '100 à 199 salariés',
  '31': '200 à 249 salariés',
  '32': '250 à 499 salariés',
  '41': '500 à 999 salariés',
  '42': '1 000 à 1 999 salariés',
  '51': '2 000 à 4 999 salariés',
  '52': '5 000 à 9 999 salariés',
  '53': '10 000 salariés et plus',
};

export function libelleEffectif(code: string | null | undefined): string | null {
  if (!code) return null;
  return TRANCHES_EFFECTIF[code.toUpperCase()] ?? null;
}

/** Adresse sans le code postal et la commune répétés en fin de ligne. */
export function rueSeule(adresse: string, codePostal: string, commune: string): string {
  let rue = (adresse || '').trim();
  for (const suffixe of [`${codePostal} ${commune}`, commune, codePostal]) {
    const s = suffixe.trim();
    if (s && rue.toLowerCase().endsWith(s.toLowerCase())) {
      rue = rue.slice(0, rue.length - s.length).trim().replace(/[,;]$/, '').trim();
    }
  }
  return rue;
}
