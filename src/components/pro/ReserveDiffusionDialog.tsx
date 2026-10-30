import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconDownload, IconSend, IconBellRinging, IconChevronDown, IconChevronRight, IconAlertTriangle } from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import { apiFetch, baseFetchJson } from '../../lib/api';
import { getAccessToken } from '../../lib/authToken';
import { applyTenantHeader } from '../../lib/activeTenant';
import type { Plan } from '../../types';
import type { AgencySettings } from '../../lib/proposalExport';
import { reservesPdfFilename, type ReservesExportProject } from '../../lib/reservesExport';
import {
  LIBELLE_STATUT, SANS_LOT, lotLabel, orderedLotTitles, selectReserves,
  type ExportSend, type ExportStatus, type LotRef,
} from '../../lib/reserveDiffusion';
import { parseJsonList } from '../../lib/jsonList';
import { cn } from '../../lib/utils';
import type { ReserveLike } from './reserveShared';

interface Props {
  kind: 'opr' | 'gpa';
  /** « Réserves » ou « Réserves GPA ». */
  title: string;
  projectId: string;
  reserves: ReserveLike[];
  plans: Plan[];
  project: ReservesExportProject;
  settings: AgencySettings;
  lots: (LotRef & { id?: string })[];
  onClose: () => void;
}

interface RecipientRow { key: string; role: 'intervenant' | 'entreprise'; name: string; detail: string; email: string; reserve_count: number; reserve_ids: string[] }
interface RecipientsResponse { reserve_count: number; intervenants: RecipientRow[]; entreprises: RecipientRow[] }
interface JournalRow {
  id: string; channel: 'telechargement' | 'mail' | 'relance'; scope: 'all' | 'lots'; lots: string[]; reserve_count: number;
  status: ExportStatus; sends: ExportSend[]; created_at: string; created_by_name?: string | null; note?: string | null;
}
interface ReminderSetting { available: boolean; enabled: boolean; interval_days: number; last_run_at: string | null }

const CANAL: Record<JournalRow['channel'], string> = { telechargement: 'Téléchargement', mail: 'Diffusion par e-mail', relance: 'Rappel automatique' };
// Couleurs de statut : ce sont des données, elles gardent leur couleur.
const COULEUR_STATUT: Record<ExportStatus, string> = {
  exporte: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  en_cours: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  envoye: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  partiel: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  echec: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};
const fmtDateHeure = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

const SECTION = 'text-xs font-bold uppercase tracking-wider text-[var(--tblr-muted)]';
const BOUTON = 'inline-flex items-center justify-center gap-2 px-4 py-2 pointer-coarse:min-h-11 rounded-lg text-sm font-bold disabled:opacity-50';

