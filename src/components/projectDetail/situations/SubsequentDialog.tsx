import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import {
  conditionsDe, montantLigne, totalLignes, verifierEmission,
  type ArticleBordereau, type LigneCommande, type MarcheAccordCadreChamps,
} from '../../../lib/accordCadre';
import { Champ, DialogShell, boutonPrincipal, boutonSecondaire, formatEuros, inputClass } from './DialogShell';

interface LigneForm {
  cle: string;
  articleId?: string;
  refBpu?: string;
  designation: string;
  unite: string;
  quantite: string;
  prixUnitaire: string;
}

const nombre = (brut: string): number => Number(brut.trim().replace(/\s/g, '').replace(',', '.'));
const aujourdhui = () => new Date().toISOString().slice(0, 10);
let compteur = 0;
const nouvelleCle = () => `l${++compteur}`;

const enLigneCommande = (l: LigneForm): LigneCommande => ({
  articleId: l.articleId, refBpu: l.refBpu, designation: l.designation, unite: l.unite,
  quantite: nombre(l.quantite), prixUnitaire: nombre(l.prixUnitaire),
});

export interface SubsequentLuPourEdition extends MarcheAccordCadreChamps {
  id: string;
  duree_mois?: number | null;
  notes?: string | null;
}

/**
 * Émission ou modification d'un marché subséquent. Le montant est le total des
 * lignes ; le plafond est contrôlé ici pour prévenir, et définitivement en base.
 * Quand l'offre de l'accord-cadre est figée, les lignes se composent d'articles
 * du bordereau (prix imposés) ; sinon les lignes sont libres.
 */
