// Liste des PV d'OPR par lot (bloc « Réception » de l'onglet AOR) : un PV par lot, avec son
// statut, ses réserves et ses échéances déduits. En marché privé, le modèle simplifié du cabinet ;
// en marché public, les formulaires EXE4 et EXE5 (la décision EXE6, EXE7 et la levée des réserves
// EXE8, EXE9 ne sont pas encore proposées). Tableau au bureau, liste de cartes sous 768 px (un
// seul rendu monté).
import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { IconClipboardList, IconDownload, IconPlus, IconTrash } from '@tabler/icons-react';
import { Card, CardHeader } from '../ui/Card';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { STATUTS_RESERVE_LEVEE, useOprPv, type PvOpr } from '../../hooks/useOprPv';
import type { AgencySettings } from '../../lib/proposalExport';
import { statutPv } from '../../lib/oprPv';
import { aEcheanceEnRetard, echeances } from '../../lib/oprPvDelais';
import { dateFr, libelleLot } from '../../lib/oprPvDocument';
import { donneesPvPrive, telechargerPvDocx, telechargerPvPdf } from '../../lib/oprPvExport';
import { OprPvDialog, type ProjetOpr } from './OprPvDialog';

interface Props {
  projectId: string;
  projet: ProjetOpr;
  /** Maître d'ouvrage public : formulaires EXE4 et EXE5 au lieu du modèle simplifié. */
  marchePublic: boolean;
  settings: AgencySettings;
  /** Appelé quand des réserves ont changé, pour que le suivi des réserves se relise. */
  onReservesChanged?: () => void;
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

export function OprPvSection({ projectId, projet, marchePublic, settings, onReservesChanged }: Props) {
  const { t } = useTranslation();
  const api = useOprPv(projectId);
  const { confirm, dialog } = useConfirmDialog();
  const bureau = useMediaQuery('(min-width: 768px)');
  const [ouvert, setOuvert] = useState<string | 'nouveau' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const marcheDe = (pv: PvOpr) => api.marches.find(m => m.id === pv.pv.marche_id) ?? null;
  const reservesDe = (pv: PvOpr) => api.reserves.filter(r => r.reception_id === pv.id);
  const ouvertes = (pv: PvOpr) => reservesDe(pv).filter(r => !STATUTS_RESERVE_LEVEE.has(r.status ?? '')).length;
  const donnees = (pv: PvOpr) => donneesPvPrive({
    pv: pv.pv, reference: pv.reference_pv, maitreOuvrage: projet.maitreOuvrage, objet: projet.objet || projet.nom,
    marche: marcheDe(pv), reserves: reservesDe(pv), agence: settings.agencyName,
  });

  const telecharger = async (pv: PvOpr, format: 'pdf' | 'docx') => {
    setErreur(null);
    try {
      if (format === 'pdf') await telechargerPvPdf(donnees(pv), settings);
      else await telechargerPvDocx(donnees(pv), settings);
    } catch (e: any) { setErreur(e?.message || t('opr_error_generic')); }
  };

  const supprimer = async (pv: PvOpr) => {
    const ok = await confirm({
      title: t('opr_delete_title'), message: t('opr_delete_message', { ref: pv.reference_pv ?? '' }),
      confirmLabel: t('opr_delete'), cancelLabel: t('btn_cancel'), tone: 'danger',
    });
    if (!ok) return;
    setErreur(null);
    try { await api.supprimer(pv.id); } catch (e: any) { setErreur(e?.message || t('opr_error_generic')); }
  };

  const fermer = () => {
    setOuvert(null);
    onReservesChanged?.();
  };

  const retard = (pv: PvOpr): string => {
    const liste = echeances(pv.pv, aujourdhui());
    if (!aEcheanceEnRetard(liste)) return '';
    const e = liste.find(x => x.etat === 'depasse' || x.etat === 'hors_delai')!;
    return `${t(`opr_deadline_${e.cle}`)} : ${t(`opr_state_${e.etat}`)}`;
  };

  const actions = (pv: PvOpr) => (
    <div className="flex items-center gap-1 justify-end">
      <button type="button" className="btn btn-secondary" onClick={() => setOuvert(pv.id)}>{t('opr_open')}</button>
      {!marchePublic && (
        <button type="button" aria-label={`${t('opr_pdf')} ${pv.reference_pv ?? ''}`} className="p-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]" onClick={() => telecharger(pv, 'pdf')}><IconDownload size={16} /></button>
      )}
      <button type="button" aria-label={`${t('opr_delete')} ${pv.reference_pv ?? ''}`} className="p-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 text-[var(--tblr-muted)] hover:text-red-600" onClick={() => supprimer(pv)}><IconTrash size={16} /></button>
    </div>
  );

  const lot = (pv: PvOpr) => libelleLot(marcheDe(pv)?.lot_numero, marcheDe(pv)?.lot_titre) || '·';
  const statut = (pv: PvOpr) => (
    <>
      {t(`opr_status_${statutPv(pv.pv)}`)}
      {pv.signed_at && <span className="block text-xs text-[var(--tblr-muted)]">{t('opr_signed_on', { date: dateFr(pv.signed_at) })}</span>}
    </>
  );

  const regime = marchePublic ? 'public' : 'prive';
  const liste = api.pvs.filter(p => p.pv.regime === regime);
  const edite = ouvert && ouvert !== 'nouveau' ? liste.find(p => p.id === ouvert) ?? null : null;

  return (
    <Card>
      <CardHeader
        icon={IconClipboardList}
        title={t('opr_title')}
        description={t('opr_subtitle')}
        action={(
          <button type="button" onClick={() => setOuvert('nouveau')} disabled={api.marches.length === 0}
            className="flex items-center gap-2 px-4 py-2 pointer-coarse:min-h-11 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-sm font-bold transition disabled:opacity-60">
            <IconPlus size={14} /> {t('opr_new')}
          </button>
        )}
      />
      <div className="p-4 sm:p-6 space-y-4">
        {marchePublic && <p role="note" className="text-sm rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] p-3">{t('opr_public_notice')}</p>}
        {!api.chargement && api.marches.length === 0 && <p className="text-sm text-[var(--tblr-muted)]">{t('opr_no_markets')}</p>}
        {(erreur || api.erreur) && <p role="alert" className="text-sm text-red-600">{erreur || api.erreur}</p>}
        {api.chargement && <p className="text-sm text-[var(--tblr-muted)]">{t('opr_loading')}</p>}
        {!api.chargement && liste.length === 0 && api.marches.length > 0 && <p className="text-sm text-[var(--tblr-muted)]">{t('opr_empty')}</p>}

        {liste.length > 0 && (bureau ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-[var(--tblr-muted)]">
                  <th scope="col" className="py-2 pr-3">{t('opr_col_lot')}</th>
                  <th scope="col" className="py-2 pr-3">{t('opr_col_company')}</th>
                  <th scope="col" className="py-2 pr-3">{t('opr_col_ref')}</th>
                  <th scope="col" className="py-2 pr-3">{t('opr_col_date')}</th>
                  <th scope="col" className="py-2 pr-3">{t('opr_col_status')}</th>
                  <th scope="col" className="py-2 pr-3">{t('opr_col_reserves')}</th>
                  <th scope="col" className="py-2 pr-3">{t('opr_col_deadlines')}</th>
                  <th scope="col" className="py-2"><span className="sr-only">{t('opr_col_actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {liste.map(pv => (
                  <tr key={pv.id} className="border-t border-[var(--tblr-border)] align-top">
                    <td className="py-2 pr-3 font-semibold">{lot(pv)}</td>
                    <td className="py-2 pr-3">{marcheDe(pv)?.entreprise_nom ?? ''}</td>
                    <td className="py-2 pr-3 tabular-nums">{pv.reference_pv}</td>
                    <td className="py-2 pr-3">{dateFr(pv.pv.date_opr)}</td>
                    <td className="py-2 pr-3">{statut(pv)}</td>
                    <td className="py-2 pr-3 tabular-nums">{ouvertes(pv)} / {reservesDe(pv).length}</td>
                    <td className="py-2 pr-3 text-red-600">{retard(pv)}</td>
                    <td className="py-2">{actions(pv)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="space-y-3">
            {liste.map(pv => (
              <li key={pv.id} className="rounded-lg border border-[var(--tblr-border)] p-3 space-y-1">
                <p className="font-semibold">{lot(pv)}</p>
                <p className="text-sm text-[var(--tblr-muted)]">{marcheDe(pv)?.entreprise_nom ?? ''}{pv.reference_pv ? ` · ${pv.reference_pv}` : ''}{pv.pv.date_opr ? ` · ${dateFr(pv.pv.date_opr)}` : ''}</p>
                <p className="text-sm">{statut(pv)} · {ouvertes(pv)} / {reservesDe(pv).length} {t('opr_col_reserves').toLowerCase()}</p>
                {retard(pv) && <p className="text-sm text-red-600">{retard(pv)}</p>}
                {actions(pv)}
              </li>
            ))}
          </ul>
        ))}
      </div>

      <AnimatePresence>
        {ouvert === 'nouveau' && (
          <OprPvDialog key="nouveau" pv={null} regime={regime} marches={api.marches} reserves={[]} projet={projet} settings={settings} api={api} onClose={fermer} />
        )}
        {edite && (
          <OprPvDialog key={edite.id} pv={edite} regime={regime} marches={api.marches} reserves={reservesDe(edite)} projet={projet} settings={settings} api={api} onClose={fermer} />
        )}
      </AnimatePresence>
      {dialog}
    </Card>
  );
}
