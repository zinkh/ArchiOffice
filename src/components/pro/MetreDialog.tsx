// Métré d'un article : une ligne par façade, niveau ou local, chacune avec son libellé et son calcul
// (« 10 », « =4*5 », « -2,4 » pour une déduction). La quantité de l'article est la somme. Le calcul saisi
// reste affiché : il ne disparaît plus derrière son résultat. Rien n'est écrit avant « Appliquer ».
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconX } from '@tabler/icons-react';
import type { Ligne, QuantiteDetail } from '../../types/dpgf';
import { formatQuantite } from '../../lib/quantiteFormat';
import {
  appliquerMetre, calculerSaisie, estLigneVide, formuleCourante, libelleDetail, MAX_LIGNES_METRE, totalMetre, validerMetre,
} from '../../lib/quantites';

interface Props {
  ligne: Ligne;
  onClose: () => void;
  /** Reçoit ce que le métré change sur l'article (quantité, prix total, lignes) ; à fusionner dans la ligne. */
  onSave: (patch: Partial<Ligne>) => void;
}

const nouvelleLigne = (surcharge: Partial<QuantiteDetail> = {}): QuantiteDetail => ({
  id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, quantite: 0, ...surcharge,
});

const texteCalcul = (d: QuantiteDetail): string => d.expression ?? (d.quantite ? String(d.quantite).replace('.', ',') : '');

/** Lignes de départ : le métré existant, sinon la quantité actuelle (formule mémorisée comprise) en première ligne. */
function lignesInitiales(ligne: Ligne): QuantiteDetail[] {
  if (ligne.quantiteDetails?.length) return structuredClone(ligne.quantiteDetails);
  if (ligne.quantite) {
    return [nouvelleLigne({ expression: formuleCourante(ligne) ?? String(ligne.quantite).replace('.', ','), quantite: ligne.quantite })];
  }
  return [nouvelleLigne()];
}

const CHAMP = 'w-full px-2.5 py-1.5 text-sm border rounded-md bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]';

export function MetreDialog({ ligne, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [lignes, setLignes] = useState<QuantiteDetail[]>(() => lignesInitiales(ligne));
  const [focusId, setFocusId] = useState<string | null>(null);
  const titreId = useRef(`metre-titre-${ligne.id}`).current;

  const gardees = useMemo(() => lignes.filter(d => !estLigneVide(d)), [lignes]);
  const validation = useMemo(() => validerMetre(gardees), [gardees]);
  const total = totalMetre(lignes);
  const idInvalide = !validation.ok && validation.erreur.type === 'ligne_invalide' ? gardees[validation.erreur.index]?.id : null;

  const modifier = (id: string, patch: Partial<QuantiteDetail>) => setLignes(v => v.map(d => (d.id === id ? { ...d, ...patch } : d)));
  const ajouter = () => {
    if (lignes.length >= MAX_LIGNES_METRE) return;
    const d = nouvelleLigne();
    setLignes(v => [...v, d]);
    setFocusId(d.id);
  };
  const retirer = (id: string) => setLignes(v => v.filter(d => d.id !== id));
  const appliquer = () => {
    const patch = appliquerMetre(ligne, lignes);
    if (patch) onSave(patch);
  };

  const message = !validation.ok
    ? validation.erreur.type === 'total_negatif' ? t('pro_metre_error_negative')
      : validation.erreur.type === 'hors_limites' ? t('pro_metre_error_limits')
      : validation.erreur.type === 'trop_de_lignes' ? t('pro_metre_error_too_many', { max: MAX_LIGNES_METRE })
      : null
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div
        role="dialog" aria-modal="true" aria-labelledby={titreId}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
        className="w-full max-w-3xl max-h-[88dvh] overflow-auto rounded-xl bg-white dark:bg-zinc-900 shadow-2xl border"
        style={{ borderColor: 'var(--tblr-border)' }}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 px-5 py-4 border-b bg-white dark:bg-zinc-900" style={{ borderColor: 'var(--tblr-border)' }}>
          <div className="min-w-0">
            <h3 id={titreId} className="text-lg font-bold">{t('pro_metre_title')}</h3>
            <p className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{ligne.numero} {ligne.designation}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('pro_metre_close')} className="p-1.5 rounded-md border" style={{ borderColor: 'var(--tblr-border)' }}>
            <IconX size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-2">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)_6.5rem_2rem] gap-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>
            <span>{t('pro_metre_col_label')}</span><span>{t('pro_metre_col_calc')}</span><span className="text-right">{t('pro_metre_col_value')}</span><span />
          </div>

          {lignes.map((d, i) => {
            const n = i + 1;
            const calcul = calculerSaisie(texteCalcul(d));
            const invalide = d.id === idInvalide || !calcul.ok;
            const valeur = calcul.ok ? calcul.valeur : null;
            return (
              <div key={d.id} className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)_6.5rem_2rem] gap-2 items-center">
                  <input
                    type="text" autoFocus={d.id === focusId || (i === 0 && !focusId)}
                    aria-label={t('pro_metre_aria_label', { n })} placeholder={t('pro_metre_label_placeholder')}
                    value={d.libelle ?? libelleDetail(d)} onChange={e => modifier(d.id, { libelle: e.target.value })}
                    className={CHAMP} style={{ borderColor: 'var(--tblr-border)' }}
                  />
                  <input
                    type="text" inputMode="decimal"
                    aria-label={t('pro_metre_aria_calc', { n })} aria-invalid={invalide || undefined} placeholder={t('pro_metre_calc_placeholder')}
                    value={texteCalcul(d)} onChange={e => modifier(d.id, { expression: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter' && i === lignes.length - 1) { e.preventDefault(); ajouter(); } }}
                    className={`${CHAMP} font-mono`} style={{ borderColor: invalide ? '#b91c1c' : 'var(--tblr-border)' }}
                  />
                  <span className="text-right text-sm font-mono tabular-nums" aria-live="polite">
                    {valeur === null ? '?' : formatQuantite(valeur)}
                    {valeur !== null && valeur < 0 && <span className="ml-1 font-sans text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('pro_metre_deduction')}</span>}
                  </span>
                  <button
                    type="button" onClick={() => retirer(d.id)} aria-label={t('pro_metre_aria_remove', { n })}
                    className="p-1.5 rounded-md border" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
                  >
                    <IconX size={14} />
                  </button>
                </div>
                {invalide && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{t('pro_metre_error_line')}</p>}
              </div>
            );
          })}

          <button
            type="button" onClick={ajouter} disabled={lignes.length >= MAX_LIGNES_METRE}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-md border border-dashed disabled:opacity-50"
            style={{ borderColor: 'var(--tblr-muted)' }}
          >
            <IconPlus size={14} /> {t('pro_metre_add')}
          </button>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
          <span className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('pro_metre_total')}</span>
          <span data-testid="metre-total" className="text-xl font-bold font-mono tabular-nums">{formatQuantite(total)} {ligne.unite}</span>
        </div>

        <div className="px-5 pb-3 space-y-1 text-xs" style={{ color: 'var(--tblr-muted)' }}>
          <p>{t('pro_metre_help')}</p>
          {gardees.length === 0 && <p>{t('pro_metre_empty_note')}</p>}
          {message && <p role="alert" className="font-bold text-red-700 dark:text-red-400">{message}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border" style={{ borderColor: 'var(--tblr-border)' }}>
            {t('pro_metre_cancel')}
          </button>
          <button
            type="button" onClick={appliquer} disabled={!validation.ok}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
          >
            {t('pro_metre_apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
