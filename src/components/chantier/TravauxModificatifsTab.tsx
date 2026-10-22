// Onglet « Travaux modificatifs » du chantier : les devis reçus des entreprises pour
// des travaux supplémentaires, et les fiches de travaux modificatifs (FTM) que la
// maîtrise d'œuvre instruit avant d'émettre, le cas échéant, un ordre de service.
// Serveur : server/routes/travauxModificatifs.ts (tables ftm et devis_travaux_modificatifs).
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronRight, IconPaperclip, IconPlus, IconTrash } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { uploadResourceFiles, ResourceAttachments } from '../ResourceAttachments';
import { DialogShell, Champ } from '../projectDetail/situations/DialogShell';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import type { OrdreDeService } from '../../types';

interface Marche { id: string; type_marche?: string; entreprise_nom?: string; lot_numero?: string; lot_titre?: string; numero_subsequent?: number }
interface Devis {
  id: string; marche_id?: string | null; entreprise?: string | null; reference?: string | null; objet: string;
  montant_ht?: number | null; date_reception?: string | null; statut: string; ftm_id?: string | null; observations?: string | null;
}
interface Ftm {
  id: string; numero: string; title: string; objet?: string | null; origine?: string | null; motif?: string | null; description?: string | null;
  marche_ids?: string[]; incidence_delai_jours?: number | null; incidences_delais_details?: string | null;
  montant_estime_ht?: number | null; montant_accepte_ht?: number | null; status: string;
  date_emission?: string | null; date_decision?: string | null; ordre_service_id?: string | null;
}

const DEVIS_STATUTS = ['recu', 'en_analyse', 'accepte', 'refuse'] as const;
const FTM_STATUTS = ['brouillon', 'emise', 'validee', 'refusee'] as const;
const ORIGINES = ['maitrise_ouvrage', 'maitrise_oeuvre', 'entreprise', 'aleas', 'autres'] as const;

