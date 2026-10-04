import { useCallback, useEffect, useMemo, useState } from 'react';
import { sortPhaseNotes, summarizeByPhase, type PhaseNote } from '../lib/phaseJournal';

export type PhaseNoteInput = Pick<PhaseNote, 'phase' | 'kind' | 'body' | 'occurred_on'> & {
  budget_before?: number | null;
  budget_after?: number | null;
};

export interface PhaseNotesApi {
  notes: PhaseNote[];
  summary: ReturnType<typeof summarizeByPhase>;
  loading: boolean;
  /** Message d'erreur du dernier enregistrement refusé, à afficher près du formulaire. */
  create: (input: PhaseNoteInput) => Promise<{ ok: true } | { ok: false; error: string }>;
  update: (id: string, input: Partial<PhaseNoteInput>) => Promise<{ ok: true } | { ok: false; error: string }>;
  remove: (id: string) => Promise<boolean>;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error || fallback;
}

/** Journal de l'opération d'une affaire (server/routes/projectPhaseNotes.ts). */
export function usePhaseNotes(projectId: string | undefined, fallbackError: string): PhaseNotesApi {
  const [notes, setNotes] = useState<PhaseNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/projects/${projectId}/phase-notes`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => { if (!cancelled) setNotes(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setNotes([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const create = useCallback<PhaseNotesApi['create']>(async input => {
    try {
      const res = await fetch(`/api/projects/${projectId}/phase-notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      if (!res.ok) return { ok: false, error: await errorOf(res, fallbackError) };
      const created: PhaseNote = await res.json();
      setNotes(prev => [created, ...prev]);
      return { ok: true };
    } catch {
      return { ok: false, error: fallbackError };
    }
  }, [projectId, fallbackError]);

  const update = useCallback<PhaseNotesApi['update']>(async (id, input) => {
    try {
      const res = await fetch(`/api/phase-notes/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      if (!res.ok) return { ok: false, error: await errorOf(res, fallbackError) };
      const updated: PhaseNote = await res.json();
      setNotes(prev => prev.map(n => (n.id === id ? updated : n)));
      return { ok: true };
    } catch {
      return { ok: false, error: fallbackError };
    }
  }, [fallbackError]);

  const remove = useCallback<PhaseNotesApi['remove']>(async id => {
    try {
      const res = await fetch(`/api/phase-notes/${id}`, { method: 'DELETE' });
      if (!res.ok) return false;
      setNotes(prev => prev.filter(n => n.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  const sorted = useMemo(() => sortPhaseNotes(notes), [notes]);
  const summary = useMemo(() => summarizeByPhase(notes), [notes]);
  return { notes: sorted, summary, loading, create, update, remove };
}
