// Métré d'un article : une ligne par façade, niveau ou local, chacune avec son libellé et son calcul
// (« 10 », « =4*5 », « -2,4 » pour une déduction). La quantité de l'article est la somme. Le calcul saisi
// reste affiché : il ne disparaît plus derrière son résultat. Rien n'est écrit avant « Appliquer ».
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconX } from '@tabler/icons-react';
import type { Batiment, Ligne, QuantiteDetail } from '../../types/dpgf';
import { formatQuantite } from '../../lib/quantiteFormat';
import {
  appliquerMetre, calculerSaisie, estLigneVide, formuleCourante, libelleDetail, MAX_LIGNES_METRE, totalMetre, totauxParBatiment, validerMetre,
} from '../../lib/quantites';

interface Props {
  ligne: Ligne;
  onClose: () => void;
  /** Reçoit ce que le métré change sur l'article (quantité, prix total, lignes) ; à fusionner dans la ligne. */
  onSave: (patch: Partial<Ligne>) => void | Promise<void>;
  /** Libellé du bouton de validation (« Envoyer la proposition » pour un confrère). */
  applyLabel?: string;
  /** Message d'un refus de l'appelant (envoi échoué) : la saisie reste dans la fenêtre. */
  erreur?: string | null;
  /** Bâtiments proposés : seulement pour un article réparti par bâtiment (chaque ligne a alors le sien). */
  batiments?: Batiment[];
}

const nouvelleLigne = (surcharge: Partial<QuantiteDetail> = {}): QuantiteDetail => ({
  id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, quantite: 0, ...surcharge,
});

const texteCalcul = (d: QuantiteDetail): string => d.expression ?? (d.quantite ? String(d.quantite).replace('.', ',') : '');

/** Lignes de départ : le métré existant, sinon les quantités par bâtiment, sinon la quantité actuelle (formule comprise). */
function lignesInitiales(ligne: Ligne, batiments?: Batiment[]): QuantiteDetail[] {
  const ids = Object.keys(ligne.quantitesBatiments ?? {});
  if (ligne.quantiteDetails?.length) {
    const lignes = structuredClone(ligne.quantiteDetails);
    // Une ligne d'avant sans bâtiment reprend l'unique bâtiment de l'article, s'il n'y en a qu'un.
    if (batiments?.length && ids.length === 1) return lignes.map(d => (d.batimentId ? d : { ...d, batimentId: ids[0] }));
    return lignes;
  }
  if (batiments?.length) {
    const parBatiment = batiments
      .filter(b => (ligne.quantitesBatiments?.[b.id] ?? 0) !== 0)
      .map(b => nouvelleLigne({ batimentId: b.id, expression: String(ligne.quantitesBatiments![b.id]).replace('.', ','), quantite: ligne.quantitesBatiments![b.id] }));
    return parBatiment.length ? parBatiment : [nouvelleLigne({ batimentId: batiments[0].id })];
  }
  if (ligne.quantite) {
    return [nouvelleLigne({ expression: formuleCourante(ligne) ?? String(ligne.quantite).replace('.', ','), quantite: ligne.quantite })];
  }
  return [nouvelleLigne()];
}

const CHAMP = 'w-full px-2.5 py-1.5 text-sm border rounded-md bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]';

