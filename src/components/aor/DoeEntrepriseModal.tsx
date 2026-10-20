// Dossier d'UNE entreprise dans l'atelier DOE : suivi de la demande et des
// relances, pièces attendues, documents reçus à analyser (pièce, avis,
// observations, anomalies relevées), visas émis. C'est ici que l'architecte fait
// pour le DOE ce que l'onglet VISA fait pour les documents d'exécution : un avis
// par document, puis un visa sur le dossier.
//
// L'analyse automatique SUGGÈRE (pièce reconnue, scan, doublon...) ; l'avis sur
// un document n'est jamais posé par elle.
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconCheck, IconExternalLink, IconFilePlus, IconLink, IconMessageDots, IconRubberStamp, IconScanEye, IconSend,
  IconTrash, IconX,
} from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import { openSignedUrl } from '../../lib/signedStorageUrl';
import { formatOctets } from '../../lib/consultationDepot';
import {
  DOE_ANOMALIE_LABELS, DOE_PIECES, piecesRequises, pieceConnue,
  type DoeAvisDocument, type DoePieceKey, type DoeStatut,
} from '../../lib/doeAtelier';
import type { DoeAtelierApi, DoeDocumentVue, DoeEntrepriseVue, ResultatAnalyseDoc } from '../../hooks/useDoeAtelier';
import { CHAMP_DOE, usePieceLabel } from './DoeDialogs';
import { TOUCH_TARGET } from '../chantier/fields';
import { cn } from '../../lib/utils';