export function SubsequentDialog({
  open, accordCadre, sub, articles, bordereauFige, cumulAutresHT, onClose, onSave,
}: {
  open: boolean;
  accordCadre: MarcheAccordCadreChamps & { entreprise_nom: string };
  sub: SubsequentLuPourEdition | null;
  articles: ArticleBordereau[];
  /** L'offre retenue est figée : seuls les articles du bordereau sont commandables. */
  bordereauFige: boolean;
  /** Montant déjà émis hors ce subséquent. */
  cumulAutresHT: number;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [objet, setObjet] = useState('');
  const [dateNotification, setDateNotification] = useState(aujourdhui());
  const [duree, setDuree] = useState('');
  const [notes, setNotes] = useState('');
  const [lignes, setLignes] = useState<LigneForm[]>([]);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!open) return;
    setObjet(sub?.objet ?? '');
    setDateNotification(sub?.date_notification ? String(sub.date_notification).slice(0, 10) : aujourdhui());
    setDuree(sub?.duree_mois ? String(sub.duree_mois) : '');
    setNotes(sub?.notes ?? '');
    setLignes((sub?.lignes_commande ?? []).map((l) => ({
      cle: nouvelleCle(), articleId: l.articleId, refBpu: l.refBpu, designation: l.designation, unite: l.unite,
      quantite: String(l.quantite), prixUnitaire: String(l.prixUnitaire),
    })));
    setErreur('');
    setEnCours(false);
  }, [open, sub]);

  const conditions = conditionsDe(accordCadre);
  const lignesCommande = useMemo(() => lignes.map(enLigneCommande), [lignes]);
  const total = totalLignes(lignesCommande);
  const emission = verifierEmission({
    signe: true, conditions, cumulAutresHT, montantHT: total, dateNotification,
  });
  const reste = conditions.montantMaxiHT === null ? null : Math.max(conditions.montantMaxiHT - cumulAutresHT, 0);
  const lignesValides = lignes.length > 0 && lignesCommande.every((l) =>
    l.designation.trim() && Number.isFinite(l.quantite) && l.quantite >= 0 && Number.isFinite(l.prixUnitaire) && l.prixUnitaire >= 0);
  const peutEnregistrer = lignesValides && emission.ok && !enCours;

  const modifier = (cle: string, partiel: Partial<LigneForm>) =>
    setLignes((prev) => prev.map((l) => (l.cle === cle ? { ...l, ...partiel } : l)));

  const ajouterArticle = (articleId: string) => {
    const a = articles.find((x) => x.articleId === articleId);
    if (!a) return;
    setLignes((prev) => [...prev, {
      cle: nouvelleCle(), articleId: a.articleId, refBpu: a.numero, designation: a.designation, unite: a.unite,
      quantite: '1', prixUnitaire: String(a.prixUnitaire),
    }]);
  };

  const ajouterLigneLibre = () =>
    setLignes((prev) => [...prev, { cle: nouvelleCle(), designation: '', unite: '', quantite: '1', prixUnitaire: '0' }]);

  const enregistrer = async () => {
    setEnCours(true);
    setErreur('');
    try {
      await onSave({
        objet: objet.trim(),
        date_notification: dateNotification || null,
        duree_mois: duree.trim() ? Number(duree) : null,
        notes: notes.trim(),
        lignes: lignesCommande,
      });
    } catch (e: any) {
      setErreur(e?.message || t('situations_travaux_save_failed'));
      setEnCours(false);
    }
  };

  const libreAutorise = !bordereauFige;
  const bordereauIntrouvable = bordereauFige && articles.length === 0;

  return (
    <DialogShell
      open={open}
      wide
      title={sub ? t('accord_cadre_sub_dlg_edit', { n: sub.numero_subsequent }) : t('accord_cadre_sub_dlg_new')}
      subtitle={accordCadre.entreprise_nom}
      onClose={onClose}
      busy={enCours}
      footer={(
        <>
          <div className="mr-auto text-sm">
            <span className="text-[var(--tblr-muted)]">{t('accord_cadre_sub_total')} </span>
            <span className="font-bold tabular-nums text-[var(--tblr-text)]">{formatEuros(total)}</span>
          </div>
          <button type="button" className={boutonSecondaire} onClick={onClose} disabled={enCours}>{t('accord_cadre_cancel')}</button>
          <button type="button" className={boutonPrincipal} onClick={enregistrer} disabled={!peutEnregistrer}>{t('accord_cadre_save')}</button>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Champ label={t('accord_cadre_sub_object')} htmlFor={`${id}-objet`} className="sm:col-span-3">
            <input id={`${id}-objet`} className={inputClass} value={objet} onChange={(e) => setObjet(e.target.value)} maxLength={500} />
          </Champ>
          <Champ label={t('accord_cadre_sub_notif_date')} htmlFor={`${id}-date`}>
            <input id={`${id}-date`} type="date" className={inputClass} value={dateNotification} onChange={(e) => setDateNotification(e.target.value)} />
          </Champ>
          <Champ label={t('accord_cadre_sub_duration')} htmlFor={`${id}-duree`}>
            <input id={`${id}-duree`} className={inputClass} inputMode="numeric" value={duree} onChange={(e) => setDuree(e.target.value.replace(/\D/g, ''))} />
          </Champ>
        </div>

        <section aria-labelledby={`${id}-lignes`} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`${id}-lignes`} className="text-sm font-bold text-[var(--tblr-text)]">{t('accord_cadre_sub_lines')}</h3>
            {reste !== null && (
              <p className="text-xs text-[var(--tblr-muted)]">{t('accord_cadre_sub_available', { amount: formatEuros(reste) })}</p>
            )}
          </div>

          {bordereauIntrouvable && <p role="alert" className="text-sm text-[var(--tblr-warning)]">{t('accord_cadre_sub_no_dpgf')}</p>}

          {lignes.length === 0 ? (
            <p className="text-sm text-[var(--tblr-muted)]">{t('accord_cadre_sub_no_lines')}</p>
          ) : (
            <ul className="space-y-3">
              {lignes.map((l, i) => {
                const idLigne = `${id}-${l.cle}`;
                const verrouille = !!l.articleId;
                return (
                  <li key={l.cle} className="rounded-lg border border-[var(--tblr-border)] p-3 grid grid-cols-2 md:grid-cols-12 gap-3 items-end">
                    <Champ label={t('accord_cadre_sub_designation')} htmlFor={`${idLigne}-d`} className="col-span-2 md:col-span-5">
                      <input id={`${idLigne}-d`} className={inputClass} value={l.designation} readOnly={verrouille} onChange={(e) => modifier(l.cle, { designation: e.target.value })} />
                    </Champ>
                    <Champ label={t('accord_cadre_sub_unit')} htmlFor={`${idLigne}-u`} className="md:col-span-1">
                      <input id={`${idLigne}-u`} className={inputClass} value={l.unite} readOnly={verrouille} onChange={(e) => modifier(l.cle, { unite: e.target.value })} />
                    </Champ>
                    <Champ label={t('accord_cadre_sub_qty')} htmlFor={`${idLigne}-q`} className="md:col-span-2">
                      <input id={`${idLigne}-q`} className={inputClass} inputMode="decimal" value={l.quantite} onChange={(e) => modifier(l.cle, { quantite: e.target.value })} />
                    </Champ>
                    <Champ label={t('accord_cadre_sub_unit_price')} htmlFor={`${idLigne}-p`} className="md:col-span-2">
                      <input id={`${idLigne}-p`} className={inputClass} inputMode="decimal" value={l.prixUnitaire} readOnly={verrouille} onChange={(e) => modifier(l.cle, { prixUnitaire: e.target.value })} />
                    </Champ>
                    <div className="col-span-2 md:col-span-2 flex items-center justify-between gap-2">
                      <div className="text-right flex-1">
                        <p className="text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">{t('accord_cadre_sub_line_total')}</p>
                        <p className="text-sm font-bold tabular-nums text-[var(--tblr-text)]">{formatEuros(montantLigne(enLigneCommande(l)) || 0)}</p>
                      </div>
                      <button
                        type="button"
                        className={boutonSecondaire + ' px-2 min-h-11 min-w-11'}
                        onClick={() => setLignes((prev) => prev.filter((x) => x.cle !== l.cle))}
                        aria-label={t('accord_cadre_sub_remove_line', { n: i + 1 })}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            {articles.length > 0 && (
              <select
                className={inputClass + ' sm:max-w-md'}
                value=""
                aria-label={t('accord_cadre_sub_pick_article')}
                onChange={(e) => ajouterArticle(e.target.value)}
              >
                <option value="">{t('accord_cadre_sub_pick_article')}</option>
                {articles.map((a) => (
                  <option key={a.articleId} value={a.articleId}>{`${a.numero} ${a.designation} · ${formatEuros(a.prixUnitaire)}${a.unite ? ` / ${a.unite}` : ''}`}</option>
                ))}
              </select>
            )}
            {libreAutorise && (
              <button type="button" className={boutonSecondaire} onClick={ajouterLigneLibre}>
                <IconPlus size={14} /> {t('accord_cadre_sub_add_line')}
              </button>
            )}
          </div>
        </section>

        <Champ label={t('accord_cadre_sub_notes')} htmlFor={`${id}-notes`}>
          <textarea id={`${id}-notes`} className={inputClass + ' min-h-20'} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Champ>

        {lignesValides && !emission.ok && <p role="alert" className="text-sm text-[var(--tblr-danger)]">{emission.message}</p>}
        {erreur && <p role="alert" className="text-sm text-[var(--tblr-danger)]">{erreur}</p>}
      </div>
    </DialogShell>
  );
}
