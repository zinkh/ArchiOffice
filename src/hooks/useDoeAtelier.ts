// Données de l'atelier DOE (onglet AOR) : l'état de l'opération lu sur
// GET /api/projects/:id/doe et les gestes du cabinet (solliciter, relancer,
// donner un avis, analyser, viser, archiver). Un geste réussi relit l'état :
// le statut d'une entreprise se déduit côté serveur, l'écran ne le recalcule pas.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import type {
  Couverture, DoeAvisDocument, DoeAvisVisa, DoePieceKey, DoeStatut, SyntheseDoe, AnomalieDoe, ClassementPiece,
} from '../lib/doeAtelier';

export interface DoeDocumentVue {
  id: string;
  name: string;
  doe_piece: DoePieceKey | null;
  doe_lot_id: string | null;
  doe_source: 'entreprise' | 'cabinet' | null;
  validation_status: DoeAvisDocument;
  validation_comments: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
  size_bytes: number | null;
  file_url: string;
  contact_id: string | null;
}

export interface DoeVisaVue {
  id: string;
  numero: string;
  avis: DoeAvisVisa;
  observations: string | null;
  issued_at: string;
  issued_by_name: string | null;
  sent_at: string | null;
  document_id: string | null;
  file_url: string | null;
}

export interface DoeDemandeVue {
  id: string;
  email: string | null;
  expires_at: string;
  last_opened_at: string | null;
  sent_at: string | null;
  last_reminder_at: string | null;
  reminder_count: number;
}

export interface DoeEntrepriseVue {
  key: string;
  nom: string;
  contact_id: string | null;
  email: string | null;
  lots: Array<{ id: string; lot_number: string; lot_title: string }>;
  request: DoeDemandeVue | null;
  statut: DoeStatut;
  couverture: Couverture;
  avis_suggere: DoeAvisVisa;
  prochaine_relance: string | null;
  documents: DoeDocumentVue[];
  visa: DoeVisaVue | null;
  visas: DoeVisaVue[];
}

export interface DoeReglagesVue {
  deadline_at: string | null;
  instructions: string | null;
  required_pieces: DoePieceKey[] | null;
  reminder_enabled: boolean;
  reminder_interval_days: number;
  reminder_max: number;
}

export interface DoeArchiveVue {
  id: string;
  name: string;
  size_bytes: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
  file_url: string;
}

export interface DoeEtat {
  disponible: boolean;
  reglages: DoeReglagesVue;
  requises: DoePieceKey[];
  synthese: SyntheseDoe;
  archive_prete: boolean;
  entreprises: DoeEntrepriseVue[];
  non_affectes: DoeDocumentVue[];
  archives: DoeArchiveVue[];
  moa: { nom: string | null; email: string | null };
}

export interface ResultatAnalyseDoc {
  id: string;
  name: string;
  classement: ClassementPiece | null;
  anomalies: AnomalieDoe[];
  caracteres: number | null;
  doe_piece: DoePieceKey | null;
  classement_applique: boolean;
}

export interface ReponseArchive {
  document: { id: string; name: string; size_bytes: number | null; uploaded_at: string; file_url: string };
  fichiers: number;
  ignores: string[];
  reserves: string[];
  envoye: boolean;
  raison?: string;
}

const json = (corps: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(corps) });

export function useDoeAtelier(projectId: string) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/doe`;
  const [etat, setEtat] = useState<DoeEtat | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  // Une relecture lancée avant un geste et revenue après ne doit pas écraser l'état plus récent.
  const sequence = useRef(0);

  const recharger = useCallback(async () => {
    const numero = ++sequence.current;
    try {
      const lu = await apiFetch<DoeEtat>(base);
      if (numero === sequence.current) { setEtat(lu); setErreur(null); }
    } catch (e: any) {
      if (numero === sequence.current) setErreur(e?.message || 'Lecture impossible.');
    } finally {
      if (numero === sequence.current) setChargement(false);
    }
  }, [base]);

  useEffect(() => {
    if (!projectId) return;
    setChargement(true);
    void recharger();
  }, [projectId, recharger]);

  /** Exécute un geste puis relit l'état, même en cas d'échec (le serveur a pu agir en partie). */
  const geste = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } finally {
      await recharger();
    }
  }, [recharger]);

  return {
    etat, chargement, erreur, recharger,

    solliciter: (key: string, mode: 'sollicitation' | 'relance' | 'lien', email?: string) =>
      geste(() => apiFetch<{ ok: boolean; envoye: boolean; url?: string; demande: DoeDemandeVue }>(
        `${base}/requests`, json({ entreprise_key: key, mode, email }))),

    toutSolliciter: () =>
      geste(() => apiFetch<{ envoyees: string[]; sans_adresse: string[]; echecs: Array<{ entreprise: string; raison?: string }> }>(
        `${base}/requests/tout-solliciter`, json({}))),

    revoquerLien: (id: string) => geste(() => apiFetch(`${base}/requests/${encodeURIComponent(id)}`, { method: 'DELETE' })),

    enregistrerReglages: (r: Partial<DoeReglagesVue>) =>
      geste(() => apiFetch(`${base}/settings`, { method: 'PUT', body: JSON.stringify(r) })),

    modifierDocument: (id: string, maj: { doe_piece?: DoePieceKey | null; validation_status?: DoeAvisDocument; validation_comments?: string | null; entreprise_key?: string }) =>
      geste(() => apiFetch(`/api/doe/documents/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(maj) })),

    supprimerDocument: (id: string) => geste(() => apiFetch(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })),

    deposerDocument: (key: string, fichier: File, piece: DoePieceKey | '', lotId: string) =>
      geste(async () => {
        const form = new FormData();
        form.append('file', fichier);
        form.append('entreprise_key', key);
        if (piece) form.append('doe_piece', piece);
        if (lotId) form.append('lot_id', lotId);
        // fetch global : l'intercepteur pose le jeton et le cabinet actif, et le navigateur fixe la frontière multipart.
        const res = await fetch(`${base}/documents`, { method: 'POST', body: form });
        const corps = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(corps?.error || res.statusText);
        return corps;
      }),

    analyser: (key: string) =>
      geste(() => apiFetch<{ resultats: ResultatAnalyseDoc[] }>(`${base}/analyser`, json({ entreprise_key: key }))),

    emettreVisa: (key: string, avis: DoeAvisVisa, observations: string, envoyer: boolean, email?: string) =>
      geste(() => apiFetch<{ visa: DoeVisaVue; envoye: boolean; raison?: string }>(
        `${base}/visas`, json({ entreprise_key: key, avis, observations, envoyer, email }))),

    archiver: (opts: {
      destinataire?: string; envoyer: boolean; inclure_plans: boolean; plans_tous: boolean;
      inclure_non_vises: boolean; confirmer_partiel: boolean;
    }) => geste(() => apiFetch<ReponseArchive>(`${base}/archive`, json(opts))),
  };
}

export type DoeAtelierApi = ReturnType<typeof useDoeAtelier>;
