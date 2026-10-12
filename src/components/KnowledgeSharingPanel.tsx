import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { Contribution, Publication } from '../lib/knowledgeSharingView';
import { REPEATED_FAILURE_ATTEMPTS } from '../lib/knowledgeSharingView';
import { HowItWorks } from './knowledgeSharing/HowItWorks';
import { AutoSettings, type AutoState } from './knowledgeSharing/AutoSettings';
import { Journal } from './knowledgeSharing/Journal';
import { ManualShare } from './knowledgeSharing/ManualShare';

interface CandidateDocument { id: string; name: string }
interface State {
  opted_in: boolean; contributions: Contribution[]; publications: Publication[];
  publication_active: boolean; auto: AutoState;
}

const NO_AUTO: AutoState = { enabled: false, categories: [], available: [], daily_cap: 25 };

/**
 * Mémoire technique collective. L'écran dit d'abord ce qui se passe (parcours d'un
 * document), demande deux autorisations distinctes, puis tient un journal de chaque
 * document avec le texte exact qui part et un retrait en un clic.
 */
export function KnowledgeSharingPanel({ documents }: { documents: CandidateDocument[] }) {
  const [state, setState] = useState<State | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [mistralStatus, setMistralStatus] = useState('');

  const refresh = async () => {
    const data = await apiFetch<State>('/api/knowledge-sharing');
    setState({ ...data, auto: data.auto ?? NO_AUTO });
  };
  useEffect(() => {
    refresh().catch((e: any) => {
      if (e?.status === 403) setHidden(true); // réservé aux administrateurs
      else setError('Bibliothèque commune indisponible : ' + e.message);
    });
  }, []);
  // Tant que des documents sont en cours de traitement, l'écran se met à jour seul.
  const working = !!state?.contributions.some(c => c.status === 'queued' || c.status === 'analyzing');
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => { refresh().catch(() => undefined); }, 15000);
    return () => clearInterval(timer);
  }, [working]);
  if (hidden) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); await refresh(); }
    catch (e: any) { setError(e.message || 'Erreur'); }
    finally { setBusy(false); }
  };

  const consent = (enabled: boolean) => {
    if (!enabled && !window.confirm('Retirer l’autorisation ? Les extraits non envoyés seront effacés et ceux déjà envoyés retirés de Mistral.')) return;
    void run(async () => {
      const response = await apiFetch<{ pending_deletions?: number }>('/api/knowledge-sharing/consent', {
        method: 'PUT', body: JSON.stringify({ opted_in: enabled }),
      });
      setNotice(enabled ? '' : response.pending_deletions
        ? response.pending_deletions + ' suppression(s) distante(s) en attente de confirmation chez Mistral.'
        : 'Autorisation retirée ; aucune suppression distante en attente.');
    });
  };
  const enableAuto = (categories: string[]) => void run(async () => {
    await apiFetch('/api/knowledge-sharing/auto', {
      method: 'PUT', body: JSON.stringify({ enabled: true, categories, confirmed_ai_review: true }),
    });
    setNotice('Partage automatique activé pour : ' + categories.join(', ') + '. Les prochains documents de ces types seront traités.');
  });
  const disableAuto = () => {
    if (!window.confirm('Désactiver le partage automatique ? Ce qui n’est pas encore parti sera supprimé.')) return;
    void run(async () => {
      await apiFetch('/api/knowledge-sharing/auto', { method: 'PUT', body: JSON.stringify({ enabled: false }) });
      setNotice('Partage automatique désactivé.');
    });
  };
  const backfill = () => void run(async () => {
    const result = await apiFetch<{ examined: number; queued: number }>('/api/knowledge-sharing/auto/backfill', { method: 'POST' });
    setNotice(result.queued + ' document(s) mis en file sur ' + result.examined + ' examiné(s).');
  });
  const remove = (c: Contribution) => {
    const name = documents.find(d => d.id === c.document_id)?.name || 'ce document';
    const sent = state?.publications.some(p => p.contribution_id === c.id);
    if (!window.confirm(sent ? `Retirer de la bibliothèque Mistral le texte issu de « ${name} » ?` : `Supprimer l’extrait préparé de « ${name} » ?`)) return;
    void run(async () => {
      const result = await apiFetch<{ pending_deletions?: number }>('/api/knowledge-sharing/contributions/' + c.id, { method: 'DELETE' });
      setNotice(result.pending_deletions ? 'Retrait en cours chez Mistral ; il est retenté automatiquement.' : 'Extrait supprimé.');
    });
  };
  const retry = () => void run(async () => {
    const result = await apiFetch<{ pending: number; reconciled_uploads: number; uncertain_uploads: number; abandoned_uploads?: number }>(
      '/api/knowledge-sharing/mistral/reconcile', { method: 'POST' });
    setNotice([
      result.pending ? 'Des suppressions restent en attente.' : '',
      result.uncertain_uploads ? result.uncertain_uploads + ' transfert(s) non confirmé(s) nécessitent une vérification.' : '',
      result.abandoned_uploads ? result.abandoned_uploads + ' envoi(s) abandonné(s) faute de document distant ; supprimez l’extrait pour le republier.' : '',
      result.reconciled_uploads + ' transfert(s) retrouvé(s) dans Mistral.',
    ].filter(Boolean).join(' '));
  });
  const checkMistral = async () => {
    setMistralStatus('Vérification en cours…');
    try {
      const result = await apiFetch<{ connected: boolean; configured: boolean }>('/api/knowledge-sharing/mistral/status');
      setMistralStatus(result.connected ? 'Liaison avec la bibliothèque Mistral opérationnelle.'
        : result.configured ? 'Bibliothèque Mistral inaccessible.' : 'Bibliothèque Mistral non configurée sur cette instance.');
    } catch { setMistralStatus('Connexion Mistral non disponible. Vérifiez la clé et les droits de la bibliothèque.'); }
  };

  const nameOf = (id: string) => documents.find(d => d.id === id)?.name || 'Document supprimé de la GED';
  const needsCheck = !!state?.publications.some(p => (p.state !== 'deleted' && p.deletion_requested_at) || p.state === 'uncertain');
  const stuck = !!state?.publications.some(p => p.state !== 'deleted' && (p.delete_attempts ?? 0) >= REPEATED_FAILURE_ATTEMPTS);
  const held = state?.contributions.filter(c => c.status === 'held').length ?? 0;

  return <section className="rounded-xl border p-4 space-y-4" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}>
    <div>
      <h2 className="font-semibold">Mémoire technique collective</h2>
      <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
        Partagez, de façon anonyme, les prescriptions techniques de vos CCTP et notices avec les autres cabinets.
        Vos documents d’origine restent privés.
      </p>
    </div>

    {error && <p role="alert" className="text-sm" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {stuck && <p role="alert" className="text-sm" style={{ color: 'var(--tblr-danger)' }}>
      Une suppression chez Mistral échoue de façon répétée. Les tentatives automatiques s’espacent ; relancez la vérification, puis contactez le support si le message persiste.
    </p>}

    {state && <>
      <HowItWorks publicationActive={state.publication_active} />
      <AutoSettings optedIn={state.opted_in} auto={state.auto} busy={busy}
        onConsent={consent} onEnableAuto={enableAuto} onDisableAuto={disableAuto} onBackfill={backfill} />

      {state.opted_in && <>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-sm">Documents analysés et partagés</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {held > 0 && <span style={{ color: 'var(--tblr-muted)' }}>{held} retenu{held > 1 ? 's' : ''}</span>}
              {needsCheck && <button type="button" className="btn btn-secondary" disabled={busy} onClick={retry}>Vérifier les transferts et suppressions Mistral</button>}
            </div>
          </div>
          <Journal contributions={state.contributions} publications={state.publications} nameOf={nameOf}
            publicationActive={state.publication_active} busy={busy} onRemove={remove} />
        </div>

        <ManualShare documents={documents} contributions={state.contributions} publications={state.publications}
          publicationActive={state.publication_active} busy={busy} run={run} setNotice={setNotice} />

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="btn btn-ghost" onClick={() => void checkMistral()}>Vérifier la liaison avec Mistral</button>
          {mistralStatus && <span role="status">{mistralStatus}</span>}
        </div>
      </>}
    </>}
  </section>;
}