export function MetreDialog({ ligne, onClose, onSave, applyLabel, erreur, batiments }: Props) {
  const { t } = useTranslation();
  const parBatiment = !!batiments?.length;
  const [lignes, setLignes] = useState<QuantiteDetail[]>(() => lignesInitiales(ligne, batiments));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [repliees, setRepliees] = useState<ReadonlySet<string>>(new Set());
  const titreId = useRef(`metre-titre-${ligne.id}`).current;

  const gardees = useMemo(() => lignes.filter(d => !estLigneVide(d)), [lignes]);
  const validation = useMemo(() => validerMetre(gardees, { parBatiment }), [gardees, parBatiment]);
  const totaux = useMemo(() => totauxParBatiment(lignes.filter(d => !estLigneVide(d))), [lignes]);
  const total = totalMetre(lignes);
  const idInvalide = !validation.ok && validation.erreur.type === 'ligne_invalide' ? gardees[validation.erreur.index]?.id : null;
  const idSansBatiment = !validation.ok && validation.erreur.type === 'batiment_manquant' ? gardees[validation.erreur.index]?.id : null;
  const codeBatiment = (id: string) => batiments?.find(b => b.id === id)?.code ?? id;
  const GRILLE = 'grid-cols-[minmax(0,1fr)_minmax(0,11rem)_6.5rem_2rem]';
  const GRILLE_ORPHELINE = 'grid-cols-[minmax(0,1fr)_6rem_minmax(0,10rem)_6.5rem_2rem]';
  const affectees = ligne.quantitesBatiments ?? {};
  // Une branche par bâtiment qui a des lignes ou que l'article porte déjà, dans l'ordre du projet ; puis les
  // bâtiments inconnus du projet ; puis les lignes sans bâtiment (à affecter : elles bloquent l'envoi).
  const branches: string[] = useMemo(() => {
    if (!parBatiment) return [];
    const utilises = new Set(lignes.map(d => d.batimentId ?? ''));
    const connus = batiments!.map(b => b.id).filter(id => utilises.has(id) || id in affectees);
    const inconnus = [...utilises].filter(id => id && !batiments!.some(b => b.id === id));
    return [...connus, ...inconnus, ...(utilises.has('') ? [''] : [])];
  }, [lignes, parBatiment, batiments, affectees]);
  const batimentsSansBranche = (batiments ?? []).filter(b => !branches.includes(b.id));

  const modifier = (id: string, patch: Partial<QuantiteDetail>) => setLignes(v => v.map(d => (d.id === id ? { ...d, ...patch } : d)));
  const ajouter = (batimentId?: string) => {
    if (lignes.length >= MAX_LIGNES_METRE) return;
    const d = nouvelleLigne(parBatiment ? { batimentId: batimentId || (lignes[lignes.length - 1]?.batimentId ?? batiments![0].id) } : {});
    setLignes(v => [...v, d]);
    setFocusId(d.id);
  };
  const retirer = (id: string) => setLignes(v => v.filter(d => d.id !== id));
  const appliquer = () => {
    const patch = appliquerMetre(ligne, lignes, { parBatiment });
    if (patch) onSave(patch);
  };

  /** Une ligne du métré. `orpheline` : sans bâtiment, elle porte son sélecteur pour être affectée. */
  const rangee = (d: QuantiteDetail, i: number, orpheline = false) => {
    const n = i + 1;
    const calcul = calculerSaisie(texteCalcul(d));
    const invalide = d.id === idInvalide || !calcul.ok;
    const valeur = calcul.ok ? calcul.valeur : null;
    return (
      <div key={d.id} className="space-y-1">
        <div className={`grid ${orpheline ? GRILLE_ORPHELINE : GRILLE} gap-2 items-center`}>
          <input
            type="text" autoFocus={d.id === focusId || (i === 0 && !focusId)}
            aria-label={t('pro_metre_aria_label', { n })} placeholder={t('pro_metre_label_placeholder')}
            value={d.libelle ?? libelleDetail(d)} onChange={e => modifier(d.id, { libelle: e.target.value })}
            className={CHAMP} style={{ borderColor: 'var(--tblr-border)' }}
          />
          {orpheline && (
            <select
              aria-label={t('pro_metre_aria_building', { n })} aria-invalid={d.id === idSansBatiment || undefined}
              value={d.batimentId ?? ''} onChange={e => modifier(d.id, { batimentId: e.target.value || undefined })}
              className={CHAMP} style={{ borderColor: d.id === idSansBatiment ? '#b91c1c' : 'var(--tblr-border)' }}
            >
              <option value="">{t('pro_metre_building_none')}</option>
              {batiments!.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
            </select>
          )}
          <input
            type="text" inputMode="decimal"
            aria-label={t('pro_metre_aria_calc', { n })} aria-invalid={invalide || undefined} placeholder={t('pro_metre_calc_placeholder')}
            value={texteCalcul(d)} onChange={e => modifier(d.id, { expression: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && i === lignes.length - 1) { e.preventDefault(); ajouter(d.batimentId); } }}
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
        {d.id === idSansBatiment && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{t('pro_metre_error_building', { n })}</p>}
        {invalide && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{t('pro_metre_error_line')}</p>}
      </div>
    );
  };

  /** Une branche de l'arbre : un bâtiment, son total, ses lignes et son bouton d'ajout. */
  const branche = (id: string) => {
    const orpheline = id === '';
    const siennes = lignes.map((d, i) => ({ d, i })).filter(({ d }) => (d.batimentId ?? '') === id);
    const aErreur = siennes.some(({ d }) => d.id === idInvalide || d.id === idSansBatiment);
    const ouverte = !repliees.has(id) || aErreur;
    const code = orpheline ? t('pro_metre_branch_none') : codeBatiment(id);
    const libelle = batiments?.find(b => b.id === id)?.libelle;
    const bascule = () => setRepliees(v => { const s2 = new Set(v); if (s2.has(id)) s2.delete(id); else s2.add(id); return s2; });
    return (
      <div key={id || 'sans'} role="group" data-testid={`metre-branch-${id || 'sans'}`} className="rounded-md border overflow-hidden" style={{ borderColor: 'var(--tblr-border)' }}>
        <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ background: 'var(--tblr-surface-2)' }}>
          <button
            type="button" onClick={bascule} aria-expanded={ouverte}
            aria-label={t(ouverte ? 'pro_metre_aria_collapse' : 'pro_metre_aria_expand', { code })}
            className="flex items-center gap-2 text-sm font-bold min-w-0 text-left"
          >
            <span aria-hidden className="text-[0.625rem]">{ouverte ? '▼' : '▶'}</span>
            <span>{code}</span>
            {libelle && <span className="font-normal truncate" style={{ color: 'var(--tblr-muted)' }}>{libelle}</span>}
            <span className="font-normal text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_metre_branch_lines', { count: siennes.length })}</span>
          </button>
          {!orpheline && (
            <span data-testid={`metre-total-${id}`} className="text-sm font-bold font-mono tabular-nums">{formatQuantite(totaux[id] ?? 0)} {ligne.unite}</span>
          )}
        </div>
        {ouverte && (
          <div className="px-3 py-2 space-y-2">
            {siennes.map(({ d, i }) => rangee(d, i, orpheline))}
            {!orpheline && (
              <button
                type="button" data-testid={`metre-add-${id}`} onClick={() => ajouter(id)} disabled={lignes.length >= MAX_LIGNES_METRE}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md border border-dashed disabled:opacity-50"
                style={{ borderColor: 'var(--tblr-muted)' }}
              >
                <IconPlus size={12} /> {t('pro_metre_add_to', { code })}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const message = !validation.ok
    ? validation.erreur.type === 'total_negatif' ? t('pro_metre_error_negative')
      : validation.erreur.type === 'hors_limites' ? t('pro_metre_error_limits')
      : validation.erreur.type === 'trop_de_lignes' ? t('pro_metre_error_too_many', { max: MAX_LIGNES_METRE })
      : validation.erreur.type === 'batiment_negatif' ? t('pro_metre_error_building_negative', { code: codeBatiment(validation.erreur.batimentId) })
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
          {parBatiment ? (
            <>
              {branches.map(branche)}
              {batimentsSansBranche.length > 0 && (
                <select
                  aria-label={t('pro_metre_add_building')} value=""
                  onChange={e => { if (e.target.value) ajouter(e.target.value); }}
                  className={`${CHAMP} w-auto`} style={{ borderColor: 'var(--tblr-border)' }}
                >
                  <option value="">{t('pro_metre_add_building')}</option>
                  {batimentsSansBranche.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                </select>
              )}
            </>
          ) : (
            <>
              <div className={`grid ${GRILLE} gap-2 text-xs`} style={{ color: 'var(--tblr-muted)' }}>
                <span>{t('pro_metre_col_label')}</span><span>{t('pro_metre_col_calc')}</span><span className="text-right">{t('pro_metre_col_value')}</span><span />
              </div>
              {lignes.map((d, i) => rangee(d, i))}
              <button
                type="button" onClick={() => ajouter()} disabled={lignes.length >= MAX_LIGNES_METRE}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-md border border-dashed disabled:opacity-50"
                style={{ borderColor: 'var(--tblr-muted)' }}
              >
                <IconPlus size={14} /> {t('pro_metre_add')}
              </button>
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
          <span className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('pro_metre_total')}</span>
          <span data-testid="metre-total" className="text-xl font-bold font-mono tabular-nums">{formatQuantite(total)} {ligne.unite}</span>
        </div>

        <div className="px-5 pb-3 space-y-1 text-xs" style={{ color: 'var(--tblr-muted)' }}>
          <p>{t('pro_metre_help')}</p>
          {gardees.length === 0 && <p>{t('pro_metre_empty_note')}</p>}
          {message && <p role="alert" className="font-bold text-red-700 dark:text-red-400">{message}</p>}
          {erreur && <p role="alert" className="font-bold text-red-700 dark:text-red-400">{erreur}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border" style={{ borderColor: 'var(--tblr-border)' }}>
            {t('pro_metre_cancel')}
          </button>
          <button
            type="button" onClick={appliquer} disabled={!validation.ok}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
          >
            {applyLabel ?? t('pro_metre_apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