export function ReserveDiffusionDialog({ kind, title, projectId, reserves, plans, project, settings, lots, onClose }: Props) {
  const [scope, setScope] = useState<'all' | 'lots'>('all');
  const [chosenLots, setChosenLots] = useState<Set<string>>(new Set());
  const [recipients, setRecipients] = useState<RecipientsResponse | null>(null);
  const [chosenKeys, setChosenKeys] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [reminder, setReminder] = useState<ReminderSetting | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const lotsArg = useMemo(() => (scope === 'lots' ? [...chosenLots] : null), [scope, chosenLots]);
  const scopeReserves = useMemo(() => selectReserves(reserves, lotsArg), [reserves, lotsArg]);

  // Lots proposés : ceux de l'opération dans l'ordre des numéros, avec leur nombre de réserves ; « Sans lot » si besoin.
  const lotChoices = useMemo(() => {
    const parTitre = new Map(lots.map(l => [l.lot_title, l]));
    const titres = orderedLotTitles(lots);
    const inconnus = [...new Set(reserves.flatMap(r => parseJsonList(r.lots)))].filter(t => !parTitre.has(t)).sort((a, b) => a.localeCompare(b, 'fr'));
    const sansLot = reserves.some(r => parseJsonList(r.lots).length === 0);
    return [...titres, ...inconnus, ...(sansLot ? [SANS_LOT] : [])].map(titre => ({
      titre, label: parTitre.get(titre) ? lotLabel(parTitre.get(titre)!) : titre, count: selectReserves(reserves, [titre]).length,
    })).filter(l => l.count > 0);
  }, [lots, reserves]);

  const scopeLabel = scope === 'lots' && chosenLots.size > 0
    ? `Lots : ${lotChoices.filter(l => chosenLots.has(l.titre)).map(l => l.label).join(' ; ')}`
    : undefined;

  const loadJournal = useCallback(async () => {
    const rows = await apiFetch<JournalRow[]>(`/api/projects/${projectId}/reserve-exports?kind=${kind}`).catch(() => []);
    setJournal(Array.isArray(rows) ? rows : []);
  }, [projectId, kind]);

  useEffect(() => { void loadJournal(); }, [loadJournal]);
  useEffect(() => {
    apiFetch<ReminderSetting>(`/api/projects/${projectId}/reserve-reminders?kind=${kind}`).then(setReminder).catch(() => setReminder(null));
  }, [projectId, kind]);

  // Destinataires rejoués par le serveur pour le périmètre choisi.
  useEffect(() => {
    if (scope === 'lots' && chosenLots.size === 0) { setRecipients(null); return; }
    let vivant = true;
    const lotsParam = lotsArg ? `&lots=${encodeURIComponent(JSON.stringify(lotsArg))}` : '';
    apiFetch<{ reserve_count: number; intervenants: any[]; entreprises: any[] }>(`/api/projects/${projectId}/reserve-exports/recipients?kind=${kind}${lotsParam}`)
      .then(r => {
        if (!vivant) return;
        // Les réserves de chaque entreprise se déduisent de la liste (le serveur ne renvoie que leur nombre).
        const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
        const withIds = (row: any): RecipientRow => ({
          ...row,
          reserve_ids: row.role === 'entreprise'
            ? scopeReserves.filter(x => parseJsonList(x.entreprises).some(n => norm(n) === norm(row.name))).map(x => x.id)
            : scopeReserves.map(x => x.id),
        });
        const next = { ...r, intervenants: r.intervenants.map(withIds), entreprises: r.entreprises.map(withIds) };
        setRecipients(next);
        setChosenKeys(new Set([...next.intervenants, ...next.entreprises].filter(x => x.email).map(x => x.key)));
      })
      .catch(() => { if (vivant) setRecipients(null); });
    return () => { vivant = false; };
    // scopeReserves découle de reserves et lotsArg : seul le périmètre relance la lecture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, kind, scope, chosenLots]);

  const exportOptions = (extra: Record<string, unknown> = {}) => ({
    title, lots, allowedLots: lotsArg, scopeLabel, ...extra,
  });

  const telecharger = async () => {
    setMessage(null);
    setBusy('Préparation…');
    try {
      const { exportReservesToPDF } = await import('../../lib/reservesExport');
      await exportReservesToPDF(scopeReserves, plans, project, settings, { ...exportOptions(), onProgress: setBusy });
      await apiFetch(`/api/projects/${projectId}/reserve-exports`, {
        method: 'POST', body: JSON.stringify({ kind, channel: 'telechargement', lots: lotsArg }),
      }).catch(() => { /* le journal est un suivi : un échec ne doit pas faire perdre l'export */ });
      await loadJournal();
      setMessage({ text: `PDF de ${scopeReserves.length} réserve${scopeReserves.length > 1 ? 's' : ''} téléchargé.` });
    } catch (err: any) {
      console.error('[ReserveDiffusionDialog] export', err);
      setMessage({ text: "L'export a échoué.", error: true });
    } finally {
      setBusy(null);
    }
  };

  const toutesLignes = recipients ? [...recipients.intervenants, ...recipients.entreprises] : [];
  const choisis = toutesLignes.filter(r => chosenKeys.has(r.key) && r.email);

  const diffuser = async () => {
    if (!choisis.length) return;
    setMessage(null);
    setBusy('Préparation de la diffusion…');
    let ok = 0;
    let echecs = 0;
    // Premier motif d'échec renvoyé par le serveur (boîte sans SMTP, pièce jointe trop lourde, identifiants refusés...).
    let raison = '';
    try {
      const { exportReservesToPDF } = await import('../../lib/reservesExport');
      const entree = await apiFetch<JournalRow>(`/api/projects/${projectId}/reserve-exports`, {
        method: 'POST', body: JSON.stringify({ kind, channel: 'mail', lots: lotsArg, note: note.trim() || null }),
      });
      for (let i = 0; i < choisis.length; i++) {
        const dest = choisis[i];
        setBusy(`Envoi ${i + 1} / ${choisis.length} : ${dest.name}…`);
        try {
          const ids = new Set(dest.reserve_ids);
          const blob = await exportReservesToPDF(
            scopeReserves.filter(r => ids.has(r.id)), plans, project, settings,
            exportOptions({ output: 'blob', scopeLabel: dest.role === 'entreprise' ? `Entreprise : ${dest.name}` : scopeLabel }) as any,
          );
          const body = new FormData();
          body.append('file', blob, reservesPdfFilename(title, project, dest.role === 'entreprise' ? dest.name : undefined));
          body.append('key', dest.key);
          // Pas d'apiFetch : il imposerait un Content-Type JSON, or un envoi multipart laisse le navigateur poser sa limite.
          const headers = new Headers();
          const token = await getAccessToken();
          if (token) headers.set('Authorization', `Bearer ${token}`);
          applyTenantHeader(headers);
          await baseFetchJson(`/api/reserve-exports/${entree.id}/send`, { method: 'POST', body, headers });
          ok += 1;
        } catch (err: any) {
          console.error('[ReserveDiffusionDialog] envoi', dest.key, err);
          echecs += 1;
          if (!raison) raison = String(err?.message || '').trim();
        }
      }
      // Le détail de la diffusion en échec s'ouvre dans le suivi.
      if (echecs > 0) setOpen(entree.id);
      setMessage(echecs
        ? { text: `${ok} envoi${ok > 1 ? 's' : ''} réussi${ok > 1 ? 's' : ''}, ${echecs} en échec${raison ? ` : ${raison}` : ' (voir le suivi ci-dessous)'}`, error: true }
        : { text: `${ok} message${ok > 1 ? 's' : ''} envoyé${ok > 1 ? 's' : ''}.` });
    } catch (err: any) {
      console.error('[ReserveDiffusionDialog] diffusion', err);
      setMessage({ text: err?.message || 'La diffusion a échoué.', error: true });
    } finally {
      setBusy(null);
      await loadJournal();
    }
  };

  const basculerRappel = async (enabled: boolean) => {
    setMessage(null);
    try {
      setReminder(await apiFetch<ReminderSetting>(`/api/projects/${projectId}/reserve-reminders`, { method: 'PUT', body: JSON.stringify({ kind, enabled }) }));
    } catch (err: any) {
      setMessage({ text: err?.message || "Le rappel automatique n'a pas pu être modifié.", error: true });
    }
  };

  const toggleLot = (titre: string) => setChosenLots(prev => {
    const next = new Set(prev);
    if (next.has(titre)) next.delete(titre); else next.add(titre);
    return next;
  });
  const toggleKey = (key: string) => setChosenKeys(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const scopeVide = scope === 'lots' && chosenLots.size === 0;

  const ligne = (r: RecipientRow) => (
    <label key={r.key} className="flex items-start gap-3 py-2 min-h-11 cursor-pointer">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--tblr-primary)]" checked={chosenKeys.has(r.key)} disabled={!r.email || !!busy} onChange={() => toggleKey(r.key)} />
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-medium text-[var(--tblr-text)]">{r.name}</span>
        <span className="text-[var(--tblr-muted)]"> · {r.detail} · {r.reserve_count} réserve{r.reserve_count > 1 ? 's' : ''}</span>
        <span className={cn('block text-xs', r.email ? 'text-[var(--tblr-muted)]' : 'text-red-600')}>{r.email || "Pas d'adresse e-mail valable : ajoutez-la sur la fiche du contact."}</span>
      </span>
    </label>
  );

  return (
    <ModalShell
      title="Diffusion et export"
      subtitle={`${title} · ${project.name}`}
      size="xl"
      onClose={onClose}
      busy={!!busy}
      bodyClassName="p-4 sm:p-6"
      footer={<button type="button" onClick={onClose} disabled={!!busy} className={cn(BOUTON, 'border border-[var(--tblr-border)] text-[var(--tblr-text)]')}>Fermer</button>}
    >
      <div className="space-y-6">
        {message && (
          <div role="status" className={cn('px-3 py-2 rounded-lg text-sm font-medium', message.error ? 'bg-red-50 text-red-700 dark:bg-red-950/20' : 'bg-[var(--tblr-surface-2)] text-[var(--tblr-text)]')}>
            {message.text}
          </div>
        )}
        {busy && <div role="status" className="text-sm text-[var(--tblr-muted)]">{busy}</div>}

        {/* 1. Périmètre */}
        <section className="space-y-2">
          <h3 className={SECTION}>Périmètre</h3>
          <label className="flex items-center gap-2 min-h-11 text-sm cursor-pointer">
            <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} className="accent-[var(--tblr-primary)]" />
            Ensemble de la liste ({reserves.length} réserve{reserves.length > 1 ? 's' : ''})
          </label>
          <label className="flex items-center gap-2 min-h-11 text-sm cursor-pointer">
            <input type="radio" name="scope" checked={scope === 'lots'} onChange={() => setScope('lots')} className="accent-[var(--tblr-primary)]" />
            Choisir les lots
          </label>
          {scope === 'lots' && (
            <div className="ml-6 grid gap-x-4 sm:grid-cols-2">
              {lotChoices.length === 0 && <p className="text-sm text-[var(--tblr-muted)]">Aucune réserve n'est rattachée à un lot.</p>}
              {lotChoices.map(l => (
                <label key={l.titre} className="flex items-center gap-2 min-h-11 text-sm cursor-pointer">
                  <input type="checkbox" checked={chosenLots.has(l.titre)} onChange={() => toggleLot(l.titre)} className="h-4 w-4 accent-[var(--tblr-primary)]" />
                  <span className="min-w-0 flex-1 truncate">{l.label}</span>
                  <span className="text-xs text-[var(--tblr-muted)]">{l.count}</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-[var(--tblr-muted)]">Le PDF est classé par lot, dans l'ordre des numéros de lot.</p>
        </section>

        {/* 2. Export */}
        <section className="space-y-2">
          <h3 className={SECTION}>Export</h3>
          <button type="button" onClick={telecharger} disabled={!!busy || scopeVide || scopeReserves.length === 0} className={cn(BOUTON, 'border border-[var(--tblr-border)] text-[var(--tblr-text)]')}>
            <IconDownload size={16} /> Télécharger le PDF ({scopeReserves.length})
          </button>
        </section>

        {/* 3. Diffusion */}
        <section className="space-y-2">
          <h3 className={SECTION}>Diffusion par e-mail</h3>
          <p className="text-xs text-[var(--tblr-muted)]">Les intervenants reçoivent le rapport complet, chaque entreprise ses seules réserves. Un message par destinataire.</p>
          {scopeVide && <p className="text-sm text-[var(--tblr-muted)]">Choisissez au moins un lot.</p>}
          {recipients && toutesLignes.length === 0 && <p className="text-sm text-[var(--tblr-muted)]">Aucun destinataire : renseignez les intervenants de l'opération et les entreprises en charge des réserves.</p>}
          {recipients && recipients.intervenants.length > 0 && (
            <div>
              <div className="text-sm font-bold text-[var(--tblr-text)] mt-2">Intervenants (rapport complet)</div>
              <div className="divide-y divide-[var(--tblr-border)]">{recipients.intervenants.map(ligne)}</div>
            </div>
          )}
          {recipients && recipients.entreprises.length > 0 && (
            <div>
              <div className="text-sm font-bold text-[var(--tblr-text)] mt-2">Entreprises (leurs réserves)</div>
              <div className="divide-y divide-[var(--tblr-border)]">{recipients.entreprises.map(ligne)}</div>
            </div>
          )}
          {toutesLignes.length > 0 && (
            <>
              <label className="block text-xs font-bold text-[var(--tblr-muted)]" htmlFor="reserve-diffusion-note">Message complémentaire (facultatif)</label>
              <textarea id="reserve-diffusion-note" value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={3} disabled={!!busy}
                className="w-full rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] p-2 text-sm text-[var(--tblr-text)]" />
              <button type="button" onClick={diffuser} disabled={!!busy || choisis.length === 0} className={BOUTON} style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
                <IconSend size={16} /> Envoyer à {choisis.length} destinataire{choisis.length > 1 ? 's' : ''}
              </button>
            </>
          )}
        </section>

        {/* 4. Rappels automatiques */}
        <section className="space-y-2">
          <h3 className={SECTION}>Rappels automatiques</h3>
          {reminder && !reminder.available ? (
            <p className="text-sm text-[var(--tblr-muted)]">Non disponible sur cette instance (migration à appliquer).</p>
          ) : (
            <label className="flex items-start gap-3 min-h-11 cursor-pointer">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--tblr-primary)]" checked={!!reminder?.enabled} disabled={!reminder} onChange={e => basculerRappel(e.target.checked)} />
              <span className="text-sm">
                <span className="font-medium text-[var(--tblr-text)] inline-flex items-center gap-1"><IconBellRinging size={14} /> Rappel hebdomadaire des réserves non levées</span>
                <span className="block text-xs text-[var(--tblr-muted)]">
                  Chaque semaine, chaque entreprise reçoit la liste de ses réserves non levées, en retard d'abord, tant qu'il en reste.
                  {reminder?.last_run_at ? ` Dernier passage : ${fmtDateHeure(reminder.last_run_at)}.` : ''}
                </span>
              </span>
            </label>
          )}
        </section>

        {/* 5. Journal */}
        <section className="space-y-2">
          <h3 className={SECTION}>Suivi des exports et diffusions</h3>
          {journal.length === 0 && <p className="text-sm text-[var(--tblr-muted)]">Aucun export pour le moment.</p>}
          <ul className="divide-y divide-[var(--tblr-border)] border border-[var(--tblr-border)] rounded-lg">
            {journal.map(j => {
              const ouvert = open === j.id;
              const aDetail = j.sends.length > 0;
              return (
                <li key={j.id} className="px-3 py-2">
                  <button type="button" onClick={() => setOpen(ouvert ? null : j.id)} disabled={!aDetail} aria-expanded={aDetail ? ouvert : undefined}
                    className="w-full flex items-center gap-2 text-left min-h-11 disabled:cursor-default">
                    {aDetail ? (ouvert ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />) : <span className="w-3.5" />}
                    <span className="flex-1 min-w-0 text-sm">
                      <span className="font-medium text-[var(--tblr-text)]">{CANAL[j.channel]}</span>
                      <span className="text-[var(--tblr-muted)]"> · {fmtDateHeure(j.created_at)}{j.created_by_name ? ` · ${j.created_by_name}` : ''}</span>
                      <span className="block text-xs text-[var(--tblr-muted)] truncate">
                        {j.scope === 'lots' ? `Lots : ${j.lots.join(' ; ')}` : 'Ensemble de la liste'} · {j.reserve_count} réserve{j.reserve_count > 1 ? 's' : ''}
                      </span>
                    </span>
                    <span className={cn('px-2 py-0.5 rounded-full text-[0.6875rem] font-bold whitespace-nowrap', COULEUR_STATUT[j.status])}>{LIBELLE_STATUT[j.status]}</span>
                  </button>
                  {ouvert && (
                    <ul className="ml-6 mb-1 space-y-1">
                      {j.sends.map(s => (
                        <li key={s.key} className="text-xs flex items-start gap-2">
                          {s.status === 'echec' && <IconAlertTriangle size={12} className="mt-0.5 text-red-600 shrink-0" aria-label="Échec" />}
                          <span className="text-[var(--tblr-text)]">
                            {s.name} <span className="text-[var(--tblr-muted)]">({s.role === 'entreprise' ? 'entreprise' : 'intervenant'}, {s.reserve_count} réserve{s.reserve_count > 1 ? 's' : ''}) · {s.email || 'sans adresse'} · {s.status === 'envoye' ? 'envoyé' : 'échec'} le {fmtDateHeure(s.sent_at)}</span>
                            {s.error && <span className="block text-red-600">{s.error}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </ModalShell>
  );
}
