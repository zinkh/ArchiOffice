// Modèle unifié "référence" (affaire du cabinet ou référence saisie à la
// main), partagé entre la bibliothèque de références (src/pages/References.tsx)
// et le sélecteur de références d'un appel d'offres
// (TenderDetail.tsx → onglet Références) — un seul endroit qui sait
// transformer un Project/CustomRef en RefItem affichable.
import type { Project } from '../types';

export interface Cotraitant {
  id: string;
  name: string;
  remuneration: number | null;
  fee_share: number | null; // % répartition d'honoraires
}

export interface RefImage {
  id: string;
  url: string;
  is_primary: boolean;
}

export interface CustomRef {
  id: string;
  name: string;
  client: string;
  category: string;
  end_date: string | null;
  surface: number | null;
  budget: number | null;
  status: string;
  description: string;
  image_url: string | null;
  location: string;
  start_date: string | null;
  project_manager: string;
  construction_cost: number | null;
  remuneration: number | null;
  fee_rate: number | null;
  progression: number | null;
  custom_data: Record<string, string>;
  cotraitants: Cotraitant[];
  images: RefImage[];
}

export interface RefItem {
  id: string;
  name: string;
  client: string;
  category: string;
  end_date: string | null;
  surface: number | null;
  budget: number | null;
  status: string;
  image_url: string | null;
  project_code?: string;
  source: 'project' | 'manual';
}

export function toRefItem(p: Project): RefItem {
  return { id: p.id, name: p.name, client: p.client, category: p.category || 'Non classé', end_date: p.end_date || null, surface: (p as any).surface ?? null, budget: p.budget ?? null, status: p.status, image_url: (p as any).image_url ?? null, project_code: (p as any).project_code, source: 'project' };
}

export function customToRefItem(r: CustomRef): RefItem {
  const primary = r.images?.find(im => im.is_primary) || r.images?.[0];
  return { id: r.id, name: r.name, client: r.client || '', category: r.category || 'Non classé', end_date: r.end_date, surface: r.surface, budget: r.budget, status: r.status, image_url: primary?.url || r.image_url, source: 'manual' };
}