export const STATUT_STYLE: Record<DoeStatut, string> = {
  a_solliciter: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  sollicitee: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  partiel: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  a_analyser: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  a_corriger: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  conforme: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  vise: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

export function StatutDoe({ statut }: { statut: DoeStatut }) {
  const { t } = useTranslation();
  return (
    <span className={cn('inline-flex px-2 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider whitespace-nowrap', STATUT_STYLE[statut])}>
      {t(`doe_statut_${statut}`)}
    </span>
  );
}

const AVIS_STYLE: Record<DoeAvisDocument, string> = {
  pending: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  commented: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const dateFr = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

interface Props {
  entreprise: DoeEntrepriseVue;
  api: DoeAtelierApi;
  onClose: () => void;
  onVisa: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}

export function DoeEntrepriseModal({ entreprise, api, onClose, onVisa, notify }: Props) {
  const { t } = useTranslation();
  const labelPiece = usePieceLabel();
  const { confirm, dialog } = useConfirmDialog();
  const champFichier = useRef<HTMLInputElement>(null);
  const [pieceDepot, setPieceDepot] = useState<DoePieceKey | ''>('');
  const [lotDepot, setLotDepot] = useState('');
  const [occupe, setOccupe] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Map<string, ResultatAnalyseDoc>>(new Map());

  const requises = api.etat?.requises ?? piecesRequises();
  const c = entreprise.couverture;
  const demande = entreprise.request;

  /** Un geste du cabinet : indicateur d'occupation, toast d'échec. */
  const agir = async (id: string, action: () => Promise<unknown>, succes?: string) => {
    setOccupe(id);
    try {
      await action();
      if (succes) notify(succes);
    } catch (e: any) {
      notify(e?.message || t('doe_error_generic'), 'error');
    } finally {
      setOccupe(null);
    }
  };

  const solliciter = (mode: 'sollicitation' | 'relance') => agir(mode, async () => {
    const r = await api.solliciter(entreprise.key, mode);
    if (r.envoye) notify(t(mode === 'relance' ? 'doe_reminder_sent' : 'doe_request_sent', { email: r.demande.email ?? '' }));
  });

  const copierLien = () => agir('lien', async () => {
    const r = await api.solliciter(entreprise.key, 'lien');
    if (!r.url) return;
    try {
      await navigator.clipboard.writeText(r.url);
      notify(t('doe_link_copied'));
    } catch {
      window.prompt(t('doe_link_copy_manual'), r.url);
    }
  });

  const analyser = () => agir('analyse', async () => {
    const r = await api.analyser(entreprise.key);
    setAnalyses(new Map(r.resultats.map(x => [x.id, x])));
    notify(t('doe_analysis_done', { count: r.resultats.length }));
  });

  const deposer = (fichiers: FileList | null) => {
    const f = fichiers?.[0];
    if (!f) return;
    void agir('depot', () => api.deposerDocument(entreprise.key, f, pieceDepot, lotDepot), t('doe_document_added'))
      .finally(() => { if (champFichier.current) champFichier.current.value = ''; });
  };

  const supprimer = async (d: DoeDocumentVue) => {
    const ok = await confirm({
      title: t('doe_delete_title', { name: d.name }), message: t('projectdetail_delete_is_final'),
      confirmLabel: t('projectdetail_dialog_delete'), cancelLabel: t('projectdetail_dialog_cancel'), tone: 'danger',
    });
    if (ok) void agir(`del-${d.id}`, () => api.supprimerDocument(d.id));
  };

  const pieces: DoePieceKey[] = [
    ...DOE_PIECES.map(p => p.key).filter(k => requises.includes(k) || entreprise.documents.some(d => d.doe_piece === k)),
  ];
  const etatPiece = (k: DoePieceKey) =>
    c.manquantes.includes(k) ? 'missing' : c.validees.includes(k) ? 'ok' : c.enAttente.includes(k) ? 'wait' : entreprise.documents.some(d => d.doe_piece === k) ? 'wait' : 'optional';

  const peutRelancer = !!(entreprise.email || demande?.email);

  return (
    <ModalShell
      size="xl"
      title={entreprise.nom}
      subtitle={entreprise.lots.map(l => `Lot ${l.lot_number} ${l.lot_title}`).join(' ; ') || t('doe_no_lot')}
      onClose={onClose}
      busy={occupe !== null}
      bodyClassName="p-4 sm:p-6 space-y-6"
      headerActions={<StatutDoe statut={entreprise.statut} />}
    >
      {/* Demande et relances */}
      <section aria-label={t('doe_request_section')} className="space-y-3">
        <div className="text-sm space-y-0.5 text-[var(--tblr-muted)]">
          <p>{entreprise.email ? t('doe_contact_email', { email: entreprise.email }) : t('doe_contact_no_email')}</p>
          {demande?.sent_at && <p>{t('doe_request_sent_on', { date: dateFr(demande.sent_at) })}{demande.last_opened_at ? ` · ${t('doe_link_opened_on', { date: dateFr(demande.last_opened_at) })}` : ''}</p>}
          {!!demande?.reminder_count && <p>{t('doe_reminders_count', { count: demande.reminder_count, date: dateFr(demande.last_reminder_at) })}</p>}
          {entreprise.prochaine_relance && <p>{t('doe_next_reminder', { date: dateFr(entreprise.prochaine_relance) })}</p>}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap [&>.btn]:justify-center [&>.btn]:pointer-coarse:min-h-11">
          {entreprise.statut === 'a_solliciter' || !demande?.sent_at ? (
            <button type="button" className="btn btn-primary" disabled={occupe !== null || !peutRelancer} onClick={() => solliciter('sollicitation')}>
              <IconSend size={15} aria-hidden /> {t('doe_request_send')}
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" disabled={occupe !== null} onClick={() => solliciter('relance')}>
              <IconSend size={15} aria-hidden /> {t('doe_reminder_send')}
            </button>
          )}
          <button type="button" className="btn btn-secondary" disabled={occupe !== null} onClick={copierLien}>
            <IconLink size={15} aria-hidden /> {t('doe_link_copy')}
          </button>
          {demande && (
            <button type="button" className="btn btn-ghost" disabled={occupe !== null}
              onClick={() => agir('revoque', () => api.revoquerLien(demande.id), t('doe_link_revoked'))}>
              {t('doe_link_revoke')}
            </button>
          )}
        </div>
        {!peutRelancer && <p className="text-xs text-amber-700 dark:text-amber-300">{t('doe_no_email_hint')}</p>}
      </section>

      {/* Pièces attendues */}
      <section aria-label={t('doe_pieces_section')} className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wider">{t('doe_pieces_section')}</h3>
        <ul className="divide-y divide-[var(--tblr-border)] rounded-lg border border-[var(--tblr-border)]">
          {pieces.map(k => {
            const e = etatPiece(k);
            const n = entreprise.documents.filter(d => d.doe_piece === k).length;
            return (
              <li key={k} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="flex-1 basis-56 min-w-0 font-medium">{labelPiece(k)}{!requises.includes(k) && <span className="text-xs font-normal text-[var(--tblr-muted)]"> ({t('doe_optional')})</span>}</span>
                <span className="text-xs text-[var(--tblr-muted)]">{t('doe_documents_count', { count: n })}</span>
                <span className={cn('px-2 py-0.5 rounded-full text-[0.6875rem] font-bold uppercase',
                  e === 'ok' ? AVIS_STYLE.approved : e === 'missing' ? AVIS_STYLE.rejected : AVIS_STYLE.pending)}>
                  {t(`doe_piece_state_${e}`)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Documents reçus */}
      <section aria-label={t('doe_documents_section')} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider">{t('doe_documents_section')}</h3>
          <div className="grid grid-cols-1 gap-2 w-full sm:flex sm:w-auto sm:flex-wrap sm:items-center [&>.btn]:justify-center [&>.btn]:pointer-coarse:min-h-11">
            <select aria-label={t('doe_upload_piece')} className={cn(CHAMP_DOE, 'sm:!w-auto', TOUCH_TARGET)} value={pieceDepot} onChange={e => setPieceDepot(e.target.value as DoePieceKey | '')}>
              <option value="">{t('doe_unclassified')}</option>
              {DOE_PIECES.map(p => <option key={p.key} value={p.key}>{labelPiece(p.key)}</option>)}
            </select>
            {entreprise.lots.length > 1 && (
              <select aria-label={t('doe_upload_lot')} className={cn(CHAMP_DOE, 'sm:!w-auto', TOUCH_TARGET)} value={lotDepot} onChange={e => setLotDepot(e.target.value)}>
                <option value="">{t('doe_all_lots')}</option>
                {entreprise.lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} {l.lot_title}</option>)}
              </select>
            )}
            <input ref={champFichier} type="file" className="sr-only" aria-label={t('doe_add_document')} onChange={e => deposer(e.target.files)} />
            <button type="button" className="btn btn-secondary" disabled={occupe !== null} onClick={() => champFichier.current?.click()}>
              <IconFilePlus size={15} aria-hidden /> {occupe === 'depot' ? t('projectdetail_doe_uploading') : t('doe_add_document')}
            </button>
            <button type="button" className="btn btn-secondary" disabled={occupe !== null || !entreprise.documents.length} onClick={analyser}>
              <IconScanEye size={15} aria-hidden /> {occupe === 'analyse' ? t('doe_analyzing') : t('doe_analyze')}
            </button>
          </div>
        </div>
        <p className="text-xs text-[var(--tblr-muted)]">{t('doe_analyze_hint')}</p>

        {entreprise.documents.length === 0 ? (
          <p className="text-sm italic text-[var(--tblr-muted)]">{t('doe_documents_empty')}</p>
        ) : (
          <ul className="space-y-2">
            {entreprise.documents.map(d => (
              <LigneDocument
                key={`${d.id}-${d.validation_status}-${d.doe_piece}-${d.validation_comments ?? ''}`}
                doc={d} analyse={analyses.get(d.id)} occupe={occupe === `doc-${d.id}` || occupe === `del-${d.id}`}
                onModifier={(maj) => agir(`doc-${d.id}`, () => api.modifierDocument(d.id, maj))}
                onSupprimer={() => supprimer(d)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Visa */}
      <section aria-label={t('doe_visa_section')} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider">{t('doe_visa_section')}</h3>
          <button type="button" className={cn('btn btn-primary justify-center w-full sm:w-auto', TOUCH_TARGET)} disabled={occupe !== null || !entreprise.documents.length} onClick={onVisa}>
            <IconRubberStamp size={15} aria-hidden /> {t('doe_visa_open')}
          </button>
        </div>
        {entreprise.visas.length === 0 ? (
          <p className="text-sm italic text-[var(--tblr-muted)]">{t('doe_visa_none')}</p>
        ) : (
          <ul className="divide-y divide-[var(--tblr-border)] rounded-lg border border-[var(--tblr-border)]">
            {entreprise.visas.map(v => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-bold">{v.numero}</span>
                <span>{t(`doe_avis_visa_${v.avis}`)}</span>
                <span className="text-xs text-[var(--tblr-muted)]">{dateFr(v.issued_at)}{v.issued_by_name ? ` · ${v.issued_by_name}` : ''}{v.sent_at ? ` · ${t('doe_visa_sent_badge')}` : ''}</span>
                {v.file_url && (
                  <button type="button" className="ml-auto p-2 rounded-md hover:bg-[var(--tblr-surface-2)]" aria-label={t('doe_visa_open_pdf', { numero: v.numero })}
                    onClick={() => void openSignedUrl(v.file_url!)}><IconExternalLink size={15} aria-hidden /></button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialog}
    </ModalShell>
  );
}

// ── Un document reçu ─────────────────────────────────────────────────────────

function LigneDocument({ doc, analyse, occupe, onModifier, onSupprimer }: {
  doc: DoeDocumentVue;
  analyse?: ResultatAnalyseDoc;
  occupe: boolean;
  onModifier: (maj: { doe_piece?: DoePieceKey | null; validation_status?: DoeAvisDocument; validation_comments?: string | null }) => void;
  onSupprimer: () => void;
}) {
  const { t } = useTranslation();
  const labelPiece = usePieceLabel();
  const [commentaire, setCommentaire] = useState(doc.validation_comments ?? '');
  const avis = doc.validation_status;
  const demandeCommentaire = avis === 'commented' || avis === 'rejected' || commentaire !== '';

  const donnerAvis = (a: DoeAvisDocument) => onModifier({ validation_status: a === avis ? 'pending' : a });
  const bouton = (a: DoeAvisDocument, Icone: typeof IconCheck, cle: string, couleur: string) => (
    <button type="button" disabled={occupe} aria-pressed={avis === a} title={t(cle)} aria-label={`${t(cle)} : ${doc.name}`}
      onClick={() => donnerAvis(a)}
      className={cn('flex flex-1 sm:flex-none flex-col sm:flex-row items-center justify-center gap-0.5 p-2 rounded-lg border transition-colors min-h-11 sm:min-h-9 min-w-11 sm:min-w-9 disabled:opacity-50',
        avis === a ? couleur : 'border-[var(--tblr-border)] text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface-2)]')}>
      <Icone size={16} aria-hidden />
      <span className="sm:hidden text-[0.6875rem] leading-tight text-center font-semibold" aria-hidden>{t(cle)}</span>
    </button>
  );

  return (
    <li className="rounded-lg border border-[var(--tblr-border)] p-3 space-y-2" aria-busy={occupe}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex-1 basis-60 min-w-0">
          <button type="button" className="font-medium text-sm text-left break-words hover:underline" onClick={() => void openSignedUrl(doc.file_url)}>
            {doc.name} <IconExternalLink size={12} className="inline align-baseline" aria-hidden />
          </button>
          <p className="text-xs text-[var(--tblr-muted)]">
            {dateFr(doc.uploaded_at)} · {doc.doe_source === 'entreprise' ? t('doe_source_company') : t('doe_source_office')}
            {doc.size_bytes ? ` · ${formatOctets(doc.size_bytes)}` : ''}
          </p>
        </div>
        <select aria-label={`${t('doe_document_piece')} : ${doc.name}`} className={cn(CHAMP_DOE, 'sm:!w-auto max-w-full basis-full sm:basis-auto', TOUCH_TARGET)} disabled={occupe}
          value={pieceConnue(doc.doe_piece) ? doc.doe_piece : ''}
          onChange={e => onModifier({ doe_piece: (e.target.value || null) as DoePieceKey | null })}>
          <option value="">{t('doe_unclassified')}</option>
          {DOE_PIECES.map(p => <option key={p.key} value={p.key}>{labelPiece(p.key)}</option>)}
        </select>
        <span className={cn('px-2 py-1 rounded-full text-[0.6875rem] font-bold uppercase', AVIS_STYLE[avis])}>{t(`doe_avis_doc_${avis}`)}</span>
        <div className="flex items-stretch gap-1 basis-full sm:basis-auto" role="group" aria-label={`${t('doe_avis_group')} : ${doc.name}`}>
          {bouton('approved', IconCheck, 'doe_avis_doc_approved', AVIS_STYLE.approved + ' border-transparent')}
          {bouton('commented', IconMessageDots, 'doe_avis_doc_commented', AVIS_STYLE.commented + ' border-transparent')}
          {bouton('rejected', IconX, 'doe_avis_doc_rejected', AVIS_STYLE.rejected + ' border-transparent')}
          <button type="button" disabled={occupe} title={t('projectdetail_doe_delete')} aria-label={t('projectdetail_doe_delete_named', { name: doc.name })}
            onClick={onSupprimer} className="p-2 rounded-lg text-[var(--tblr-muted)] hover:text-red-600 hover:bg-[var(--tblr-surface-2)] min-h-11 sm:min-h-9 min-w-11 sm:min-w-9 flex items-center justify-center">
            <IconTrash size={15} aria-hidden />
          </button>
        </div>
      </div>

      {demandeCommentaire && (
        <textarea rows={2} className={CHAMP_DOE} placeholder={t('doe_comment_placeholder')} aria-label={`${t('projectdetail_visa_observations')} : ${doc.name}`}
          value={commentaire} disabled={occupe} onChange={e => setCommentaire(e.target.value)}
          onBlur={() => { if (commentaire.trim() !== (doc.validation_comments ?? '')) onModifier({ validation_comments: commentaire.trim() || null }); }} />
      )}

      {analyse && (
        <div className="text-xs rounded-lg px-3 py-2 bg-[var(--tblr-surface-2)] space-y-1">
          {analyse.classement && (
            <p>
              {analyse.classement_applique ? t('doe_analysis_classified') : t('doe_analysis_detected')} : <strong>{labelPiece(analyse.classement.piece)}</strong>
              {' '}<span className="text-[var(--tblr-muted)]">({analyse.classement.indices.join(', ')})</span>
            </p>
          )}
          {analyse.anomalies.length === 0 && <p>{t('doe_analysis_none')}</p>}
          {analyse.anomalies.map(a => <p key={a} className="text-amber-800 dark:text-amber-200">{t(`doe_anomaly_${a}`, { defaultValue: DOE_ANOMALIE_LABELS[a] })}</p>)}
        </div>
      )}
    </li>
  );
}