const STATUT_COULEURS: Record<string, string> = {
  recu: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  en_analyse: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  accepte: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  refuse: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  brouillon: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  emise: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  validee: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  refusee: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const CHAMP = 'w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg h-10 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500';
const AREA = 'w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500';
const BTN = 'flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition';
const BTN_PRIMARY = 'px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition';

const libelleMarche = (m: Marche) =>
  `${m.type_marche === 'subsequent' ? `MS n°${m.numero_subsequent ?? '?'} · ` : ''}${[m.lot_numero, m.lot_titre].filter(Boolean).join(' — ')} · ${m.entreprise_nom || ''}`;
const nombre = (v: string): number | null => { const n = Number(v.replace(',', '.')); return v.trim() !== '' && Number.isFinite(n) ? n : null; };
const dateFr = (d?: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
const aujourdhui = () => new Date().toISOString().slice(0, 10);

export default function TravauxModificatifsTab({ projectId, marches, ordresDeService }: {
  projectId: string;
  marches: Marche[];
  ordresDeService: OrdreDeService[];
}) {
  const { t } = useTranslation();
  const { confirm, dialog } = useConfirmDialog();
  const [devis, setDevis] = useState<Devis[]>([]);
  const [ftms, setFtms] = useState<Ftm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [devisOpen, setDevisOpen] = useState(false);
  const [ftmOpen, setFtmOpen] = useState(false);
  const [piecesOpen, setPiecesOpen] = useState<string | null>(null);
  const [ftmDeplie, setFtmDeplie] = useState<string | null>(null);

  const marchesExecutables = useMemo(() => marches.filter(m => m.type_marche !== 'accord_cadre'), [marches]);
  const marcheParId = useMemo(() => new Map(marches.map(m => [m.id, m])), [marches]);
  const ordresTravaux = useMemo(() => ordresDeService.filter(o => !o.type || o.type === 'travaux'), [ordresDeService]);

  const charger = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([
        apiFetch<Devis[]>(`/api/projects/${projectId}/devis-travaux-modificatifs`),
        apiFetch<Ftm[]>(`/api/projects/${projectId}/ftm`),
      ]);
      setDevis(d); setFtms(f); setError(null);
    } catch (e: any) { setError(e?.message || t('travaux_modif_load_failed')); }
  }, [projectId, t]);
  useEffect(() => { void charger(); }, [charger]);

  const ecrire = async (url: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) => {
    try {
      const r = await apiFetch<any>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      setError(null);
      return r;
    } catch (e: any) { setError(e?.message || t('travaux_modif_save_failed')); return null; }
  };

  const changerStatutDevis = async (d: Devis, statut: string) => {
    setDevis(prev => prev.map(x => x.id === d.id ? { ...x, statut } : x));
    if (!(await ecrire(`/api/devis-travaux-modificatifs/${d.id}`, 'PUT', { statut }))) void charger();
  };
  const changerFtm = async (f: Ftm, patch: Partial<Ftm>) => {
    setFtms(prev => prev.map(x => x.id === f.id ? { ...x, ...patch } : x));
    if (!(await ecrire(`/api/ftm/${f.id}`, 'PUT', patch))) void charger();
  };
  const rattacherDevis = async (d: Devis, ftmId: string) => {
    setDevis(prev => prev.map(x => x.id === d.id ? { ...x, ftm_id: ftmId || null } : x));
    if (!(await ecrire(`/api/devis-travaux-modificatifs/${d.id}`, 'PUT', { ftm_id: ftmId || null }))) void charger();
  };

  const supprimer = async (kind: 'devis' | 'ftm', id: string, nom: string) => {
    const ok = await confirm({
      title: t(kind === 'devis' ? 'travaux_modif_devis_delete_title' : 'travaux_modif_ftm_delete_title', { name: nom }),
      message: t('travaux_modif_delete_message'),
      confirmLabel: t('projectdetail_dialog_delete'), cancelLabel: t('projectdetail_dialog_cancel'), tone: 'danger',
    });
    if (!ok) return;
    if (await ecrire(kind === 'devis' ? `/api/devis-travaux-modificatifs/${id}` : `/api/ftm/${id}`, 'DELETE')) await charger();
  };

  // ── Création d'un devis ──
  const devisVide = { marche_id: '', entreprise: '', reference: '', objet: '', montant_ht: '', date_reception: aujourdhui(), ftm_id: '', observations: '' };
  const [nd, setNd] = useState(devisVide);
  const [ndFiles, setNdFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const creerDevis = async () => {
    setBusy(true);
    const cree = await ecrire(`/api/projects/${projectId}/devis-travaux-modificatifs`, 'POST', {
      marche_id: nd.marche_id || null, entreprise: nd.marche_id ? undefined : nd.entreprise, reference: nd.reference, objet: nd.objet,
      montant_ht: nd.montant_ht === '' ? null : nombre(nd.montant_ht), date_reception: nd.date_reception || null,
      ftm_id: nd.ftm_id || null, observations: nd.observations,
    });
    if (cree?.id && ndFiles.length) {
      try { await uploadResourceFiles('devis_travaux_modificatifs', cree.id, ndFiles); }
      catch (e: any) { setError(e?.message || t('travaux_modif_files_failed')); }
    }
    setBusy(false);
    if (cree) { setNd(devisVide); setNdFiles([]); setDevisOpen(false); await charger(); }
  };

  // ── Création d'une FTM ──
  const ftmVide = { title: '', objet: '', origine: 'entreprise', motif: '', description: '', marche_ids: [] as string[], incidence_delai_jours: '', montant_estime_ht: '', date_emission: '' };
  const [nf, setNf] = useState(ftmVide);
  const [nfFiles, setNfFiles] = useState<File[]>([]);
  const creerFtm = async () => {
    setBusy(true);
    const cree = await ecrire(`/api/projects/${projectId}/ftm`, 'POST', {
      title: nf.title, objet: nf.objet, origine: nf.origine, motif: nf.motif, description: nf.description, marche_ids: nf.marche_ids,
      incidence_delai_jours: nombre(nf.incidence_delai_jours), montant_estime_ht: nombre(nf.montant_estime_ht), date_emission: nf.date_emission || null,
    });
    if (cree?.id && nfFiles.length) {
      try { await uploadResourceFiles('ftm', cree.id, nfFiles); }
      catch (e: any) { setError(e?.message || t('travaux_modif_files_failed')); }
    }
    setBusy(false);
    if (cree) { setNf(ftmVide); setNfFiles([]); setFtmOpen(false); await charger(); }
  };

  const totalDevis = devis.reduce((s, d) => s + (Number(d.montant_ht) || 0), 0);
  const totalAcceptes = devis.filter(d => d.statut === 'accepte').reduce((s, d) => s + (Number(d.montant_ht) || 0), 0);
  const nomsEntreprises = (ids?: string[]) => (ids || []).map(i => marcheParId.get(i)?.entreprise_nom).filter(Boolean).join(' ; ') || '—';
  const FichiersChoisis = ({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) => (
    <ul className="flex flex-wrap gap-1.5 pt-1">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-[var(--tblr-surface)] border border-[var(--tblr-border)] pl-2.5 pr-1 py-0.5 text-xs">
          <span className="truncate max-w-[14rem]">{f.name}</span>
          <button type="button" aria-label={t('projectdetail_os_file_remove', { name: f.name })} onClick={() => setFiles(files.filter((_, k) => k !== i))} className="px-1 text-[var(--tblr-muted)] hover:text-red-500">×</button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-8">
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {/* Devis reçus */}
      <section className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }} aria-labelledby="tm-devis-titre">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[var(--tblr-border)]">
          <div>
            <h3 id="tm-devis-titre" className="text-base font-bold text-[var(--tblr-text)]">{t('travaux_modif_devis_title')}</h3>
            <p className="text-xs text-[var(--tblr-muted)]">
              {t('travaux_modif_devis_summary', { count: devis.length, total: formatCurrency(totalDevis), accepted: formatCurrency(totalAcceptes) })}
            </p>
          </div>
          <button type="button" className={BTN} onClick={() => setDevisOpen(true)}><IconPlus size={14} />{t('travaux_modif_devis_new')}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[0.6875rem] tracking-wider">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">{t('travaux_modif_col_received')}</th>
                <th scope="col" className="px-4 py-3 text-left">{t('travaux_modif_col_company')}</th>
                <th scope="col" className="px-4 py-3 text-left">{t('travaux_modif_col_object')}</th>
                <th scope="col" className="px-4 py-3 text-right">{t('travaux_modif_col_amount')}</th>
                <th scope="col" className="px-4 py-3 text-left">{t('travaux_modif_col_ftm')}</th>
                <th scope="col" className="px-4 py-3 text-left">{t('projectdetail_col_status')}</th>
                <th scope="col" className="px-4 py-3 text-right"><span className="sr-only">{t('projectdetail_col_actions')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--tblr-border)]">
              {devis.map(d => (
                <Fragment key={d.id}>
                  <tr className="hover:bg-[var(--tblr-surface-2)]">
                    <td className="px-4 py-3 text-xs text-[var(--tblr-muted)] whitespace-nowrap">{dateFr(d.date_reception)}</td>
                    <td className="px-4 py-3 text-xs">{d.entreprise || '—'}</td>
                    <td className="px-4 py-3 max-w-[22rem]">
                      <span className="block truncate" title={d.objet}>{d.objet}</span>
                      {d.reference && <span className="text-[0.6875rem] text-[var(--tblr-muted)]">{t('travaux_modif_ref', { ref: d.reference })}</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{formatCurrency(d.montant_ht == null ? null : Number(d.montant_ht))}</td>
                    <td className="px-4 py-3">
                      <select aria-label={t('travaux_modif_devis_ftm_named', { object: d.objet })} className="p-1 rounded text-xs border border-zinc-200 dark:border-zinc-700 bg-transparent"
                        value={d.ftm_id || ''} onChange={e => void rattacherDevis(d, e.target.value)}>
                        <option value="">—</option>
                        {ftms.map(f => <option key={f.id} value={f.id}>{f.numero}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select aria-label={t('travaux_modif_status_named', { name: d.objet })}
                        className={`p-1 rounded text-[0.6875rem] font-bold uppercase tracking-wider border-none cursor-pointer ${STATUT_COULEURS[d.statut] || ''}`}
                        value={d.statut} onChange={e => void changerStatutDevis(d, e.target.value)}>
                        {DEVIS_STATUTS.map(s => <option key={s} value={s}>{t(`travaux_modif_devis_status_${s}`)}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" aria-expanded={piecesOpen === d.id} aria-label={t('travaux_modif_files_named', { name: d.objet })} title={t('projectdetail_os_files')}
                          onClick={() => setPiecesOpen(p => p === d.id ? null : d.id)} className={`p-1 ${piecesOpen === d.id ? 'text-blue-500' : 'text-[var(--tblr-muted)] hover:text-blue-500'}`}><IconPaperclip size={14} /></button>
                        <button type="button" aria-label={t('travaux_modif_delete_named', { name: d.objet })} onClick={() => void supprimer('devis', d.id, d.objet)}
                          className="p-1 text-[var(--tblr-muted)] hover:text-red-500"><IconTrash size={14} /></button>
                      </div>
                    </td>
                  </tr>
                  {piecesOpen === d.id && (
                    <tr className="bg-[var(--tblr-surface-2)]"><td colSpan={7} className="px-6 py-3"><ResourceAttachments resourceType="devis_travaux_modificatifs" resourceId={d.id} /></td></tr>
                  )}
                </Fragment>
              ))}
              {devis.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-left sm:text-center text-[var(--tblr-muted)] italic"><span className="table-empty-message">{t('travaux_modif_devis_empty')}</span></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* FTM */}
      <section className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }} aria-labelledby="tm-ftm-titre">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[var(--tblr-border)]">
          <div>
            <h3 id="tm-ftm-titre" className="text-base font-bold text-[var(--tblr-text)]">{t('travaux_modif_ftm_title')}</h3>
            <p className="text-xs text-[var(--tblr-muted)]">{t('travaux_modif_ftm_subtitle')}</p>
          </div>
          <button type="button" className={BTN} onClick={() => setFtmOpen(true)}><IconPlus size={14} />{t('travaux_modif_ftm_new')}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[0.6875rem] tracking-wider">
              <tr>
                <th scope="col" className="px-2 py-3 w-8"><span className="sr-only">{t('travaux_modif_details')}</span></th>
                <th scope="col" className="px-4 py-3 text-left">{t('projectdetail_col_number')}</th>
                <th scope="col" className="px-4 py-3 text-left">{t('projectdetail_col_title')}</th>
                <th scope="col" className="px-4 py-3 text-left">{t('travaux_modif_col_companies')}</th>
                <th scope="col" className="px-4 py-3 text-right">{t('travaux_modif_col_estimated')}</th>
                <th scope="col" className="px-4 py-3 text-right">{t('travaux_modif_col_quotes')}</th>
                <th scope="col" className="px-4 py-3 text-left">{t('projectdetail_col_status')}</th>
                <th scope="col" className="px-4 py-3 text-right"><span className="sr-only">{t('projectdetail_col_actions')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--tblr-border)]">
              {ftms.map(f => {
                const lies = devis.filter(d => d.ftm_id === f.id);
                const ouvert = ftmDeplie === f.id;
                return (
                  <Fragment key={f.id}>
                    <tr className="hover:bg-[var(--tblr-surface-2)]">
                      <td className="px-2 py-3">
                        <button type="button" aria-expanded={ouvert} aria-label={t('travaux_modif_details_named', { number: f.numero })} onClick={() => setFtmDeplie(ouvert ? null : f.id)} className="p-1 text-[var(--tblr-muted)]">
                          <IconChevronRight size={15} className={`transition-transform ${ouvert ? 'rotate-90' : ''}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">{f.numero}</td>
                      <td className="px-4 py-3 max-w-[20rem]"><span className="block truncate" title={f.title}>{f.title}</span></td>
                      <td className="px-4 py-3 text-xs text-[var(--tblr-muted)]">{nomsEntreprises(f.marche_ids)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{formatCurrency(f.montant_estime_ht == null ? null : Number(f.montant_estime_ht))}</td>
                      <td className="px-4 py-3 text-right text-xs whitespace-nowrap">{lies.length ? `${lies.length} · ${formatCurrency(lies.reduce((s, d) => s + (Number(d.montant_ht) || 0), 0))}` : '—'}</td>
                      <td className="px-4 py-3">
                        <select aria-label={t('travaux_modif_status_named', { name: f.numero })}
                          className={`p-1 rounded text-[0.6875rem] font-bold uppercase tracking-wider border-none cursor-pointer ${STATUT_COULEURS[f.status] || ''}`}
                          value={f.status} onChange={e => void changerFtm(f, { status: e.target.value, ...(e.target.value === 'emise' && !f.date_emission ? { date_emission: aujourdhui() } : {}), ...((e.target.value === 'validee' || e.target.value === 'refusee') && !f.date_decision ? { date_decision: aujourdhui() } : {}) })}>
                          {FTM_STATUTS.map(s => <option key={s} value={s}>{t(`travaux_modif_ftm_status_${s}`)}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" aria-expanded={piecesOpen === f.id} aria-label={t('travaux_modif_files_named', { name: f.numero })} title={t('projectdetail_os_files')}
                            onClick={() => setPiecesOpen(p => p === f.id ? null : f.id)} className={`p-1 ${piecesOpen === f.id ? 'text-blue-500' : 'text-[var(--tblr-muted)] hover:text-blue-500'}`}><IconPaperclip size={14} /></button>
                          <button type="button" aria-label={t('travaux_modif_delete_named', { name: f.numero })} onClick={() => void supprimer('ftm', f.id, f.numero)}
                            className="p-1 text-[var(--tblr-muted)] hover:text-red-500"><IconTrash size={14} /></button>
                        </div>
                      </td>
                    </tr>
                    {ouvert && (
                      <tr className="bg-[var(--tblr-surface-2)]">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Champ label={t('travaux_modif_field_accepted')} htmlFor={`ftm-acc-${f.id}`}>
                              <input id={`ftm-acc-${f.id}`} type="number" step="any" className={CHAMP} defaultValue={f.montant_accepte_ht ?? ''}
                                onBlur={e => void changerFtm(f, { montant_accepte_ht: e.target.value === '' ? null : nombre(e.target.value) })} />
                            </Champ>
                            <Champ label={t('travaux_modif_field_delay_days')} htmlFor={`ftm-del-${f.id}`}>
                              <input id={`ftm-del-${f.id}`} type="number" className={CHAMP} defaultValue={f.incidence_delai_jours ?? ''}
                                onBlur={e => void changerFtm(f, { incidence_delai_jours: e.target.value === '' ? null : nombre(e.target.value) })} />
                            </Champ>
                            <Champ label={t('travaux_modif_field_os')} htmlFor={`ftm-os-${f.id}`}>
                              <select id={`ftm-os-${f.id}`} className={CHAMP} value={f.ordre_service_id || ''} onChange={e => void changerFtm(f, { ordre_service_id: e.target.value || null })}>
                                <option value="">—</option>
                                {ordresTravaux.map(o => <option key={o.id} value={o.id}>{t('projectdetail_os_label', { number: o.os_number })} · {o.title}</option>)}
                              </select>
                            </Champ>
                            <Champ label={t('travaux_modif_field_origin')} htmlFor={`ftm-ori-${f.id}`}>
                              <select id={`ftm-ori-${f.id}`} className={CHAMP} value={f.origine || ''} onChange={e => void changerFtm(f, { origine: e.target.value || null })}>
                                <option value="">—</option>
                                {ORIGINES.map(o => <option key={o} value={o}>{t(`travaux_modif_origin_${o}`)}</option>)}
                              </select>
                            </Champ>
                            <Champ label={t('travaux_modif_field_issue_date')} htmlFor={`ftm-em-${f.id}`}>
                              <input id={`ftm-em-${f.id}`} type="date" className={CHAMP} defaultValue={f.date_emission ?? ''} onBlur={e => void changerFtm(f, { date_emission: e.target.value || null })} />
                            </Champ>
                            <Champ label={t('travaux_modif_field_decision_date')} htmlFor={`ftm-dec-${f.id}`}>
                              <input id={`ftm-dec-${f.id}`} type="date" className={CHAMP} defaultValue={f.date_decision ?? ''} onBlur={e => void changerFtm(f, { date_decision: e.target.value || null })} />
                            </Champ>
                            <Champ label={t('travaux_modif_field_reason')} htmlFor={`ftm-mot-${f.id}`} className="md:col-span-3">
                              <textarea id={`ftm-mot-${f.id}`} rows={2} className={AREA} defaultValue={f.motif ?? ''} onBlur={e => void changerFtm(f, { motif: e.target.value })} />
                            </Champ>
                            <Champ label={t('travaux_modif_field_description')} htmlFor={`ftm-desc-${f.id}`} className="md:col-span-3">
                              <textarea id={`ftm-desc-${f.id}`} rows={3} className={AREA} defaultValue={f.description ?? ''} onBlur={e => void changerFtm(f, { description: e.target.value })} />
                            </Champ>
                          </div>
                        </td>
                      </tr>
                    )}
                    {piecesOpen === f.id && (
                      <tr className="bg-[var(--tblr-surface-2)]"><td colSpan={8} className="px-6 py-3"><ResourceAttachments resourceType="ftm" resourceId={f.id} /></td></tr>
                    )}
                  </Fragment>
                );
              })}
              {ftms.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-8 text-left sm:text-center text-[var(--tblr-muted)] italic"><span className="table-empty-message">{t('travaux_modif_ftm_empty')}</span></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <DialogShell open={devisOpen} onClose={() => setDevisOpen(false)} busy={busy} title={t('travaux_modif_devis_new')}
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setDevisOpen(false)} disabled={busy}>{t('projectdetail_dialog_cancel')}</button>
          <button type="button" className={BTN_PRIMARY} onClick={() => void creerDevis()} disabled={busy || !nd.objet.trim()}>{t('travaux_modif_save')}</button>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Champ label={t('travaux_modif_col_company')} htmlFor="tm-d-marche" className="sm:col-span-2">
            <select id="tm-d-marche" className={CHAMP} value={nd.marche_id} onChange={e => setNd({ ...nd, marche_id: e.target.value })}>
              <option value="">{t('travaux_modif_company_other')}</option>
              {marchesExecutables.map(m => <option key={m.id} value={m.id}>{libelleMarche(m)}</option>)}
            </select>
          </Champ>
          {!nd.marche_id && (
            <Champ label={t('travaux_modif_company_name')} htmlFor="tm-d-ent" className="sm:col-span-2">
              <input id="tm-d-ent" className={CHAMP} value={nd.entreprise} onChange={e => setNd({ ...nd, entreprise: e.target.value })} />
            </Champ>
          )}
          <Champ label={t('travaux_modif_col_object')} htmlFor="tm-d-objet" className="sm:col-span-2">
            <input id="tm-d-objet" className={CHAMP} required value={nd.objet} onChange={e => setNd({ ...nd, objet: e.target.value })} placeholder={t('travaux_modif_object_placeholder')} />
          </Champ>
          <Champ label={t('travaux_modif_field_reference')} htmlFor="tm-d-ref">
            <input id="tm-d-ref" className={CHAMP} value={nd.reference} onChange={e => setNd({ ...nd, reference: e.target.value })} />
          </Champ>
          <Champ label={t('travaux_modif_col_amount')} htmlFor="tm-d-mont">
            <input id="tm-d-mont" type="number" step="any" className={CHAMP} value={nd.montant_ht} onChange={e => setNd({ ...nd, montant_ht: e.target.value })} />
          </Champ>
          <Champ label={t('travaux_modif_col_received')} htmlFor="tm-d-date">
            <input id="tm-d-date" type="date" className={CHAMP} value={nd.date_reception} onChange={e => setNd({ ...nd, date_reception: e.target.value })} />
          </Champ>
          <Champ label={t('travaux_modif_col_ftm')} htmlFor="tm-d-ftm">
            <select id="tm-d-ftm" className={CHAMP} value={nd.ftm_id} onChange={e => setNd({ ...nd, ftm_id: e.target.value })}>
              <option value="">—</option>
              {ftms.map(f => <option key={f.id} value={f.id}>{f.numero} · {f.title}</option>)}
            </select>
          </Champ>
          <Champ label={t('travaux_modif_field_notes')} htmlFor="tm-d-obs" className="sm:col-span-2">
            <textarea id="tm-d-obs" rows={2} className={AREA} value={nd.observations} onChange={e => setNd({ ...nd, observations: e.target.value })} />
          </Champ>
          <Champ label={t('projectdetail_os_files')} htmlFor="tm-d-files" className="sm:col-span-2">
            <input id="tm-d-files" type="file" multiple className="block w-full text-xs" onChange={e => setNdFiles(prev => [...prev, ...Array.from(e.target.files || [])])} />
            <FichiersChoisis files={ndFiles} setFiles={setNdFiles} />
          </Champ>
        </div>
      </DialogShell>

      <DialogShell open={ftmOpen} onClose={() => setFtmOpen(false)} busy={busy} title={t('travaux_modif_ftm_new')} subtitle={t('travaux_modif_ftm_number_auto')}
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setFtmOpen(false)} disabled={busy}>{t('projectdetail_dialog_cancel')}</button>
          <button type="button" className={BTN_PRIMARY} onClick={() => void creerFtm()} disabled={busy || !nf.title.trim()}>{t('travaux_modif_save')}</button>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Champ label={t('projectdetail_col_title')} htmlFor="tm-f-titre" className="sm:col-span-2">
            <input id="tm-f-titre" className={CHAMP} required value={nf.title} onChange={e => setNf({ ...nf, title: e.target.value })} placeholder={t('travaux_modif_ftm_title_placeholder')} />
          </Champ>
          <Champ label={t('travaux_modif_field_origin')} htmlFor="tm-f-ori">
            <select id="tm-f-ori" className={CHAMP} value={nf.origine} onChange={e => setNf({ ...nf, origine: e.target.value })}>
              {ORIGINES.map(o => <option key={o} value={o}>{t(`travaux_modif_origin_${o}`)}</option>)}
            </select>
          </Champ>
          <Champ label={t('travaux_modif_field_issue_date')} htmlFor="tm-f-date">
            <input id="tm-f-date" type="date" className={CHAMP} value={nf.date_emission} onChange={e => setNf({ ...nf, date_emission: e.target.value })} />
          </Champ>
          <fieldset className="sm:col-span-2 space-y-1 min-w-0">
            <legend className="text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">{t('travaux_modif_col_companies')}</legend>
            <div className="max-h-36 overflow-y-auto rounded-lg border border-[var(--tblr-border)] bg-white dark:bg-zinc-900 divide-y divide-[var(--tblr-border)]">
              {marchesExecutables.map(m => (
                <label key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--tblr-surface-2)]">
                  <input type="checkbox" checked={nf.marche_ids.includes(m.id)}
                    onChange={() => setNf({ ...nf, marche_ids: nf.marche_ids.includes(m.id) ? nf.marche_ids.filter(x => x !== m.id) : [...nf.marche_ids, m.id] })} />
                  <span className="truncate">{libelleMarche(m)}</span>
                </label>
              ))}
              {marchesExecutables.length === 0 && <p className="px-3 py-2 text-xs italic text-[var(--tblr-muted)]">{t('projectdetail_os_no_contract')}</p>}
            </div>
          </fieldset>
          <Champ label={t('travaux_modif_field_reason')} htmlFor="tm-f-motif" className="sm:col-span-2">
            <textarea id="tm-f-motif" rows={2} className={AREA} value={nf.motif} onChange={e => setNf({ ...nf, motif: e.target.value })} />
          </Champ>
          <Champ label={t('travaux_modif_field_description')} htmlFor="tm-f-desc" className="sm:col-span-2">
            <textarea id="tm-f-desc" rows={3} className={AREA} value={nf.description} onChange={e => setNf({ ...nf, description: e.target.value })} />
          </Champ>
          <Champ label={t('travaux_modif_col_estimated')} htmlFor="tm-f-est">
            <input id="tm-f-est" type="number" step="any" className={CHAMP} value={nf.montant_estime_ht} onChange={e => setNf({ ...nf, montant_estime_ht: e.target.value })} />
          </Champ>
          <Champ label={t('travaux_modif_field_delay_days')} htmlFor="tm-f-delai">
            <input id="tm-f-delai" type="number" className={CHAMP} value={nf.incidence_delai_jours} onChange={e => setNf({ ...nf, incidence_delai_jours: e.target.value })} />
          </Champ>
          <Champ label={t('projectdetail_os_files')} htmlFor="tm-f-files" className="sm:col-span-2">
            <input id="tm-f-files" type="file" multiple className="block w-full text-xs" onChange={e => setNfFiles(prev => [...prev, ...Array.from(e.target.files || [])])} />
            <FichiersChoisis files={nfFiles} setFiles={setNfFiles} />
          </Champ>
        </div>
      </DialogShell>
      {dialog}
    </div>
  );
}
